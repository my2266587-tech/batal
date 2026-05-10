"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";

export default function DocumentsPage() {
  const [tasks, setTasks] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterPatient, setFilterPatient] = useState("");

  useEffect(() => {
    async function load() {
      if (!supabaseReady) {
        setLoading(false);
        return;
      }
      const [tRes, pRes] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, patient_id, date_gregorian, task_definition, documents_url, meeting_type",
          )
          .not("documents_url", "is", null)
          .neq("documents_url", "")
          .order("date_gregorian", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase.from("patients").select("id, full_name").order("full_name"),
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

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterPatient && t.patient_id !== filterPatient) return false;
      return true;
    });
  }, [tasks, filterPatient]);

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">מסמכים</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">מסמכים</h1>
          <p className="page-subtitle">מסמכים שצורפו למשימות, עם סינון לפי מטופל.</p>
        </div>
        <span className="text-sm text-ink-500">סה״כ: {filtered.length}</span>
      </header>

      <div className="card p-5">
        <label className="label">סינון לפי מטופל</label>
        <select
          className="input md:max-w-md"
          value={filterPatient}
          onChange={(e) => setFilterPatient(e.target.value)}
        >
          <option value="">כל המטופלים</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>מטופל</th>
              <th>הגדרת משימה</th>
              <th>סוג פגישה</th>
              <th>מסמך</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-500 py-8">
                  טוען...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-500 py-8">
                  אין מסמכים להצגה
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">
                    {t.date_gregorian
                      ? new Date(t.date_gregorian).toLocaleDateString("he-IL")
                      : "—"}
                  </td>
                  <td className="font-medium">
                    {patientNameById[t.patient_id] || "—"}
                  </td>
                  <td className="max-w-md">
                    <div className="line-clamp-2 text-sm whitespace-pre-wrap">
                      {t.task_definition || "—"}
                    </div>
                  </td>
                  <td>{t.meeting_type || "—"}</td>
                  <td>
                    <a
                      href={t.documents_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-700 hover:underline font-medium text-sm"
                    >
                      פתיחה
                    </a>
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
