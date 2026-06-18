"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { ChevronDownIcon, DeleteIcon, IconButton } from "@/components/Icons";
import { formatDate } from "@/lib/format";

// Review inbox for tasks created from the phone (Yemot). These rows already
// live in the `tasks` table (source = "phone"); this screen lets the user go
// over the captured text, fix it, and link a patient — or it stays flagged
// "needs patient" until handled. Approving removes it from the inbox; the task
// itself remains in "ניהול משימות" like any other task.

const PHONE_STATUS = {
  pending: { label: "ממתין לאישור", cls: "badge-info" },
  needs_patient: { label: "צריך שיוך למטופל", cls: "badge-warning" },
  approved: { label: "אושר", cls: "badge-success" },
};

const FILTERS = [
  { value: "awaiting", label: "ממתינים לאישור" },
  { value: "needs_patient", label: "צריך שיוך למטופל" },
  { value: "approved", label: "אושרו" },
  { value: "all", label: "הכל" },
];

// Effective status (older rows created before phone_status was added have null).
function effStatus(t) {
  if (t.phone_status) return t.phone_status;
  return t.patient_id ? "pending" : "needs_patient";
}

export default function PhoneTasksPage() {
  const [rows, setRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("awaiting");
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
    const [tRes, pRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("source", "phone")
        .order("created_at", { ascending: false }),
      supabase.from("patients").select("id, full_name").order("full_name"),
    ]);
    if (tRes.error) setError(tRes.error.message);
    if (pRes.error) setError(pRes.error.message);
    setRows(tRes.data || []);
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

  function openEdit(t) {
    if (expandedId === t.id) {
      setExpandedId(null);
      setDraft(null);
      return;
    }
    setExpandedId(t.id);
    setError("");
    setDraft({
      task_definition: t.task_definition || "",
      patient_id: t.patient_id || "",
      hours: t.hours != null && t.hours !== "" ? String(t.hours) : "",
    });
  }

  async function save(t, approve = false) {
    setSaving(true);
    setError("");
    const patient_id = draft.patient_id || null;
    const payload = {
      task_definition: draft.task_definition || null,
      patient_id,
      hours: draft.hours === "" ? null : Number(draft.hours),
      phone_status: approve ? "approved" : patient_id ? "pending" : "needs_patient",
    };
    const { error: err } = await supabase
      .from("tasks")
      .update(payload)
      .eq("id", t.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setExpandedId(null);
    setDraft(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm("למחוק את המשימה הזו לצמיתות?")) return;
    const { error: err } = await supabase.from("tasks").delete().eq("id", id);
    if (err) setError(err.message);
    else load();
  }

  const counts = useMemo(() => {
    const c = { awaiting: 0, needs_patient: 0, approved: 0, all: rows.length };
    rows.forEach((t) => {
      const s = effStatus(t);
      if (s === "approved") c.approved++;
      else c.awaiting++;
      if (s === "needs_patient") c.needs_patient++;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      const s = effStatus(t);
      if (filter === "awaiting" && s === "approved") return false;
      if (filter === "needs_patient" && s !== "needs_patient") return false;
      if (filter === "approved" && s !== "approved") return false;
      if (q) {
        const hay = [
          t.task_definition,
          t.transcription,
          t.caller_phone,
          t.other_details,
          patientNameById[t.patient_id],
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
            הקלטות שנקלטו מהטלפון — לעבור על המלל, לערוך ולשייך מטופלת.
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
          <p className="text-ink-900 font-semibold mb-1">אין שיחות להצגה</p>
          <p className="text-ink-500 text-sm">
            משימות שנוצרות מהטלפון יופיעו כאן אוטומטית.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {filtered.map((t) => {
            const st = PHONE_STATUS[effStatus(t)] || PHONE_STATUS.pending;
            const linked = !!t.patient_id;
            const isOpen = expandedId === t.id;
            return (
              <Fragment key={t.id}>
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-surface-subtle"
                  onClick={() => openEdit(t)}
                >
                  <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-700 flex items-center justify-center text-lg flex-shrink-0">
                    📞
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-900 truncate">
                      {linked
                        ? patientNameById[t.patient_id] || "מטופלת"
                        : t.task_definition || "שיחה ללא זיהוי"}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {formatDate(t.created_at)}
                      {t.caller_phone ? ` · ${t.caller_phone}` : ""}
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="label">מלל המשימה</label>
                        <textarea
                          className="input min-h-[90px] whitespace-pre-wrap"
                          value={draft.task_definition}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, task_definition: e.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="label">שיוך מטופלת</label>
                          <select
                            className="input"
                            value={draft.patient_id}
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
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, hours: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {t.transcription && (
                      <div>
                        <div className="text-xs text-ink-500 mb-1">תמלול מלא</div>
                        <div className="bg-white border border-line rounded-md p-3 text-sm whitespace-pre-wrap leading-6">
                          {t.transcription}
                        </div>
                      </div>
                    )}

                    {t.other_details && (
                      <div className="text-xs text-ink-500">{t.other_details}</div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={saving}
                        onClick={() => save(t, false)}
                      >
                        {saving ? "שומר..." : "שמור"}
                      </button>
                      {effStatus(t) !== "approved" && (
                        <button
                          type="button"
                          className="rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          disabled={saving}
                          onClick={() => save(t, true)}
                        >
                          ✓ אשרי
                        </button>
                      )}
                      {t.recording_url && (
                        <a
                          href={t.recording_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-accent-700 hover:underline font-medium"
                        >
                          🎧 האזנה להקלטה
                        </a>
                      )}
                      <span className="flex-1" />
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => handleDelete(t.id)}
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
