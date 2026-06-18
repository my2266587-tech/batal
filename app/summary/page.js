"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import {
  formatCurrency,
  formatDate,
  formatDecimalHoursAsHHMM,
} from "@/lib/format";

function EventsList({ title, items, patientNameById, tone }) {
  const toneClass =
    tone === "overdue"
      ? "border-red-200 bg-red-50"
      : tone === "today"
        ? "border-accent-200 bg-accent-50"
        : "border-line bg-white";
  const titleClass =
    tone === "overdue"
      ? "text-red-800"
      : tone === "today"
        ? "text-accent-700"
        : "text-ink-900";
  return (
    <div className={`card border ${toneClass}`}>
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <h3 className={`section-title text-base ${titleClass}`}>{title}</h3>
        <Link
          href="/calendar"
          className="text-xs text-accent-700 hover:underline"
        >
          לוח השנה ←
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="p-5 text-sm text-ink-500">אין אירועים</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((ev) => (
            <li key={ev.id} className="px-5 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink-900 flex-1 line-clamp-1">
                  {ev.title}
                </span>
                {ev.priority === "urgent" && (
                  <span className="badge-warning">דחוף</span>
                )}
              </div>
              <div className="text-xs text-ink-500 mt-0.5">
                {(() => {
                  const [y, m, d] = String(ev.event_date)
                    .slice(0, 10)
                    .split("-");
                  return `${d}/${m}/${y}`;
                })()}
                {ev.start_time && ` · ${String(ev.start_time).slice(0, 5)}`}
                {ev.patient_id && patientNameById[ev.patient_id] && (
                  <> · {patientNameById[ev.patient_id]}</>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SummaryPage() {
  const [tasks, setTasks] = useState([]);
  const [patients, setPatients] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    async function load() {
      if (!supabaseReady) {
        setLoading(false);
        return;
      }
      // Pull calendar events from 30 days back to 14 days ahead — that's
      // enough for today / upcoming / overdue without loading everything.
      const today = new Date();
      const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const to = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
      const fromYMD = from.toISOString().slice(0, 10);
      const toYMD = to.toISOString().slice(0, 10);
      const [tRes, pRes, eRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .order("date_gregorian", { ascending: false, nullsFirst: false })
          .order("start_time", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("patients")
          .select("id, full_name, status")
          .order("full_name"),
        supabase
          .from("calendar_events")
          .select("*")
          .gte("event_date", fromYMD)
          .lte("event_date", toYMD)
          .order("event_date", { ascending: true })
          .order("start_time", { ascending: true, nullsFirst: false }),
      ]);
      setTasks(tRes.data || []);
      setPatients(pRes.data || []);
      setEvents(eRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

  const todayYMD = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayEvents = useMemo(
    () => events.filter((e) => e.event_date === todayYMD && e.status !== "cancelled"),
    [events, todayYMD],
  );
  const overdueEvents = useMemo(
    () =>
      events.filter(
        (e) => e.event_date < todayYMD && e.status === "pending",
      ),
    [events, todayYMD],
  );
  const upcomingEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.event_date > todayYMD &&
          e.status !== "cancelled" &&
          e.status !== "completed",
      ),
    [events, todayYMD],
  );

  const activePatients = useMemo(
    () =>
      patients.filter((p) => (p.status || "פעיל") === "פעיל").length,
    [patients],
  );

  const monthly = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    let hours = 0,
      before = 0,
      after = 0,
      travel = 0;
    tasks.forEach((t) => {
      if (!t.date_gregorian) return;
      const d = new Date(t.date_gregorian);
      if (d < monthStart || d >= monthEnd) return;
      hours += Number(t.hours) || 0;
      before += Number(t.total_before_discount) || 0;
      after += Number(t.total_after_discount) || 0;
      travel += Number(t.travel_payment) || 0;
    });
    return { hours, before, after, travel };
  }, [tasks]);

  const byPatient = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      const key = t.patient_id || "unknown";
      if (!map.has(key)) {
        map.set(key, {
          id: t.patient_id,
          name: patientNameById[t.patient_id] || "ללא שיוך",
          hours: 0,
          before: 0,
          after: 0,
          travel: 0,
          count: 0,
          latestDate: null,
        });
      }
      const row = map.get(key);
      row.hours += Number(t.hours) || 0;
      row.before += Number(t.total_before_discount) || 0;
      row.after += Number(t.total_after_discount) || 0;
      row.travel += Number(t.travel_payment) || 0;
      row.count += 1;
      if (
        t.date_gregorian &&
        (!row.latestDate || t.date_gregorian > row.latestDate)
      ) {
        row.latestDate = t.date_gregorian;
      }
    });
    // Sort by latest task date descending (newest first); patients with no
    // dated tasks go to the end.
    return Array.from(map.values()).sort((a, b) => {
      if (a.latestDate && b.latestDate)
        return b.latestDate.localeCompare(a.latestDate);
      if (a.latestDate) return -1;
      if (b.latestDate) return 1;
      return 0;
    });
  }, [tasks, patientNameById]);

  const filteredByPatient = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return byPatient;
    return byPatient.filter((r) =>
      String(r.name || "").toLowerCase().includes(q),
    );
  }, [byPatient, searchTerm]);

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">סיכום שעות ותשלום לפי מטופל</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="page-title">סיכום שעות ותשלום לפי מטופל</h1>
        <p className="page-subtitle">פירוט שעות ותשלומים מצטברים לכל מטופל.</p>
      </header>

      {(todayEvents.length > 0 ||
        overdueEvents.length > 0 ||
        upcomingEvents.length > 0) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
          <EventsList
            title="היום"
            items={todayEvents}
            patientNameById={patientNameById}
            tone="today"
          />
          <EventsList
            title="באיחור"
            items={overdueEvents}
            patientNameById={patientNameById}
            tone="overdue"
          />
          <EventsList
            title="קרובים (14 ימים)"
            items={upcomingEvents.slice(0, 10)}
            patientNameById={patientNameById}
            tone="upcoming"
          />
        </section>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="stat-card">
          <div className="stat-label">מטופלים פעילים</div>
          <div className="stat-value">{loading ? "—" : activePatients}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">שעות החודש</div>
          <div className="stat-value">
            {loading ? "—" : formatDecimalHoursAsHHMM(monthly.hours)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">לפני הנחה (החודש)</div>
          <div className="stat-value-accent">
            {loading ? "—" : formatCurrency(monthly.before)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">אחרי הנחה (החודש)</div>
          <div className="stat-value-accent">
            {loading ? "—" : formatCurrency(monthly.after)}
          </div>
        </div>
      </section>

      <div className="card">
        <div className="px-6 py-5 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">סיכום לפי מטופל</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="search"
              placeholder="חיפוש לפי שם מטופל..."
              className="input md:max-w-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="text-xs text-ink-500">
              {searchTerm
                ? `${filteredByPatient.length}/${byPatient.length}`
                : `${byPatient.length} מטופלים`}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>מטופל</th>
                <th>פעילות אחרונה</th>
                <th>פגישות</th>
                <th>שעות</th>
                <th>לפני הנחה</th>
                <th>אחרי הנחה</th>
                <th>נסיעות</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center text-ink-500 py-8">
                    טוען...
                  </td>
                </tr>
              ) : filteredByPatient.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-ink-500 py-8">
                    {searchTerm ? "אין תוצאות לחיפוש" : "אין נתונים להצגה"}
                  </td>
                </tr>
              ) : (
                filteredByPatient.map((row) => (
                  <tr key={row.id || "unknown"}>
                    <td className="font-medium">{row.name}</td>
                    <td className="text-ink-500 whitespace-nowrap">
                      {row.latestDate ? formatDate(row.latestDate) : "—"}
                    </td>
                    <td>{row.count}</td>
                    <td>{formatDecimalHoursAsHHMM(row.hours)}</td>
                    <td>{formatCurrency(row.before)}</td>
                    <td className="font-semibold">
                      {formatCurrency(row.after)}
                    </td>
                    <td>{formatCurrency(row.travel)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
