"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, DocumentIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

function sanitize(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9א-ת._-]+/g, "_")
    .slice(0, 80);
}

function storagePathFromUrl(url) {
  const m = String(url || "").match(
    /\/storage\/v1\/object\/public\/documents\/(.+)$/,
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function describeError(err, label) {
  if (!err) return "";
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.error) parts.push(err.error);
  if (err.statusCode) parts.push(`status ${err.statusCode}`);
  if (err.code) parts.push(`code ${err.code}`);
  if (err.details) parts.push(err.details);
  if (err.hint) parts.push(`hint: ${err.hint}`);
  const text = parts.length ? parts.join(" — ") : JSON.stringify(err);
  return `${label}: ${text}`;
}

function fullDump(err) {
  try {
    return JSON.stringify(err, Object.getOwnPropertyNames(err || {}), 2);
  } catch {
    return String(err);
  }
}

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

function TasksSection({
  title,
  subtitle,
  items,
  emptyText,
  onTogglePaid,
  accent,
}) {
  const PAID_VALUES = ["שולם", "לא לחיוב"];
  const sectionTotal = items.reduce(
    (s, t) => s + (Number(t.total_after_discount) || 0),
    0,
  );

  return (
    <section className="card">
      <div
        className={
          "px-6 py-5 border-b border-line flex items-center justify-between " +
          (accent === "open" ? "bg-red-50/40" : "bg-emerald-50/40")
        }
      >
        <div>
          <h2 className="section-title">
            {title} ({items.length})
          </h2>
          <p className="text-xs text-ink-500 mt-1">{subtitle}</p>
        </div>
        <div className="text-left">
          <div className="text-xs text-ink-500">סה״כ</div>
          <div
            className={
              "text-lg font-bold tabular-nums " +
              (accent === "open" ? "text-red-700" : "text-emerald-700")
            }
          >
            {formatCurrency(sectionTotal)}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16 text-center">שולם?</th>
              <th>תאריך</th>
              <th>משימה</th>
              <th>סוג</th>
              <th>שעות</th>
              <th>תשלום</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-ink-500 py-8">
                  {emptyText}
                </td>
              </tr>
            ) : (
              items.map((t) => {
                const checked = PAID_VALUES.includes(t.payment_status);
                return (
                  <tr key={t.id}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onTogglePaid(t)}
                        title={checked ? "סמן כלא שולם" : "סמן כשולם"}
                        className="w-4 h-4 accent-accent-600 cursor-pointer"
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      {formatDate(t.date_gregorian) || "—"}
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PatientCardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [patient, setPatient] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Upload form state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function loadAll() {
    setLoading(true);
    const [pRes, tRes, dRes] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("tasks")
        .select("*")
        .eq("patient_id", id)
        .order("date_gregorian", { ascending: false, nullsFirst: false })
        .order("start_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("patient_documents")
        .select("*")
        .eq("patient_id", id)
        .order("uploaded_at", { ascending: false }),
    ]);
    if (pRes.error) setError(pRes.error.message);
    if (tRes.error) setError(tRes.error.message);
    if (dRes.error) setError(dRes.error.message);
    setPatient(pRes.data || null);
    setTasks(tRes.data || []);
    setDocs(dRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!supabaseReady || !id) {
      setLoading(false);
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function resetUpload() {
    setUploadDocType("");
    setUploadNotes("");
    setUploadFile(null);
    setUploadError("");
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError("יש לבחור קובץ");
      alert("יש לבחור קובץ");
      return;
    }
    setUploadError("");
    setUploading(true);

    // === STEP 1: session check ===
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    console.log("[upload step 1] session:", sessionData, "err:", sessErr);
    if (sessErr || !sessionData?.session) {
      const msg = "STEP 1 — אין סשן פעיל. " + describeError(sessErr, "שגיאה");
      alert(msg + "\n\n" + fullDump(sessErr));
      setUploadError(msg);
      setUploading(false);
      return;
    }
    const userEmail = sessionData.session.user?.email;
    console.log("[upload step 1] user email:", userEmail);

    // === STEP 2: authorization check (calls is_authorized RPC) ===
    const { data: isAuth, error: authErr } = await supabase.rpc("is_authorized");
    console.log("[upload step 2] is_authorized:", isAuth, "err:", authErr);
    if (authErr) {
      const msg =
        "STEP 2 — הקריאה ל-is_authorized נכשלה. " +
        describeError(authErr, "שגיאה");
      alert(msg + "\n\n" + fullDump(authErr));
      setUploadError(msg);
      setUploading(false);
      return;
    }
    if (!isAuth) {
      const msg = `STEP 2 — המשתמש ${userEmail} אינו מורשה (is_authorized=false). ודאי שהוא ברשימה authorized_users עם is_active=true.`;
      alert(msg);
      setUploadError(msg);
      setUploading(false);
      return;
    }

    // === STEP 3: upload to Storage ===
    const path = `patient-docs/${id}/${Date.now()}_${sanitize(uploadFile.name)}`;
    console.log("[upload step 3] bucket=documents path=", path);
    const { data: up, error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, uploadFile, { upsert: false });
    if (upErr) {
      console.error("[upload step 3] storage error:", upErr);
      console.error("[upload step 3] full dump:", fullDump(upErr));
      const msg =
        "STEP 3 — Storage נכשל. " +
        describeError(upErr, "שגיאה מ-Supabase Storage");
      alert(msg + "\n\n" + fullDump(upErr));
      setUploadError(msg);
      setUploading(false);
      return;
    }
    console.log("[upload step 3] storage ok:", up);

    // === STEP 4: getPublicUrl ===
    const { data: pub } = supabase.storage
      .from("documents")
      .getPublicUrl(up.path);
    const file_url = pub?.publicUrl;
    console.log("[upload step 4] file_url:", file_url);

    // === STEP 5: insert metadata row ===
    const { error: insErr } = await supabase.from("patient_documents").insert([
      {
        patient_id: id,
        doc_type: uploadDocType || null,
        notes: uploadNotes || null,
        file_url,
      },
    ]);
    if (insErr) {
      console.error("[upload step 5] db insert error:", insErr);
      console.error("[upload step 5] full dump:", fullDump(insErr));
      const msg =
        "STEP 5 — insert ל-patient_documents נכשל. " +
        describeError(insErr, "שגיאה מ-DB");
      alert(msg + "\n\n" + fullDump(insErr));
      setUploadError(msg);
      setUploading(false);
      return;
    }
    console.log("[upload step 5] db insert ok");
    setUploading(false);
    setUploadOpen(false);
    resetUpload();
    loadAll();
  }

  async function deleteDoc(doc) {
    if (!confirm("למחוק את המסמך?")) return;
    const path = storagePathFromUrl(doc.file_url);
    if (path) {
      const { error: rmErr } = await supabase.storage
        .from("documents")
        .remove([path]);
      if (rmErr) {
        console.warn("[delete] storage remove failed:", rmErr);
        // continue with DB delete anyway
      }
    }
    const { error } = await supabase
      .from("patient_documents")
      .delete()
      .eq("id", doc.id);
    if (error) {
      console.error("[delete] db error:", error);
      setError(describeError(error, "מחיקה נכשלה"));
    } else {
      loadAll();
    }
  }

  // Statuses that count as open debt (top section) vs settled (bottom section)
  const UNPAID_STATUSES = ["לא שולם", "שולם חלקית"];
  const isUnpaidStatus = (s) => UNPAID_STATUSES.includes(s || "לא שולם");

  const unpaidTasks = useMemo(
    () => tasks.filter((t) => isUnpaidStatus(t.payment_status)),
    [tasks],
  );
  const paidTasks = useMemo(
    () => tasks.filter((t) => !isUnpaidStatus(t.payment_status)),
    [tasks],
  );

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
      if (isUnpaidStatus(t.payment_status))
        unpaid += Number(t.total_after_discount) || 0;
      else paid += Number(t.total_after_discount) || 0;
    });
    return { hours, before, after, travel, paid, unpaid };
  }, [tasks]);

  const documents = useMemo(
    () => tasks.filter((t) => t.documents_url && t.documents_url.trim() !== ""),
    [tasks],
  );

  async function togglePaymentStatus(task) {
    const currentlyUnpaid = isUnpaidStatus(task.payment_status);
    const newStatus = currentlyUnpaid ? "שולם" : "לא שולם";
    const { error: updErr } = await supabase
      .from("tasks")
      .update({ payment_status: newStatus })
      .eq("id", task.id);
    if (updErr) {
      console.error("[toggle paid] error:", updErr);
      alert(
        "עדכון סטטוס תשלום נכשל:\n\n" +
          (updErr.message || JSON.stringify(updErr)),
      );
      return;
    }
    loadAll();
  }

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
          {Array.isArray(patient.extra_rates) &&
            patient.extra_rates.length > 0 && (
              <div className="md:col-span-4">
                <div className="text-xs text-ink-500 mb-1.5">
                  תעריפים נוספים
                </div>
                <div className="flex flex-wrap gap-2">
                  {patient.extra_rates.map((r, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-2 bg-surface-subtle border border-line rounded-md px-3 py-1.5 text-sm"
                    >
                      <span className="font-medium text-ink-900">{r.label}</span>
                      <span className="text-ink-500">·</span>
                      <span className="font-semibold text-accent-700">
                        {formatCurrency(r.rate)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
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

      <TasksSection
        title="משימות לא שולמו"
        subtitle="חוב פתוח לתשלום"
        items={unpaidTasks}
        emptyText="אין משימות לא שולמו"
        onTogglePaid={togglePaymentStatus}
        accent="open"
      />

      <TasksSection
        title="משימות ששולמו"
        subtitle="לא נכנסות לחישוב החוב הפתוח"
        items={paidTasks}
        emptyText="אין משימות ששולמו עדיין"
        onTogglePaid={togglePaymentStatus}
        accent="done"
      />

      <section className="card">
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <h2 className="section-title">מסמכים</h2>
          {!uploadOpen && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setUploadOpen(true)}
            >
              + העלאת מסמך
            </button>
          )}
        </div>

        {uploadOpen && (
          <form
            onSubmit={handleUpload}
            className="p-6 space-y-4 border-b border-line bg-surface-subtle"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">סוג מסמך</label>
                <input
                  className="input"
                  placeholder="לדוגמה: תעודה, דוח, אישור"
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value)}
                />
              </div>
              <div>
                <label className="label">קובץ *</label>
                <input
                  type="file"
                  className="text-sm"
                  onChange={(e) =>
                    setUploadFile(e.target.files?.[0] || null)
                  }
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">הערות</label>
                <textarea
                  className="input min-h-[70px]"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                />
              </div>
            </div>
            {uploadError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 whitespace-pre-wrap break-words">
                {uploadError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                className="btn-primary"
                disabled={uploading}
              >
                {uploading ? "מעלה..." : "העלאה ושמירה"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setUploadOpen(false);
                  resetUpload();
                }}
              >
                ביטול
              </button>
            </div>
          </form>
        )}

        <div className="p-6">
          {docs.length === 0 && documents.length === 0 ? (
            <p className="text-sm text-ink-500">
              אין עדיין מסמכים — לחצי על "העלאת מסמך" כדי להוסיף את הראשון.
            </p>
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 text-sm border-b border-line last:border-0 pb-2"
                >
                  <DocumentIcon className="w-4 h-4 text-ink-500 flex-shrink-0" />
                  <span className="text-ink-500 whitespace-nowrap">
                    {formatDate(d.uploaded_at)}
                  </span>
                  {d.doc_type && (
                    <span className="badge-info">{d.doc_type}</span>
                  )}
                  <span className="flex-1 line-clamp-1 text-ink-700">
                    {d.notes || "—"}
                  </span>
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-700 hover:underline font-medium"
                  >
                    פתיחה
                  </a>
                  <IconButton
                    variant="delete"
                    title="מחיקה"
                    onClick={() => deleteDoc(d)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </li>
              ))}

              {documents.length > 0 && docs.length > 0 && (
                <li className="pt-2 text-[11px] text-ink-500 uppercase tracking-wide">
                  מסמכים מצורפים למשימות
                </li>
              )}
              {documents.map((t) => (
                <li
                  key={`task-${t.id}`}
                  className="flex items-center gap-3 text-sm border-b border-line last:border-0 pb-2"
                >
                  <DocumentIcon className="w-4 h-4 text-ink-500 flex-shrink-0" />
                  <span className="text-ink-500 whitespace-nowrap">
                    {formatDate(t.date_gregorian)}
                  </span>
                  <span className="badge-neutral">משימה</span>
                  <span className="line-clamp-1 flex-1 text-ink-700">
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
