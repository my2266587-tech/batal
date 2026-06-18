"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import heLocale from "@fullcalendar/core/locales/he";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";

// Load FullCalendar only on the client to avoid SSR mismatches.
const FullCalendar = dynamic(() => import("@fullcalendar/react"), {
  ssr: false,
  loading: () => (
    <div className="py-24 text-center text-ink-500">טוען לוח שנה...</div>
  ),
});

const STATUSES = [
  { value: "pending", label: "פתוח" },
  { value: "completed", label: "הושלם" },
  { value: "cancelled", label: "בוטל" },
];

const PRIORITIES = [
  { value: "low", label: "נמוכה" },
  { value: "normal", label: "רגילה" },
  { value: "high", label: "גבוהה" },
  { value: "urgent", label: "דחוף" },
];

const PRIORITY_COLOR = {
  low: { bg: "#94A3B8", border: "#64748B" },
  normal: { bg: "#3F7FA3", border: "#326684" },
  high: { bg: "#EA580C", border: "#C2410C" },
  urgent: { bg: "#DC2626", border: "#991B1B" },
};

const STATUS_COLOR = {
  completed: { bg: "#10B981", border: "#047857" },
  cancelled: { bg: "#9CA3AF", border: "#6B7280" },
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateToYMD(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeFromISO(iso) {
  // Extract HH:MM from ISO-like "2026-05-29T14:30:00"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = {
  title: "",
  description: "",
  patient_id: "",
  event_date: "",
  start_time: "",
  end_time: "",
  all_day: false,
  status: "pending",
  priority: "normal",
};

export default function CalendarPage() {
  const calendarRef = useRef(null);
  const [patients, setPatients] = useState([]);
  const [setupChecked, setSetupChecked] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterPatient, setFilterPatient] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSetupChecked(true);
    if (!supabaseReady) return;
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, full_name")
        .order("full_name");
      setPatients(data || []);
    })();
  }, []);

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

  /* ===== Fetching events for visible range ===== */
  async function fetchEvents(fetchInfo, successCb, failureCb) {
    if (!supabaseReady) {
      successCb([]);
      return;
    }
    // FullCalendar passes start/end as Date covering the visible window.
    const startYMD = dateToYMD(fetchInfo.start);
    const endYMD = dateToYMD(
      new Date(fetchInfo.end.getTime() - 24 * 60 * 60 * 1000),
    );
    let q = supabase
      .from("calendar_events")
      .select("*")
      .gte("event_date", startYMD)
      .lte("event_date", endYMD);
    if (filterStatus) q = q.eq("status", filterStatus);
    if (filterPriority) q = q.eq("priority", filterPriority);
    if (filterPatient) q = q.eq("patient_id", filterPatient);
    const { data, error } = await q;
    if (error) {
      console.error("[calendar] fetch error:", error);
      failureCb(error);
      return;
    }
    const term = searchTerm.trim().toLowerCase();
    const filtered = (data || []).filter((e) => {
      if (!term) return true;
      const hay = [
        e.title,
        e.description,
        patientNameById[e.patient_id],
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(term);
    });
    const fcEvents = filtered.map((e) => {
      const color =
        e.status === "completed" || e.status === "cancelled"
          ? STATUS_COLOR[e.status]
          : PRIORITY_COLOR[e.priority] || PRIORITY_COLOR.normal;
      const start = e.all_day
        ? e.event_date
        : `${e.event_date}T${e.start_time || "00:00:00"}`;
      const end = e.all_day
        ? null
        : e.end_time
          ? `${e.event_date}T${e.end_time}`
          : null;
      return {
        id: e.id,
        title: e.title + (e.patient_id ? ` · ${patientNameById[e.patient_id] || ""}` : ""),
        start,
        end,
        allDay: !!e.all_day,
        backgroundColor: color.bg,
        borderColor: color.border,
        textColor: "#ffffff",
        classNames: e.status === "completed" ? ["fc-event-completed"] : [],
        extendedProps: { raw: e },
      };
    });
    successCb(fcEvents);
  }

  /* ===== Refetch when filters change ===== */
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (api) api.refetchEvents();
  }, [filterStatus, filterPriority, filterPatient, searchTerm]);

  /* ===== Click empty cell → open form for new event ===== */
  function handleDateClick(info) {
    setEditingId(null);
    setForm({
      ...emptyForm,
      event_date: info.dateStr.slice(0, 10),
      all_day: info.allDay,
      start_time: info.allDay ? "" : timeFromISO(info.dateStr) || "",
      end_time: "",
    });
    setError("");
    setModalOpen(true);
  }

  /* ===== Drag to select range (timeGrid views) ===== */
  function handleSelect(info) {
    setEditingId(null);
    setForm({
      ...emptyForm,
      event_date: info.startStr.slice(0, 10),
      all_day: info.allDay,
      start_time: info.allDay ? "" : info.startStr.slice(11, 16),
      end_time: info.allDay ? "" : info.endStr.slice(11, 16),
    });
    setError("");
    setModalOpen(true);
  }

  /* ===== Click event → open form for edit ===== */
  function handleEventClick(info) {
    const raw = info.event.extendedProps?.raw;
    if (!raw) return;
    setEditingId(raw.id);
    setForm({
      title: raw.title || "",
      description: raw.description || "",
      patient_id: raw.patient_id || "",
      event_date: raw.event_date || "",
      start_time: raw.start_time ? String(raw.start_time).slice(0, 5) : "",
      end_time: raw.end_time ? String(raw.end_time).slice(0, 5) : "",
      all_day: !!raw.all_day,
      status: raw.status || "pending",
      priority: raw.priority || "normal",
    });
    setError("");
    setModalOpen(true);
  }

  /* ===== Drag event between days/hours ===== */
  async function handleEventDrop(info) {
    const ev = info.event;
    const newDate = ev.startStr.slice(0, 10);
    let newStart = null;
    let newEnd = null;
    let allDay = ev.allDay;
    if (!allDay) {
      newStart = ev.startStr.slice(11, 16);
      newEnd = ev.end ? ev.endStr.slice(11, 16) : null;
    }
    const { error } = await supabase
      .from("calendar_events")
      .update({
        event_date: newDate,
        start_time: newStart,
        end_time: newEnd,
        all_day: allDay,
      })
      .eq("id", ev.id);
    if (error) {
      console.error("[calendar] drop save failed:", error);
      alert("שמירה נכשלה אחרי גרירה — החזרה לפוזיציה הקודמת.\n\n" + error.message);
      info.revert();
    }
  }

  /* ===== Resize event (drag the edge) → change end_time ===== */
  async function handleEventResize(info) {
    const ev = info.event;
    const newEnd = ev.end ? ev.endStr.slice(11, 16) : null;
    const newStart = ev.startStr.slice(11, 16);
    const { error } = await supabase
      .from("calendar_events")
      .update({ start_time: newStart, end_time: newEnd })
      .eq("id", ev.id);
    if (error) {
      console.error("[calendar] resize save failed:", error);
      alert("שינוי משך נכשל — החזרה לאורך הקודם.\n\n" + error.message);
      info.revert();
    }
  }

  /* ===== Modal: save / delete / complete ===== */
  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("יש להזין כותרת");
      return;
    }
    if (!form.event_date) {
      setError("יש לבחור תאריך");
      return;
    }
    setError("");
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      patient_id: form.patient_id || null,
      event_date: form.event_date,
      start_time: form.all_day ? null : form.start_time || null,
      end_time: form.all_day ? null : form.end_time || null,
      all_day: !!form.all_day,
      status: form.status,
      priority: form.priority,
      completed_at: form.status === "completed" ? new Date().toISOString() : null,
    };
    let res;
    if (editingId) {
      res = await supabase
        .from("calendar_events")
        .update(payload)
        .eq("id", editingId);
    } else {
      res = await supabase.from("calendar_events").insert([payload]);
    }
    setSaving(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    closeModal();
    calendarRef.current?.getApi()?.refetchEvents();
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm("למחוק את האירוע?")) return;
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", editingId);
    if (error) {
      setError(error.message);
      return;
    }
    closeModal();
    calendarRef.current?.getApi()?.refetchEvents();
  }

  async function toggleComplete() {
    if (!editingId) return;
    const newStatus = form.status === "completed" ? "pending" : "completed";
    const { error } = await supabase
      .from("calendar_events")
      .update({
        status: newStatus,
        completed_at: newStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", editingId);
    if (error) {
      setError(error.message);
      return;
    }
    closeModal();
    calendarRef.current?.getApi()?.refetchEvents();
  }

  if (!setupChecked) return null;
  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">לוח שנה</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">לוח שנה</h1>
          <p className="page-subtitle">
            ניהול משימות ואירועים עתידיים — לחיצה על תאריך כדי להוסיף, גרירה
            כדי להזיז, משיכת קצה לשינוי משך.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditingId(null);
            const today = new Date();
            setForm({
              ...emptyForm,
              event_date: dateToYMD(today),
            });
            setError("");
            setModalOpen(true);
          }}
        >
          + אירוע חדש
        </button>
      </header>

      {/* Filters */}
      <div className="card p-5 space-y-4">
        <input
          type="search"
          placeholder="חיפוש בכותרת / תיאור / שם מטופלת..."
          className="input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">סטטוס</label>
            <select
              className="input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">הכל</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">עדיפות</label>
            <select
              className="input"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="">הכל</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">מטופלת</label>
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
        </div>
      </div>

      <div className="card p-3 md:p-5 calendar-host">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={heLocale}
          direction="rtl"
          firstDay={0}
          height="auto"
          headerToolbar={{
            right: "prev,next today",
            center: "title",
            left: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "היום",
            month: "חודש",
            week: "שבוע",
            day: "יום",
            list: "רשימה",
          }}
          allDayText="כל היום"
          noEventsText="אין אירועים בטווח זה"
          slotLabelFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          selectable={true}
          editable={true}
          dayMaxEvents={3}
          nowIndicator={true}
          events={fetchEvents}
          dateClick={handleDateClick}
          select={handleSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
        />
      </div>

      {/* Modal — also accessible without drag, via "אירוע חדש" or click */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="card p-6 space-y-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="section-title">
                {editingId ? "עריכת אירוע" : "אירוע חדש"}
              </h2>
              {editingId && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={toggleComplete}
                    className={
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                      (form.status === "completed"
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-white border border-line text-ink-700 hover:bg-emerald-50 hover:text-emerald-700")
                    }
                  >
                    {form.status === "completed"
                      ? "✓ הושלם — לבטל"
                      : "סמני כהושלם"}
                  </button>
                  <IconButton
                    variant="delete"
                    title="מחיקה"
                    onClick={handleDelete}
                  >
                    <DeleteIcon />
                  </IconButton>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="label">כותרת *</label>
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">תיאור</label>
                <textarea
                  className="input min-h-[80px]"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                />
              </div>
              <div>
                <label className="label">מטופלת</label>
                <select
                  className="input"
                  value={form.patient_id}
                  onChange={(e) => updateField("patient_id", e.target.value)}
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
                <label className="label">עדיפות</label>
                <select
                  className="input"
                  value={form.priority}
                  onChange={(e) => updateField("priority", e.target.value)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">תאריך *</label>
                <input
                  type="date"
                  className="input"
                  value={form.event_date}
                  onChange={(e) => updateField("event_date", e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">סטטוס</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.all_day}
                    onChange={(e) => updateField("all_day", e.target.checked)}
                  />
                  <span className="text-sm font-medium text-ink-900">
                    כל היום (ללא שעות)
                  </span>
                </label>
              </div>
              {!form.all_day && (
                <>
                  <div>
                    <label className="label">שעת התחלה</label>
                    <input
                      type="time"
                      className="input"
                      value={form.start_time}
                      onChange={(e) =>
                        updateField("start_time", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="label">שעת סיום</label>
                    <input
                      type="time"
                      className="input"
                      value={form.end_time}
                      onChange={(e) => updateField("end_time", e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "שומר..." : editingId ? "עדכון" : "יצירה"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeModal}
                disabled={saving}
              >
                ביטול
              </button>
            </div>
          </form>
        </div>
      )}

      <style jsx global>{`
        .calendar-host .fc {
          font-family: inherit;
        }
        .calendar-host .fc-toolbar-title {
          font-size: 1.125rem;
          font-weight: 700;
        }
        .calendar-host .fc-button {
          background: white;
          border: 1px solid #e2e8f0;
          color: #334155;
          text-transform: none;
          padding: 0.4rem 0.8rem;
          font-weight: 500;
        }
        .calendar-host .fc-button:hover:not(:disabled) {
          background: #f8fafc;
          color: #ea580c;
        }
        .calendar-host .fc-button-primary:not(:disabled).fc-button-active,
        .calendar-host .fc-button-primary:not(:disabled):active {
          background: #ea580c;
          border-color: #ea580c;
          color: white;
        }
        .calendar-host .fc-event {
          cursor: pointer;
          font-size: 0.78rem;
          padding: 2px 4px;
        }
        .calendar-host .fc-event-completed {
          opacity: 0.55;
          text-decoration: line-through;
        }
        .calendar-host .fc-day-today {
          background: #fff7ed !important;
        }
        @media (max-width: 768px) {
          .calendar-host .fc-toolbar {
            flex-wrap: wrap;
            gap: 0.5rem;
          }
          .calendar-host .fc-toolbar-chunk {
            display: flex;
            justify-content: center;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
