"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DocumentIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency } from "@/lib/format";

function PaymentBadge({ status }) {
  const map = {
    "שולם": "badge-success",
    "שולם חלקית": "badge-warning",
    "לא שולם": "badge-danger",
    "לא לחיוב": "badge-neutral",
  };
  return <span className={map[status] || "badge-neutral"}>{status || "—"}</span>;
}

function MeetingBadge({ status }) {
  const map = {
    "פתוח": "badge-warning",
    "בוצע": "badge-success",
    "בוטל": "badge-neutral",
  };
  return <span className={map[status] || "badge-neutral"}>{status || "—"}</span>;
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs text-ink-500 mb-0.5">{label}</div>
      <div className="text-sm text-ink-900">{value || "—"}</div>
    </div>
  );
}

export default function PatientCardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [patient, setPatient] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabaseReady || !id) {
      setLoading(false);
      return;
    }
    async function load() {
      setLoading(true);
      const [pRes, tRes] = await Promise.all([
        supabase.from("patients").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("tasks")
          .select("*")
          .eq("patient_id", id)
          .order("date_gregorian", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
      ]);
      if (pRes.error) setError(pRes.error.message);
      if (tRes.error) setError(tRes.error.message);
      setPatient(pRes.data || null);
      setTasks(tRes.data || []);
      setLoading(false);
    }
    load();
  }, [id]);

  const totals = useMemo(() => {
    let hours = 0,
      before = 0,
      after = 0,
      travel = 0,
      paid = 0,
      unpaid = 0;
    tasks.forEach((t) => {
      hours += Number(t.hours) || 0;
      before += Number(t.total_before_discount) || 0;
      after += Number(t.total_after_discount) || 0;
      travel += Number(t.travel_payment) || 0;
      if (t.payment_status === "שולם") paid += Number(t.total_after_discount) || 0;
      else if (t.payment_status === "לא שולם" || t.payment_status === "שולם חלקית")
        unpaid += Number(t.total_after_discount) || 0;
    });
    return { hours, before, after, travel, paid, unpaid };
  }, [tasks]);

  const documents = useMemo(
    () => tasks.filter((t) => t.documents_url && t.documents_url.trim() !== ""),
    [tasks],
  );

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">כרטיס מטופל</h1>
        <SetupNotice />
      </div>
    );
  }

  if (loading) {
    return <div className="py-12 text-center text-ink-500">טוען...</div>;
  }

  if (!patient) {
    return (
      <div className="space-y-4">
        <Link href="/patients" className="text-sm text-accent-700 hover:underline">
          ← חזרה לרשימת מטופלים
        </Link>
        <div className="card p-6 border-amber-200 bg-amber-50">
          <p className="text-amber-900 text-sm">המטופל לא נמצא.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/patients"
          className="text-sm text-accent-700 hover:underline"
        >
          ← חזרה לרשימת מטופלים
        </Link>
        <Link
          href={`/patients?edit=${patient.id}`}
          className="inline-flex items-center gap-2 text-sm text-ink-700 hover:text-accent-700 hover:bg-accent-50 px-3 py-1.5 rounded-md transition-colors"
        >
          <EditIcon />
          עריכה
        </Link>
      </div>

      <header className="card p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">
              {patient.full_name}
            </h1>
            {patient.treatment_type && (
              <p className="text-sm text-ink-500 mt-1">
                {patient.treatment_type}
              </p>
            )}
          </div>
          <span
            className={
              (patient.status || "פעיל") === "פעיל"
                ? "badge-success"
                : "badge-neutral"
            }
          >
            {patient.status || "פעיל"}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-line">
          <Field label="טלפון" value={patient.phone} />
          <Field label="אימייל" value={patient.email} />
          <Field
            label="מחיר לשעה"
            value={
              patient.hourly_rate != null
                ? formatCurrency(patient.hourly_rate)
                : null
            }
          />
          <Field
            label="מחיר לשעה אחרי הנחה"
            value={
              patient.hourly_rate_discounted != null
                ? formatCurrency(patient.hourly_rate_discounted)
                : null
            }
          />
          {patient.notes && (
            <div className="md:col-span-4">
              <Field label="הערות" value={patient.notes} />
            </div>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-label">סך שעות</div>
          <div className="stat-value">{totals.hours.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">סך פגישות</div>
          <div className="stat-value">{tasks.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">שולם</div>
          <div className="stat-value-accent">{formatCurrency(totals.paid)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">פתוח לתשלום</div>
          <div className="stat-value">{formatCurrency(totals.unpaid)}</div>
        </div>
      </section>

      <section className="card">
        <div className="px-6 py-5 border-b border-line">
          <h2 className="section-title">משימות ופגישות</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>משימה</th>
                <th>סוג</th>
                <th>שעות</th>
                <th>תשלום</th>
                <th>תשלום</th>
                <th>פגישה</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-ink-500 py-8">
                    אין משימות למטופל זה
                  </td>
                </tr>
              ) : (
                tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">
                      {t.date_gregorian
                        ? new Date(t.date_gregorian).toLocaleDateString("he-IL")
                        : "—"}
                    </td>
                    <td className="max-w-xs">
                      <div className="line-clamp-2 text-sm whitespace-pre-wrap">
                        {t.task_definition || "—"}
                      </div>
                    </td>
                    <td>{t.meeting_type || "—"}</td>
                    <td>{Number(t.hours || 0).toFixed(2)}</td>
                    <td className="font-medium">
                      {formatCurrency(t.total_after_discount)}
                    </td>
                    <td>
                      <PaymentBadge status={t.payment_status} />
                    </td>
                    <td>
                      <MeetingBadge status={t.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="px-6 py-5 border-b border-line">
          <h2 className="section-title">מסמכים</h2>
        </div>
        <div className="p-6">
          {documents.length === 0 ? (
            <p className="text-sm text-ink-500">אין מסמכים מצורפים.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((t) => (
                <li key={t.id} className="flex items-center gap-3 text-sm">
                  <DocumentIcon className="w-4 h-4 text-ink-500" />
                  <span className="text-ink-500 whitespace-nowrap">
                    {t.date_gregorian
                      ? new Date(t.date_gregorian).toLocaleDateString("he-IL")
                      : ""}
                  </span>
                  <span className="line-clamp-1 flex-1">
                    {t.task_definition || "מסמך"}
                  </span>
                  <a
                    href={t.documents_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-700 hover:underline font-medium"
                  >
                    פתיחה
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {error && <p className="text-red-700 text-sm">{error}</p>}
    </div>
  );
}
