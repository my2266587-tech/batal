"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { ChevronDownIcon, DeleteIcon, IconButton } from "@/components/Icons";
import { formatDate } from "@/lib/format";

// Review inbox for phone recordings (Yemot). A recording does NOT create a task
// on its own — it lands here in the `phone_recordings` table. The user goes over
// the transcription, fixes the spoken name / hours / definition and links a
// patient, then approves. Only on approval ("אשרי והעבירי לניהול משימות") is a
// real row written to the `tasks` table; the recording is then locked.

const STATUS = {
  ready: { label: "מוכן לאישור", cls: "badge-info" },
  needs_patient: { label: "צריך שיוך מטופלת", cls: "badge-warning" },
  failed: { label: "נכשל", cls: "badge-danger" },
  approved: { label: "אושר והועבר למשימות", cls: "badge-success" },
};

const FILTERS = [
  { value: "open", label: "ממתינים" },
  { value: "ready", label: "מוכן לאישור" },
  { value: "needs_patient", label: "צריך שיוך מטופלת" },
  { value: "failed", label: "נכשל" },
  { value: "approved", label: "אושרו" },
  { value: "all", label: "הכל" },
];

// Effective status (defensive — older rows without a status fall back sensibly).
function effStatus(r) {
  if (r.status) return r.status;
  if (r.task_id) return "approved";
  return r.patient_id ? "ready" : "needs_patient";
}

export default function PhoneTasksPage() {
  const [rows, setRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [rRes, pRes] = await Promise.all([
      supabase
        .from("phone_recordings")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("patients").select("id, full_name").order("full_name"),
    ]);
    if (rRes.error) setError(rRes.error.message);
    if (pRes.error) setError(pRes.error.message);
    setRows(rRes.data || []);
    setPatients(pRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

  function openEdit(r) {
    if (expandedId === r.id) {
      setExpandedId(null);
      setDraft(null);
      return;
    }
    setExpandedId(r.id);
    setError("");
    setDraft({
      spoken_patient_name: r.spoken_patient_name || "",
      patient_id: r.patient_id || "",
      hours: r.hours != null && r.hours !== "" ? String(r.hours) : "",
      task_definition: r.task_definition || "",
      transcription: r.transcription || "",
    });
  }

  // Save edits without approving. Recompute the review status from the patient
  // link. The spoken name is whatever the user typed — never auto-overwritten.
  async function save(r) {
    if (effStatus(r) === "approved") return;
    setSaving(true);
    setError("");
    const patient_id = draft.patient_id || null;
    const payload = {
      spoken_patient_name: draft.spoken_patient_name.trim() || null,
      patient_id,
      hours: draft.hours === "" ? null : Number(draft.hours),
      task_definition: draft.task_definition.trim() || null,
      transcription: draft.transcription.trim() || null,
      status: patient_id ? "ready" : "needs_patient",
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase
      .from("phone_recordings")
      .update(payload)
      .eq("id", r.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setExpandedId(null);
    setDraft(null);
    load();
  }

  // Approve → create the real task, then lock the recording. Double-approval is
  // prevented by the status/task_id guard here and by the unique call id on tasks.
  async function approveAndMove(r) {
    if (effStatus(r) === "approved" || r.task_id) return;
    const patient_id = draft.patient_id || null;
    if (!patient_id) {
      setError("יש לשייך מטופלת לפני האישור וההעברה לניהול משימות.");
      return;
    }
    setSaving(true);
    setError("");

    const taskPayload = {
      patient_id,
      hours: draft.hours === "" ? null : Number(draft.hours),
      task_definition: draft.task_definition.trim() || null,
      source: "phone",
      caller_phone: r.caller_phone || null,
      recording_url: r.recording_url || null,
      transcription: draft.transcription.trim() || null,
      call_external_id: r.call_external_id || null,
      status: "פתוח",
    };

    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .insert([taskPayload])
      .select("id")
      .single();

    let taskId = task?.id;
    // If this call's id already produced a task (unique index), reuse it instead
    // of failing — keeps approval idempotent.
    if (taskErr) {
      if (taskErr.code === "23505" && r.call_external_id) {
        const again = await supabase
          .from("tasks")
          .select("id")
          .eq("call_external_id", r.call_external_id)
          .maybeSingle();
        taskId = again.data?.id;
      }
      if (!taskId) {
        setSaving(false);
        setError("יצירת המשימה נכשלה: " + taskErr.message);
        return;
      }
    }

    const { error: updErr } = await supabase
      .from("phone_recordings")
      .update({
        // Keep the spoken name verbatim; persist the user's final edits.
        spoken_patient_name: draft.spoken_patient_name.trim() || null,
        patient_id,
        hours: draft.hours === "" ? null : Number(draft.hours),
        task_definition: draft.task_definition.trim() || null,
        transcription: draft.transcription.trim() || null,
        status: "approved",
        task_id: taskId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);

    setSaving(false);
    if (updErr) {
      setError(
        "המשימה נוצרה אך עדכון ההקלטה נכשל: " + updErr.message,
      );
      return;
    }
    setExpandedId(null);
    setDraft(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm("למחוק את ההקלטה הזו לצמיתות?")) return;
    const { error: err } = await supabase
      .from("phone_recordings")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else load();
  }

  const counts = useMemo(() => {
    const c = {
      open: 0,
      ready: 0,
      needs_patient: 0,
      failed: 0,
      approved: 0,
      all: rows.length,
    };
    rows.forEach((r) => {
      const s = effStatus(r);
      if (c[s] != null) c[s]++;
      if (s !== "approved") c.open++;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const s = effStatus(r);
      if (filter === "open" && s === "approved") return false;
      if (
        ["ready", "needs_patient", "failed", "approved"].includes(filter) &&
        s !== filter
      )
        return false;
      if (q) {
        const hay = [
          r.spoken_patient_name,
          r.task_definition,
          r.transcription,
          r.caller_phone,
          patientNameById[r.patient_id],
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search, patientNameById]);

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">טלפונים ממתינים</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">טלפונים ממתינים</h1>
          <p className="page-subtitle">
            הקלטות שנקלטו מהטלפון — לעבור על המלל, לשייך מטופלת ולאשר. משימה
            נוצרת רק בעת האישור.
          </p>
        </div>
        <input
          type="search"
          placeholder="חיפוש — שם, טלפון, מלל..."
          className="input md:max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const n = counts[f.value];
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={
                "rounded-full px-4 py-1.5 text-sm font-medium border transition-colors " +
                (active
                  ? "bg-accent-600 text-white border-accent-600"
                  : "bg-white text-ink-600 border-line hover:border-accent-300")
              }
            >
              {f.label}
              {n > 0 && (
                <span
                  className={
                    "mr-1.5 text-xs font-bold " +
                    (active ? "text-white/90" : "text-accent-700")
                  }
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && <p className="text-red-700 text-sm">{error}</p>}

      {loading ? (
        <div className="card p-8 text-center text-ink-500">טוען...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-900 font-semibold mb-1">אין הקלטות להצגה</p>
          <p className="text-ink-500 text-sm">
            הקלטות שנקלטות מהטלפון יופיעו כאן אוטומטית.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {filtered.map((r) => {
            const st = STATUS[effStatus(r)] || STATUS.needs_patient;
            const linked = !!r.patient_id;
            const matchedName = linked
              ? patientNameById[r.patient_id] || "מטופלת"
              : "לא שויך";
            const spoken = r.spoken_patient_name || "—";
            const isOpen = expandedId === r.id;
            const isApproved = effStatus(r) === "approved";
            return (
              <Fragment key={r.id}>
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-subtle"
                  onClick={() => openEdit(r)}
                >
                  <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-700 flex items-center justify-center text-lg flex-shrink-0">
                    📞
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* spoken name ↔ matched patient */}
                    <div className="font-medium text-ink-900 truncate flex items-center gap-1.5">
                      <span>{spoken}</span>
                      <span className="text-ink-400">↔</span>
                      <span className={linked ? "text-emerald-700" : "text-amber-700"}>
                        {matchedName}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {formatDate(r.created_at)}
                      {r.caller_phone ? ` · ${r.caller_phone}` : ""}
                    </div>
                  </div>
                  <span className={linked ? "badge-accent" : "badge-warning"}>
                    {linked ? "משויך" : "צריך שיוך"}
                  </span>
                  <span className={st.cls}>{st.label}</span>
                  <ChevronDownIcon
                    className={
                      "w-4 h-4 text-ink-400 transition-transform " +
                      (isOpen ? "rotate-180" : "")
                    }
                  />
                </div>

                {isOpen && draft && (
                  <div className="p-5 bg-surface-subtle border-t border-line space-y-4">
                    {isApproved && (
                      <div className="badge-success inline-flex">
                        אושר והועבר לניהול משימות — לא ניתן לאשר שוב
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">השם שנאמר</label>
                        <input
                          className="input"
                          placeholder="השם שנשמע בהקלטה"
                          value={draft.spoken_patient_name}
                          disabled={isApproved}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              spoken_patient_name: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="label">שיוך מטופלת</label>
                        <select
                          className="input"
                          value={draft.patient_id}
                          disabled={isApproved}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, patient_id: e.target.value }))
                          }
                        >
                          <option value="">— ללא שיוך —</option>
                          {patients.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-ink-500 mt-1">
                          {draft.spoken_patient_name || "—"} ↔{" "}
                          {draft.patient_id
                            ? patientNameById[draft.patient_id] || "מטופלת"
                            : "לא שויך"}
                        </p>
                      </div>
                      <div>
                        <label className="label">משך שעות</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="input"
                          placeholder="לדוגמה: 1.5"
                          value={draft.hours}
                          disabled={isApproved}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, hours: e.target.value }))
                          }
                        />
                      </div>
                      <div>
                        <label className="label">הגדרת משימה</label>
                        <textarea
                          className="input min-h-[60px] whitespace-pre-wrap"
                          value={draft.task_definition}
                          disabled={isApproved}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              task_definition: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label">תמלול</label>
                      <textarea
                        className="input min-h-[90px] whitespace-pre-wrap"
                        value={draft.transcription}
                        disabled={isApproved}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            transcription: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {!isApproved && (
                        <>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={saving}
                            onClick={() => save(r)}
                          >
                            {saving ? "שומר..." : "שמור"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            disabled={saving}
                            onClick={() => approveAndMove(r)}
                          >
                            ✓ אשרי והעבירי לניהול משימות
                          </button>
                        </>
                      )}
                      {r.recording_url && (
                        <audio
                          controls
                          src={r.recording_url}
                          className="h-9 max-w-[260px]"
                        >
                          <a
                            href={r.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-accent-700 hover:underline font-medium"
                          >
                            🎧 האזנה להקלטה
                          </a>
                        </audio>
                      )}
                      <span className="flex-1" />
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => handleDelete(r.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
