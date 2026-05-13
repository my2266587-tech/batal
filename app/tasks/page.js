"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import {
  ChevronDownIcon,
  DeleteIcon,
  DocumentIcon,
  EditIcon,
  IconButton,
} from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

const MEETING_TYPES = ["פרונטלית", "טלפונית", "וידאו", "ביקור בית", "אחר"];
const STATUSES = ["פתוח", "בוצע", "בוטל"];
const ATTENDANCE = ["נוכח", "לא נוכח", "ביטל", "דחה"];
const PAYMENT_STATUSES = ["לא שולם", "שולם חלקית", "שולם", "לא לחיוב"];
const REMINDER_OPTIONS = [
  { value: 1440, label: "יום לפני" },
  { value: 120, label: "שעתיים לפני" },
  { value: 60, label: "שעה לפני" },
  { value: 30, label: "30 דקות לפני" },
];

const emptyForm = {
  patient_id: "",
  date_gregorian: "",
  date_hebrew: "",
  start_time: "",
  end_time: "",
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
  payment_status: "לא שולם",
  is_future: false,
  send_reminder: false,
  reminder_offset_minutes: "",
};

function calcHoursFromTimes(start, end) {
  if (!start || !end) return null;
  const sp = String(start).split(":").map(Number);
  const ep = String(end).split(":").map(Number);
  if (sp.length < 2 || ep.length < 2) return null;
  const [sh, sm] = sp;
  const [eh, em] = ep;
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return null;
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin < startMin) endMin += 24 * 60; // overnight handling
  return (endMin - startMin) / 60;
}

// Convert a number to Hebrew gematria letters (e.g. 22 -> "כב", 786 -> "תשפו").
// For numbers >= 1000, the thousand is dropped (Hebrew years are millennium 6).
function _hebrewLetters(n) {
  if (n <= 0) return "";
  const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

  const num = n >= 1000 ? n % 1000 : n;
  let out = "";
  const h = Math.floor(num / 100);
  const remaining = num % 100;
  out += HUNDREDS[h] || "";

  if (remaining === 15) {
    out += "טו"; // avoid יה
  } else if (remaining === 16) {
    out += "טז"; // avoid יו
  } else {
    const t = Math.floor(remaining / 10);
    const o = remaining % 10;
    out += TENS[t] + ONES[o];
  }
  return out;
}

// Wrap letters with geresh (single letter) or gershayim (multi-letter).
function formatHebrewGematria(n) {
  const letters = _hebrewLetters(n);
  if (!letters) return "";
  if (letters.length === 1) return letters + "'";
  return letters.slice(0, -1) + '"' + letters.slice(-1);
}

function toHebrewDate(gregStr) {
  if (!gregStr) return "";
  const d = new Date(gregStr);
  if (isNaN(d.getTime())) return "";
  try {
    // Force Latin numerals so we can parse day/year as integers.
    const parts = new Intl.DateTimeFormat("he-u-ca-hebrew-nu-latn", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(d);

    let day = 0;
    let month = "";
    let year = 0;
    for (const p of parts) {
      if (p.type === "day") day = parseInt(p.value, 10);
      else if (p.type === "month") {
        let m = p.value;
        // Some Intl implementations prefix the month with "ב" (e.g., "באייר").
        if (m.startsWith("ב") && m.length > 2) m = m.slice(1);
        month = m;
      } else if (p.type === "year") year = parseInt(p.value, 10);
    }

    if (!day || !month || !year) return "";

    return `${formatHebrewGematria(day)} ${month} ${formatHebrewGematria(year)}`;
  } catch {
    return "";
  }
}

function formatHoursFriendly(hoursNum) {
  if (!Number.isFinite(hoursNum) || hoursNum <= 0) return "";
  const totalMin = Math.round(hoursNum * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  let phrase;
  if (h === 0) {
    phrase = `${m} דקות`;
  } else if (m === 0) {
    if (h === 1) phrase = "שעה אחת";
    else if (h === 2) phrase = "שעתיים";
    else phrase = `${h} שעות`;
  } else {
    let hp;
    if (h === 1) hp = "שעה";
    else if (h === 2) hp = "שעתיים";
    else hp = `${h} שעות`;
    phrase = `${hp} ו-${m} דקות`;
  }
  const numeric = parseFloat(hoursNum.toFixed(2)).toString();
  return `${phrase} (${numeric} שעות)`;
}

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function StatusBadge({ status }) {
  const map = {
    "פתוח": "badge-warning",
    "בוצע": "badge-success",
    "בוטל": "badge-neutral",
  };
  const cls = map[status] || "badge-neutral";
  return <span className={cls}>{status || "—"}</span>;
}

function PaymentBadge({ status }) {
  const map = {
    "שולם": "badge-success",
    "שולם חלקית": "badge-warning",
    "לא שולם": "badge-danger",
    "לא לחיוב": "badge-neutral",
  };
  const cls = map[status] || "badge-neutral";
  return <span className={cls}>{status || "—"}</span>;
}

function DetailField({ label, value }) {
  return (
    <div>
      <div className="text-xs text-ink-500 mb-0.5">{label}</div>
      <div className="text-sm text-ink-900">{value || "—"}</div>
    </div>
  );
}

function DetailBlock({ label, text }) {
  if (!text) return null;
  return (
    <div className="md:col-span-4">
      <div className="text-xs text-ink-500 mb-1.5">{label}</div>
      <div className="bg-white border border-line rounded-md p-3 text-sm whitespace-pre-wrap leading-6">
        {text}
      </div>
    </div>
  );
}

function TaskDetails({ task }) {
  const before = Number(task.total_before_discount) || 0;
  const after = Number(task.total_after_discount) || 0;
  return (
    <div className="p-6 space-y-5 border-t border-line">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DetailField
          label="תאריך לועזי"
          value={formatDate(task.date_gregorian)}
        />
        <DetailField label="תאריך עברי" value={task.date_hebrew} />
        <DetailField
          label="משך"
          value={
            Number(task.hours) > 0
              ? formatHoursFriendly(Number(task.hours))
              : "—"
          }
        />
        <DetailField label="סוג פגישה" value={task.meeting_type} />
        <DetailField
          label="שעת התחלה"
          value={task.start_time ? String(task.start_time).slice(0, 5) : null}
        />
        <DetailField
          label="שעת סיום"
          value={task.end_time ? String(task.end_time).slice(0, 5) : null}
        />
        <DetailField label="נוכחות" value={task.attendance} />
        <DetailField label="נסיעות" value={task.travel} />
        <DetailField
          label="תשלום נסיעה"
          value={formatCurrency(task.travel_payment)}
        />
        <DetailField
          label="סטטוס פגישה"
          value={<StatusBadge status={task.status} />}
        />
        <DetailField
          label="סטטוס תשלום"
          value={<PaymentBadge status={task.payment_status} />}
        />
        <DetailField
          label="סה״כ לפני הנחה"
          value={formatCurrency(before)}
        />
        <DetailField
          label="סה״כ אחרי הנחה"
          value={formatCurrency(after)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <DetailBlock label="הגדרת משימה" text={task.task_definition} />
        <DetailBlock label="פירוט פגישה" text={task.meeting_details} />
        <DetailBlock label="פירוט שיחה" text={task.call_details} />
        <DetailBlock label="פירוט מייל" text={task.email_details} />
        <DetailBlock label="פירוט אחר" text={task.other_details} />
      </div>

      {task.is_future && (
        <div className="card p-4 border-sky-200 bg-sky-50 text-sm">
          <div className="font-semibold text-sky-900 mb-1">פגישה עתידית</div>
          <div className="text-sky-900">
            {task.send_reminder
              ? `תזכורת מתוכננת ${
                  task.reminder_offset_minutes
                    ? task.reminder_offset_minutes >= 1440
                      ? `${Math.round(task.reminder_offset_minutes / 1440)} ימים לפני`
                      : task.reminder_offset_minutes >= 60
                        ? `${Math.round(task.reminder_offset_minutes / 60)} שעות לפני`
                        : `${task.reminder_offset_minutes} דקות לפני`
                    : "(זמן לא הוגדר)"
                }`
              : "ללא תזכורת"}
          </div>
        </div>
      )}

      {task.documents_url && (
        <a
          href={task.documents_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-accent-700 hover:underline font-medium"
        >
          <DocumentIcon className="w-4 h-4" />
          פתיחת מסמך מצורף
        </a>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [hebrewManual, setHebrewManual] = useState(false);

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
        .order("start_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("patients")
        .select(
          "id, full_name, status, treatment_type, hourly_rate, hourly_rate_discounted",
        )
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

      // Auto-fill Hebrew date from gregorian (unless user edited it manually)
      if (field === "date_gregorian" && !hebrewManual) {
        next.date_hebrew = value ? toHebrewDate(value) : "";
      }

      // Auto-calc hours when start_time / end_time change
      if (field === "start_time" || field === "end_time") {
        const calc = calcHoursFromTimes(
          field === "start_time" ? value : next.start_time,
          field === "end_time" ? value : next.end_time,
        );
        if (calc !== null) {
          next.hours = calc.toFixed(2);
        }
      }

      // Recompute totals when patient_id / hours / time changes
      if (
        field === "patient_id" ||
        field === "hours" ||
        field === "start_time" ||
        field === "end_time"
      ) {
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
    if (field === "date_hebrew") {
      setHebrewManual(true);
    }
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function openAddForm() {
    resetForm();
    setError("");
    setFormOpen(true);
    setHebrewManual(false);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
    setError("");
    setHebrewManual(false);
  }

  function startEdit(t) {
    setEditingId(t.id);
    setForm({
      patient_id: t.patient_id || "",
      date_gregorian: t.date_gregorian || "",
      date_hebrew: t.date_hebrew || "",
      start_time: t.start_time ? String(t.start_time).slice(0, 5) : "",
      end_time: t.end_time ? String(t.end_time).slice(0, 5) : "",
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
      payment_status: t.payment_status || "לא שולם",
      is_future: !!t.is_future,
      send_reminder: !!t.send_reminder,
      reminder_offset_minutes: t.reminder_offset_minutes ?? "",
    });
    setFormOpen(true);
    setHebrewManual(!!t.date_hebrew);
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
      start_time: form.start_time || null,
      end_time: form.end_time || null,
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
      payment_status: form.payment_status || "לא שולם",
      is_future: !!form.is_future,
      send_reminder: !!form.send_reminder,
      reminder_offset_minutes:
        form.reminder_offset_minutes === ""
          ? null
          : Number(form.reminder_offset_minutes),
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
      closeForm();
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

  const activePatientsCount = useMemo(
    () => patients.filter((p) => (p.status || "פעיל") === "פעיל").length,
    [patients],
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">סה״כ מוצג: {filtered.length}</span>
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={openAddForm}>
              + הוספת משימה
            </button>
          )}
        </div>
      </header>

      {formOpen && (
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
            <label className="label">שעת התחלה</label>
            <input
              type="time"
              className="input"
              value={form.start_time}
              onChange={(e) => update("start_time", e.target.value)}
            />
          </div>
          <div>
            <label className="label">שעת סיום</label>
            <input
              type="time"
              className="input"
              value={form.end_time}
              onChange={(e) => update("end_time", e.target.value)}
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
            {form.hours && Number(form.hours) > 0 && (
              <p className="text-xs text-ink-700 mt-1 font-medium">
                משך: {formatHoursFriendly(Number(form.hours))}
              </p>
            )}
            {form.start_time && form.end_time && (
              <p className="text-[11px] text-ink-500 mt-0.5">
                חושב מתוך שעת התחלה וסיום; ניתן לדרוס ידנית.
              </p>
            )}
            {selectedPatient && (
              <p className="text-xs text-ink-500 mt-1">
                {selectedPatient.treatment_type
                  ? `${selectedPatient.treatment_type} · `
                  : ""}
                תעריף: {selectedPatient.hourly_rate != null
                  ? formatCurrency(selectedPatient.hourly_rate)
                  : "—"}
                {selectedPatient.hourly_rate_discounted != null
                  ? ` · אחרי הנחה: ${formatCurrency(
                      selectedPatient.hourly_rate_discounted,
                    )}`
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
            <label className="label">סטטוס פגישה</label>
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
            <label className="label">סטטוס תשלום</label>
            <select
              className="input"
              value={form.payment_status}
              onChange={(e) => update("payment_status", e.target.value)}
            >
              {PAYMENT_STATUSES.map((s) => (
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

        <div className="border-t border-line pt-5 space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_future}
              onChange={(e) => update("is_future", e.target.checked)}
            />
            <span className="text-sm font-medium text-ink-900">
              פגישה עתידית
            </span>
          </label>

          {form.is_future && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pr-6">
              <label className="flex items-center gap-2 md:col-span-1">
                <input
                  type="checkbox"
                  checked={form.send_reminder}
                  onChange={(e) =>
                    update("send_reminder", e.target.checked)
                  }
                />
                <span className="text-sm text-ink-900">שלח תזכורת במייל</span>
              </label>
              {form.send_reminder && (
                <div className="md:col-span-2">
                  <label className="label">מתי לשלוח</label>
                  <select
                    className="input"
                    value={form.reminder_offset_minutes}
                    onChange={(e) =>
                      update("reminder_offset_minutes", e.target.value)
                    }
                  >
                    <option value="">— בחרי —</option>
                    {REMINDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-ink-500 mt-1">
                    שליחה אמיתית עוד לא מחוברת — הערכים נשמרים בלבד.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red-700 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "שומר..." : editingId ? "עדכן משימה" : "שמור משימה"}
          </button>
          <button type="button" className="btn-ghost" onClick={closeForm}>
            ביטול
          </button>
        </div>
      </form>
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-label">סך שעות</div>
          <div className="stat-value">{totals.hours.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">משימות / פגישות</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">מטופלות פעילות</div>
          <div className="stat-value">{activePatientsCount}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>תאריך</th>
              <th>מטופל</th>
              <th>משימה</th>
              <th>סוג פגישה</th>
              <th>שעות</th>
              <th>תשלום</th>
              <th>סטטוס תשלום</th>
              <th>סטטוס</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="text-center text-ink-500 py-6">
                  טוען...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center text-ink-500 py-6">
                  אין משימות להצגה
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const isExpanded = expandedId === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr
                      onClick={() =>
                        setExpandedId(isExpanded ? null : t.id)
                      }
                      className="cursor-pointer"
                    >
                      <td className="text-center">
                        <ChevronDownIcon
                          className={
                            "w-4 h-4 text-ink-400 transition-transform inline-block " +
                            (isExpanded ? "rotate-180" : "")
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {formatDate(t.date_gregorian)}
                        {t.date_hebrew && (
                          <div className="text-xs text-ink-500">
                            {t.date_hebrew}
                          </div>
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
                      <td>{t.meeting_type || "—"}</td>
                      <td>{Number(t.hours || 0).toFixed(2)}</td>
                      <td className="font-semibold">
                        {formatCurrency(t.total_after_discount)}
                      </td>
                      <td>
                        <PaymentBadge status={t.payment_status} />
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                      <td>
                        <div
                          className="flex gap-1 justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconButton
                            variant="edit"
                            title="עריכה"
                            onClick={() => startEdit(t)}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            variant="delete"
                            title="מחיקה"
                            onClick={() => handleDelete(t.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="bg-surface-subtle p-0">
                          <TaskDetails task={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
