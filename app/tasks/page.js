"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";

const MEETING_TYPES = ["פרונטלית", "טלפונית", "וידאו", "ביקור בית", "אחר"];
const STATUSES = ["פתוח", "בוצע", "בוטל"];
const ATTENDANCE = ["נוכח", "לא נוכח", "ביטל", "דחה"];

const emptyForm = {
  patient_id: "",
  date_gregorian: "",
  date_hebrew: "",
  hours: "",
  task_definition: "",
  meeting_details: "",
  meeting_type: "",
  travel: "",
  travel_payment: "",
  call_details: "",
  email_details: "",
  other_details: "",
  attendance: "",
  documents_url: "",
  total_before_discount: "",
  total_after_discount: "",
  status: "פתוח",
};

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  // filters
  const [filterPatient, setFilterPatient] = useState("");
  const [filterMeetingType, setFilterMeetingType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

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
        .order("date_gregorian", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("patients")
        .select("id, full_name, treatment_type, hourly_rate, hourly_rate_discounted")
        .order("full_name"),
    ]);
    if (tRes.error) setError(tRes.error.message);
    if (pRes.error) setError(pRes.error.message);
    setTasks(tRes.data || []);
    setPatients(pRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function computeTotals(patientId, hoursVal) {
    const p = patients.find((x) => x.id === patientId);
    const h = Number(hoursVal);
    if (!p || !Number.isFinite(h)) return null;
    const rate = Number(p.hourly_rate);
    if (!Number.isFinite(rate)) return null;
    const rateDisc =
      p.hourly_rate_discounted != null && p.hourly_rate_discounted !== ""
        ? Number(p.hourly_rate_discounted)
        : rate;
    return {
      before: (h * rate).toFixed(2),
      after: (h * (Number.isFinite(rateDisc) ? rateDisc : rate)).toFixed(2),
    };
  }

  function update(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "patient_id" || field === "hours") {
        const totals = computeTotals(
          field === "patient_id" ? value : next.patient_id,
          field === "hours" ? value : next.hours,
        );
        if (totals) {
          next.total_before_discount = totals.before;
          next.total_after_discount = totals.after;
        }
      }
      return next;
    });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(t) {
    setEditingId(t.id);
    setForm({
      patient_id: t.patient_id || "",
      date_gregorian: t.date_gregorian || "",
      date_hebrew: t.date_hebrew || "",
      hours: t.hours ?? "",
      task_definition: t.task_definition || "",
      meeting_details: t.meeting_details || "",
      meeting_type: t.meeting_type || "",
      travel: t.travel || "",
      travel_payment: t.travel_payment ?? "",
      call_details: t.call_details || "",
      email_details: t.email_details || "",
      other_details: t.other_details || "",
      attendance: t.attendance || "",
      documents_url: t.documents_url || "",
      total_before_discount: t.total_before_discount ?? "",
      total_after_discount: t.total_after_discount ?? "",
      status: t.status || "פתוח",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleUpload(file) {
    if (!file) return null;
    const path = `tasks/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const { data, error } = await supabase.storage
      .from("documents")
      .upload(path, file, { upsert: false });
    if (error) {
      setError("העלאת קובץ נכשלה: " + error.message);
      return null;
    }
    const { data: pub } = supabase.storage
      .from("documents")
      .getPublicUrl(data.path);
    return pub?.publicUrl || null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const payload = {
      patient_id: form.patient_id || null,
      date_gregorian: form.date_gregorian || null,
      date_hebrew: form.date_hebrew || null,
      hours: toNumber(form.hours),
      task_definition: form.task_definition || null,
      meeting_details: form.meeting_details || null,
      meeting_type: form.meeting_type || null,
      travel: form.travel || null,
      travel_payment: toNumber(form.travel_payment),
      call_details: form.call_details || null,
      email_details: form.email_details || null,
      other_details: form.other_details || null,
      attendance: form.attendance || null,
      documents_url: form.documents_url || null,
      total_before_discount: toNumber(form.total_before_discount),
      total_after_discount: toNumber(form.total_after_discount),
      status: form.status || "פתוח",
    };

    let res;
    if (editingId) {
      res = await supabase.from("tasks").update(payload).eq("id", editingId);
    } else {
      res = await supabase.from("tasks").insert([payload]);
    }
    if (res.error) setError(res.error.message);
    setSaving(false);
    if (!res.error) {
      resetForm();
      load();
    }
  }

  async function handleDelete(id) {
    if (!confirm("למחוק את המשימה?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === form.patient_id) || null,
    [patients, form.patient_id],
  );

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterPatient && t.patient_id !== filterPatient) return false;
      if (filterMeetingType && t.meeting_type !== filterMeetingType)
        return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterDateFrom && (!t.date_gregorian || t.date_gregorian < filterDateFrom))
        return false;
      if (filterDateTo && (!t.date_gregorian || t.date_gregorian > filterDateTo))
        return false;
      return true;
    });
  }, [tasks, filterPatient, filterMeetingType, filterStatus, filterDateFrom, filterDateTo]);

  const totals = useMemo(() => {
    let hours = 0,
      travel = 0,
      sumBefore = 0,
      sumAfter = 0;
    filtered.forEach((t) => {
      hours += Number(t.hours) || 0;
      travel += Number(t.travel_payment) || 0;
      sumBefore += Number(t.total_before_discount) || 0;
      sumAfter += Number(t.total_after_discount) || 0;
    });
    return { hours, travel, sumBefore, sumAfter };
  }, [filtered]);

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">ניהול משימות</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">ניהול משימות</h1>
          <p className="page-subtitle">ניהול פגישות ומשימות עבור כל המטופלים.</p>
        </div>
        <span className="text-sm text-ink-500">סה״כ מוצג: {filtered.length}</span>
      </header>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <h2 className="section-title">
          {editingId ? "עריכת משימה" : "הוספת משימה"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="label">מטופל</label>
            <select
              className="input"
              value={form.patient_id}
              onChange={(e) => update("patient_id", e.target.value)}
            >
              <option value="">— בחר —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">תאריך לועזי</label>
            <input
              type="date"
              className="input"
              value={form.date_gregorian}
              onChange={(e) => update("date_gregorian", e.target.value)}
            />
          </div>
          <div>
            <label className="label">תאריך עברי</label>
            <input
              className="input"
              placeholder="לדוגמה: כ״ז ניסן ה׳תשפ״ה"
              value={form.date_hebrew}
              onChange={(e) => update("date_hebrew", e.target.value)}
            />
          </div>

          <div>
            <label className="label">משך שעות</label>
            <input
              type="number"
              step="0.25"
              min="0"
              className="input"
              placeholder="לדוגמה: 1.5"
              value={form.hours}
              onChange={(e) => update("hours", e.target.value)}
            />
            {selectedPatient && (
              <p className="text-xs text-ink-500 mt-1">
                {selectedPatient.treatment_type
                  ? `${selectedPatient.treatment_type} · `
                  : ""}
                תעריף: {selectedPatient.hourly_rate != null
                  ? `₪${Number(selectedPatient.hourly_rate).toFixed(2)}`
                  : "—"}
                {selectedPatient.hourly_rate_discounted != null
                  ? ` · אחרי הנחה: ₪${Number(
                      selectedPatient.hourly_rate_discounted,
                    ).toFixed(2)}`
                  : ""}
              </p>
            )}
          </div>
          <div>
            <label className="label">סוג פגישה</label>
            <select
              className="input"
              value={form.meeting_type}
              onChange={(e) => update("meeting_type", e.target.value)}
            >
              <option value="">— בחר —</option>
              {MEETING_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">נוכחות</label>
            <select
              className="input"
              value={form.attendance}
              onChange={(e) => update("attendance", e.target.value)}
            >
              <option value="">— בחר —</option>
              {ATTENDANCE.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="label">הגדרת משימה</label>
            <textarea
              className="input min-h-[120px] whitespace-pre-wrap"
              value={form.task_definition}
              onChange={(e) => update("task_definition", e.target.value)}
            />
          </div>

          <div className="md:col-span-3">
            <label className="label">פירוט פגישה</label>
            <textarea
              className="input min-h-[120px] whitespace-pre-wrap"
              value={form.meeting_details}
              onChange={(e) => update("meeting_details", e.target.value)}
            />
          </div>

          <div>
            <label className="label">נסיעות</label>
            <input
              className="input"
              value={form.travel}
              onChange={(e) => update("travel", e.target.value)}
            />
          </div>
          <div>
            <label className="label">תשלום נסיעה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.travel_payment}
              onChange={(e) => update("travel_payment", e.target.value)}
            />
          </div>
          <div>
            <label className="label">סטטוס</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">פירוט שיחה</label>
            <textarea
              className="input min-h-[120px] whitespace-pre-wrap"
              value={form.call_details}
              onChange={(e) => update("call_details", e.target.value)}
            />
          </div>
          <div>
            <label className="label">פירוט מייל</label>
            <textarea
              className="input min-h-[120px] whitespace-pre-wrap"
              value={form.email_details}
              onChange={(e) => update("email_details", e.target.value)}
            />
          </div>
          <div>
            <label className="label">פירוט אחר</label>
            <textarea
              className="input min-h-[120px] whitespace-pre-wrap"
              value={form.other_details}
              onChange={(e) => update("other_details", e.target.value)}
            />
          </div>

          <div className="md:col-span-3">
            <label className="label">מסמכים חשובים — קישור או העלאת קובץ</label>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                className="input flex-1"
                placeholder="הדבק קישור או העלה קובץ"
                value={form.documents_url}
                onChange={(e) => update("documents_url", e.target.value)}
              />
              <input
                type="file"
                className="text-sm"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = await handleUpload(f);
                  if (url) update("documents_url", url);
                }}
              />
            </div>
            <p className="text-xs text-ink-500 mt-1">
              להעלאת קבצים יש ליצור Bucket ציבורי בשם <b>documents</b> ב-Supabase Storage.
            </p>
          </div>

          <div>
            <label className="label">סה״כ לתשלום לפני הנחה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.total_before_discount}
              onChange={(e) => update("total_before_discount", e.target.value)}
            />
          </div>
          <div>
            <label className="label">סה״כ לתשלום אחרי הנחה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.total_after_discount}
              onChange={(e) => update("total_after_discount", e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-red-700 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "שומר..." : editingId ? "עדכן משימה" : "שמור משימה"}
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={resetForm}>
              ביטול
            </button>
          )}
        </div>
      </form>

      <div className="card p-5 space-y-4">
        <h2 className="section-title">סינון</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="label">מטופל</label>
            <select
              className="input"
              value={filterPatient}
              onChange={(e) => setFilterPatient(e.target.value)}
            >
              <option value="">הכל</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">סוג פגישה</label>
            <select
              className="input"
              value={filterMeetingType}
              onChange={(e) => setFilterMeetingType(e.target.value)}
            >
              <option value="">הכל</option>
              {MEETING_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">סטטוס</label>
            <select
              className="input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">הכל</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">מתאריך</label>
            <input
              type="date"
              className="input"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">עד תאריך</label>
            <input
              type="date"
              className="input"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-label">סך שעות</div>
          <div className="stat-value">{totals.hours.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">סך נסיעות</div>
          <div className="stat-value">₪{totals.travel.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">לפני הנחה</div>
          <div className="stat-value">₪{totals.sumBefore.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">אחרי הנחה</div>
          <div className="stat-value">₪{totals.sumAfter.toFixed(2)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>מטופל</th>
              <th>משימה</th>
              <th>סוג פגישה</th>
              <th>שעות</th>
              <th>נוכחות</th>
              <th>נסיעה</th>
              <th>לפני הנחה</th>
              <th>אחרי הנחה</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="text-center text-ink-500 py-6">
                  טוען...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center text-ink-500 py-6">
                  אין משימות להצגה
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">
                    {t.date_gregorian
                      ? new Date(t.date_gregorian).toLocaleDateString("he-IL")
                      : ""}
                    {t.date_hebrew && (
                      <div className="text-xs text-ink-500">{t.date_hebrew}</div>
                    )}
                  </td>
                  <td className="font-medium">
                    {patientNameById[t.patient_id] || "—"}
                  </td>
                  <td className="max-w-xs">
                    <div className="line-clamp-2 text-sm whitespace-pre-wrap">
                      {t.task_definition || "—"}
                    </div>
                  </td>
                  <td>{t.meeting_type}</td>
                  <td>{Number(t.hours || 0).toFixed(2)}</td>
                  <td>{t.attendance}</td>
                  <td>₪{Number(t.travel_payment || 0).toFixed(2)}</td>
                  <td>₪{Number(t.total_before_discount || 0).toFixed(2)}</td>
                  <td>₪{Number(t.total_after_discount || 0).toFixed(2)}</td>
                  <td>{t.status}</td>
                  <td>
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn-ghost text-xs px-3 py-1"
                        onClick={() => startEdit(t)}
                      >
                        עריכה
                      </button>
                      <button
                        className="btn-danger text-xs px-3 py-1"
                        onClick={() => handleDelete(t.id)}
                      >
                        מחיקה
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
