"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { formatCurrency } from "@/lib/format";

export default function SummaryPage() {
  const [tasks, setTasks] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!supabaseReady) {
        setLoading(false);
        return;
      }
      const [tRes, pRes] = await Promise.all([
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
      ]);
      setTasks(tRes.data || []);
      setPatients(pRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

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
        });
      }
      const row = map.get(key);
      row.hours += Number(t.hours) || 0;
      row.before += Number(t.total_before_discount) || 0;
      row.after += Number(t.total_after_discount) || 0;
      row.travel += Number(t.travel_payment) || 0;
      row.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.after - a.after);
  }, [tasks, patientNameById]);

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

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="stat-card">
          <div className="stat-label">מטופלים פעילים</div>
          <div className="stat-value">{loading ? "—" : activePatients}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">שעות החודש</div>
          <div className="stat-value">
            {loading ? "—" : monthly.hours.toFixed(2)}
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
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <h2 className="section-title">סיכום לפי מטופל</h2>
          <span className="text-xs text-ink-500">
            {byPatient.length} מטופלים
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>מטופל</th>
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
                  <td colSpan={6} className="text-center text-ink-500 py-8">
                    טוען...
                  </td>
                </tr>
              ) : byPatient.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-ink-500 py-8">
                    אין נתונים להצגה
                  </td>
                </tr>
              ) : (
                byPatient.map((row) => (
                  <tr key={row.id || "unknown"}>
                    <td className="font-medium">{row.name}</td>
                    <td>{row.count}</td>
                    <td>{row.hours.toFixed(2)}</td>
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
