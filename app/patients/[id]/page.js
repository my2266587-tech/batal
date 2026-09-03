"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, DocumentIcon, EditIcon, IconButton } from "@/components/Icons";
import {
  formatCurrency,
  formatDate,
  formatDecimalHoursAsHHMM,
} from "@/lib/format";

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

// How much is still owed on a task after any partial payments already
// recorded against it (paid_amount). Never negative.
function remainingAmount(t) {
  const total = Number(t?.total_after_discount) || 0;
  const paid = Number(t?.paid_amount) || 0;
  const r = total - paid;
  return r > 0.009 ? r : 0;
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
  getAmount,
}) {
  const PAID_VALUES = ["שולם", "לא לחיוב"];
  const amountFor = getAmount || ((t) => Number(t.total_after_discount) || 0);
  const sectionTotal = items.reduce((s, t) => s + amountFor(t), 0);

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
                    <td>{formatDecimalHoursAsHHMM(t.hours)}</td>
                    <td className="font-medium">
                      {formatCurrency(amountFor(t))}
                      {t.payment_status === "שולם חלקית" && (
                        <div className="text-[11px] text-ink-500 font-normal whitespace-nowrap">
                          מתוך {formatCurrency(t.total_after_discount)} · שולם{" "}
                          {formatCurrency(t.paid_amount)}
                        </div>
                      )}
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
  const [linkedContacts, setLinkedContacts] = useState([]);
  const [allContacts, setAllContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Payments export filter state — lets her send only part of the history
  // (e.g. only what's unpaid, or only a date range) instead of everything.
  const [exportStatus, setExportStatus] = useState("all"); // "all" | "paid" | "unpaid"
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  // Record-payment state — she enters an amount that was paid and the
  // system allocates it against unpaid tasks (oldest debt first),
  // partially paying a task down when the amount doesn't cover it in full.
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Upload form state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Contact link form state
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactMode, setContactMode] = useState("link"); // "link" | "create"
  const [linkExistingId, setLinkExistingId] = useState("");
  const [linkNotes, setLinkNotes] = useState("");
  const [newContact, setNewContact] = useState({
    full_name: "",
    contact_type: "",
    organization: "",
    role: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState("");

  async function loadAll() {
    setLoading(true);
    const [pRes, tRes, dRes, pcRes, cRes] = await Promise.all([
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
      supabase
        .from("patient_contacts")
        .select("id, notes, contact:contacts(*)")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("contacts").select("*").order("full_name"),
    ]);
    if (pRes.error) setError(pRes.error.message);
    if (tRes.error) setError(tRes.error.message);
    if (dRes.error) setError(dRes.error.message);
    if (pcRes.error) setError(pcRes.error.message);
    if (cRes.error) setError(cRes.error.message);
    setPatient(pRes.data || null);
    setTasks(tRes.data || []);
    setDocs(dRes.data || []);
    setLinkedContacts(pcRes.data || []);
    setAllContacts(cRes.data || []);
    setLoading(false);
  }

  function resetContactForm() {
    setContactMode("link");
    setLinkExistingId("");
    setLinkNotes("");
    setNewContact({
      full_name: "",
      contact_type: "",
      organization: "",
      role: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    setContactError("");
  }

  function openContactForm() {
    resetContactForm();
    setContactFormOpen(true);
  }

  function closeContactForm() {
    setContactFormOpen(false);
    resetContactForm();
  }

  async function submitLinkContact(e) {
    e.preventDefault();
    setContactError("");
    setSavingContact(true);

    let contactId = null;

    if (contactMode === "link") {
      if (!linkExistingId) {
        setContactError("יש לבחור גורם קשר קיים");
        setSavingContact(false);
        return;
      }
      contactId = linkExistingId;
    } else {
      if (!newContact.full_name.trim()) {
        setContactError("יש להזין שם גורם קשר");
        setSavingContact(false);
        return;
      }
      const { data, error: insErr } = await supabase
        .from("contacts")
        .insert([
          {
            full_name: newContact.full_name.trim(),
            contact_type: newContact.contact_type || null,
            organization: newContact.organization || null,
            role: newContact.role || null,
            phone: newContact.phone || null,
            email: newContact.email || null,
            address: newContact.address || null,
            notes: newContact.notes || null,
          },
        ])
        .select("id")
        .single();
      if (insErr) {
        setContactError("יצירת גורם קשר נכשלה: " + insErr.message);
        setSavingContact(false);
        return;
      }
      contactId = data.id;
    }

    const { error: linkErr } = await supabase
      .from("patient_contacts")
      .insert([
        {
          patient_id: id,
          contact_id: contactId,
          notes: linkNotes || null,
        },
      ]);
    if (linkErr) {
      setContactError("קישור גורם קשר נכשל: " + linkErr.message);
      setSavingContact(false);
      return;
    }

    setSavingContact(false);
    closeContactForm();
    loadAll();
  }

  async function unlinkContact(patientContactId) {
    if (!confirm("להסיר את גורם הקשר מהמטופלת? (גורם הקשר עצמו לא יימחק)"))
      return;
    const { error } = await supabase
      .from("patient_contacts")
      .delete()
      .eq("id", patientContactId);
    if (error) setError(error.message);
    else loadAll();
  }

  async function updateLinkNote(patientContactId, currentNote) {
    const note = prompt("הערה למטופלת על גורם הקשר:", currentNote || "");
    if (note === null) return;
    const { error } = await supabase
      .from("patient_contacts")
      .update({ notes: note || null })
      .eq("id", patientContactId);
    if (error) setError(error.message);
    else loadAll();
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

  // Defensive client-side sort: newest first. Falls back to start_time and
  // created_at when date_gregorian is equal or missing.
  function sortByDateDesc(a, b) {
    const ad = a.date_gregorian || "";
    const bd = b.date_gregorian || "";
    if (ad !== bd) {
      if (!ad) return 1;
      if (!bd) return -1;
      return bd.localeCompare(ad);
    }
    const at = a.start_time || "";
    const bt = b.start_time || "";
    if (at !== bt) {
      if (!at) return 1;
      if (!bt) return -1;
      return bt.localeCompare(at);
    }
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  }

  const unpaidTasks = useMemo(
    () => tasks.filter((t) => isUnpaidStatus(t.payment_status)).sort(sortByDateDesc),
    [tasks],
  );
  const paidTasks = useMemo(
    () => tasks.filter((t) => !isUnpaidStatus(t.payment_status)).sort(sortByDateDesc),
    [tasks],
  );
  const allTasksSorted = useMemo(
    () => [...tasks].sort(sortByDateDesc),
    [tasks],
  );

  // What actually goes into the Excel / PDF payments sheet, after the
  // status + date-range filters below.
  const exportTasks = useMemo(() => {
    return allTasksSorted.filter((t) => {
      if (exportStatus === "paid" && isUnpaidStatus(t.payment_status))
        return false;
      if (exportStatus === "unpaid" && !isUnpaidStatus(t.payment_status))
        return false;
      const d = t.date_gregorian;
      if (exportFrom && (!d || d < exportFrom)) return false;
      if (exportTo && (!d || d > exportTo)) return false;
      return true;
    });
  }, [allTasksSorted, exportStatus, exportFrom, exportTo]);

  const exportTotals = useMemo(() => {
    let hours = 0,
      paid = 0,
      unpaid = 0;
    exportTasks.forEach((t) => {
      hours += Number(t.hours) || 0;
      if (isUnpaidStatus(t.payment_status)) {
        // Open balance reflects what's actually still owed, not the
        // task's original price — a partial payment already lowered it.
        unpaid += remainingAmount(t);
        paid += Number(t.paid_amount) || 0;
      } else {
        paid += Number(t.total_after_discount) || 0;
      }
    });
    return { hours, paid, unpaid };
  }, [exportTasks]);

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
      if (isUnpaidStatus(t.payment_status)) {
        unpaid += remainingAmount(t);
        paid += Number(t.paid_amount) || 0;
      } else {
        paid += Number(t.total_after_discount) || 0;
      }
    });
    return { hours, before, after, travel, paid, unpaid };
  }, [tasks]);

  // Oldest unpaid debt first — the natural order to pay off when recording
  // a payment against the running balance.
  const unpaidTasksAsc = useMemo(() => [...unpaidTasks].reverse(), [unpaidTasks]);

  // How the entered amount would be applied: walk the open balance
  // oldest-first, paying each task down fully until the amount runs out —
  // the last task touched absorbs whatever's left as a partial payment.
  // No-charge (₪0) tasks have nothing owed, so they're skipped automatically.
  const paymentAllocation = useMemo(() => {
    let budget = Number(paymentAmount) || 0;
    const allocations = [];
    for (const t of unpaidTasksAsc) {
      if (budget <= 0.009) break;
      const before = remainingAmount(t);
      if (before <= 0.009) continue;
      const apply = Math.min(budget, before);
      allocations.push({ task: t, before, apply, after: before - apply });
      budget -= apply;
    }
    const leftover = budget > 0.009 ? budget : 0;
    const totalApplied = allocations.reduce((s, a) => s + a.apply, 0);
    return { allocations, leftover, totalApplied };
  }, [paymentAmount, unpaidTasksAsc]);

  function closePaymentForm() {
    setPaymentFormOpen(false);
    setPaymentAmount("");
  }

  async function recordPayment() {
    const { allocations, leftover, totalApplied } = paymentAllocation;
    if (allocations.length === 0) {
      alert("אין סכום לשיוך — הזיני סכום גדול מ-0 כשקיים חוב פתוח.");
      return;
    }
    const lines = allocations.map((a) => {
      const label = (a.task.task_definition || "משימה").slice(0, 50);
      const tail =
        a.after > 0.009
          ? `יישאר לתשלום ${formatCurrency(a.after)}`
          : "ישולם במלואו";
      return `• ${label} — ${formatCurrency(a.apply)} (${tail})`;
    });
    let msg = `לרשום תשלום של ${formatCurrency(totalApplied)}?\n\n${lines.join("\n")}`;
    if (leftover > 0.009) {
      msg += `\n\nלתשומת לבך: ${formatCurrency(
        leftover,
      )} מהסכום שהוזן לא שויכו — אין כרגע מספיק חוב פתוח.`;
    }
    if (!confirm(msg)) return;

    setRecordingPayment(true);
    for (const a of allocations) {
      const newPaidAmount = (Number(a.task.paid_amount) || 0) + a.apply;
      const newStatus = a.after > 0.009 ? "שולם חלקית" : "שולם";
      const { error: updErr } = await supabase
        .from("tasks")
        .update({ paid_amount: newPaidAmount, payment_status: newStatus })
        .eq("id", a.task.id);
      if (updErr) {
        setRecordingPayment(false);
        const missingColumn =
          /paid_amount/i.test(updErr.message || "") ||
          updErr.code === "42703" ||
          updErr.code === "PGRST204";
        alert(
          (missingColumn
            ? 'עדכון נכשל: בטבלת tasks חסרה העמודה paid_amount. יש להריץ קודם את מיגרציית ה-SQL (migrations/20260903_task_paid_amount.sql) בעורך ה-SQL של Supabase, ואז לנסות שוב.\n\n'
            : "עדכון תשלום נכשל:\n\n") + (updErr.message || JSON.stringify(updErr)),
        );
        loadAll(); // reflect whatever already went through
        return;
      }
    }
    setRecordingPayment(false);
    closePaymentForm();
    loadAll();
  }

  const documents = useMemo(
    () => tasks.filter((t) => t.documents_url && t.documents_url.trim() !== ""),
    [tasks],
  );

  async function togglePaymentStatus(task) {
    const currentlyUnpaid = isUnpaidStatus(task.payment_status);
    const newStatus = currentlyUnpaid ? "שולם" : "לא שולם";
    // Manually flipping the checkbox settles (or reopens) the task in full,
    // so paid_amount should follow along — but keep working even before the
    // paid_amount migration has run, by retrying without it on that one
    // specific failure instead of breaking the existing toggle.
    const newPaidAmount = currentlyUnpaid
      ? Number(task.total_after_discount) || 0
      : 0;
    let { error: updErr } = await supabase
      .from("tasks")
      .update({ payment_status: newStatus, paid_amount: newPaidAmount })
      .eq("id", task.id);
    if (
      updErr &&
      (/paid_amount/i.test(updErr.message || "") ||
        updErr.code === "42703" ||
        updErr.code === "PGRST204")
    ) {
      ({ error: updErr } = await supabase
        .from("tasks")
        .update({ payment_status: newStatus })
        .eq("id", task.id));
    }
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

  function buildPaymentExportRows() {
    return exportTasks.map((t) => ({
      "תאריך": formatDate(t.date_gregorian) || "",
      "משימה": t.task_definition || "",
      "סוג פגישה": t.meeting_type || "",
      "שעות": Number(t.hours || 0).toFixed(2),
      "סכום": Number(t.total_after_discount || 0).toFixed(2),
      "יתרה לתשלום": remainingAmount(t).toFixed(2),
      "סטטוס תשלום": t.payment_status || "לא שולם",
    }));
  }

  function downloadPaymentsExcel() {
    if (exportTasks.length === 0) {
      alert("אין תשלומים התואמים לסינון שנבחר");
      return;
    }
    const rows = buildPaymentExportRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] || {});
    ws["!cols"] = headers.map((h) => ({
      wch: Math.max(10, Math.min(40, h.length + 8)),
    }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "תשלומים");
    const today = formatDate(new Date()).replace(/\//g, "-");
    XLSX.writeFile(
      wb,
      `תשלומים_${sanitize(patient.full_name)}_${today}.xlsx`,
    );
  }

  function printPaymentsSheet() {
    if (exportTasks.length === 0) {
      alert("אין תשלומים התואמים לסינון שנבחר");
      return;
    }
    const today = formatDate(new Date());

    const filterParts = [];
    if (exportStatus === "paid") filterParts.push("רק ששולם");
    if (exportStatus === "unpaid") filterParts.push("רק שלא שולם");
    if (exportFrom) filterParts.push(`מתאריך ${formatDate(exportFrom)}`);
    if (exportTo) filterParts.push(`עד תאריך ${formatDate(exportTo)}`);
    const filterLabel = filterParts.length ? ` · מסונן: ${filterParts.join(", ")}` : "";

    const escape = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    // Same four payment states shown in the app (PaymentBadge), so the
    // printed sheet reads consistently with the on-screen table.
    const STATUS_STYLE = {
      "שולם": { bg: "#ECFDF5", text: "#047857", border: "#A7F3D0" },
      "שולם חלקית": { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
      "לא שולם": { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" },
      "לא לחיוב": { bg: "#F1F5F9", text: "#475569", border: "#E2E8F0" },
    };

    const bodyHtml = exportTasks
      .map((t, i) => {
        const status = t.payment_status || "לא שולם";
        const st = STATUS_STYLE[status] || STATUS_STYLE["לא שולם"];
        const label = t.task_definition ? escape(t.task_definition.slice(0, 90)) : "—";
        const type = t.meeting_type ? escape(t.meeting_type) : "—";
        const remaining = remainingAmount(t);
        return `<tr class="${i % 2 === 1 ? "alt" : ""}">
          <td class="nowrap">${escape(formatDate(t.date_gregorian) || "—")}</td>
          <td>${label}</td>
          <td class="nowrap">${type}</td>
          <td class="nowrap num">${escape(formatDecimalHoursAsHHMM(t.hours))}</td>
          <td class="nowrap num amount">${escape(formatCurrency(t.total_after_discount))}</td>
          <td class="nowrap num">${remaining > 0.009 ? escape(formatCurrency(remaining)) : "—"}</td>
          <td class="nowrap">
            <span class="pill" style="background:${st.bg};color:${st.text};border-color:${st.border}">${escape(status)}</span>
          </td>
        </tr>`;
      })
      .join("");

    const totalAmount = exportTotals.paid + exportTotals.unpaid;
    const patientMetaParts = [];
    if (patient.phone) patientMetaParts.push(patient.phone);
    if (patient.treatment_type) patientMetaParts.push(patient.treatment_type);
    const patientMeta = patientMetaParts.map(escape).join(" · ");

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <title>דף תשלומים — ${escape(patient.full_name)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 16mm; }
    * { box-sizing: border-box; }
    html, body {
      font-family: "Heebo", "Arial Hebrew", Arial, sans-serif;
      direction: rtl;
      color: #0F172A;
      background: #ffffff;
    }
    body { font-size: 10.5pt; margin: 0; padding: 28px; }

    /* Brand strip */
    .brandbar {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 14px; margin-bottom: 18px;
      border-bottom: 2px solid #0F172A;
    }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-mark {
      width: 26px; height: 26px; border-radius: 7px;
      background: #EA580C; color: #fff; font-weight: 700; font-size: 12pt;
      display: flex; align-items: center; justify-content: center;
    }
    .brand-name { font-weight: 700; font-size: 11.5pt; letter-spacing: 0.2px; }
    .brand-doc { color: #64748B; font-size: 9.5pt; }
    .gen-date { color: #64748B; font-size: 9pt; text-align: left; }

    /* Patient header */
    .patient-block { margin-bottom: 20px; }
    .patient-name { font-size: 19pt; font-weight: 700; margin: 0 0 4px; }
    .patient-meta { color: #64748B; font-size: 10pt; }
    .filter-note {
      display: inline-block; margin-top: 8px;
      background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 999px;
      padding: 4px 12px; font-size: 8.8pt; color: #475569;
    }

    /* Summary cards */
    .summary {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 12px; margin: 20px 0 24px;
    }
    .stat {
      border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;
      background: #F8FAFC;
    }
    .stat .label {
      font-size: 8.5pt; color: #64748B; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;
    }
    .stat .value { font-size: 15pt; font-weight: 700; }
    .stat.paid { background: #ECFDF5; border-color: #A7F3D0; }
    .stat.paid .value { color: #047857; }
    .stat.unpaid { background: #FEF2F2; border-color: #FECACA; }
    .stat.unpaid .value { color: #B91C1C; }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td { padding: 9px 10px; text-align: right; vertical-align: middle; }
    th {
      background: #0F172A; color: #ffffff; font-weight: 600;
      font-size: 8.8pt; letter-spacing: 0.02em;
    }
    th:first-child { border-top-right-radius: 8px; }
    th:last-child { border-top-left-radius: 8px; }
    td { border-bottom: 1px solid #EEF2F6; }
    tbody tr.alt td { background: #FAFBFC; }
    .num { font-variant-numeric: tabular-nums; }
    .amount { font-weight: 700; }
    .nowrap { white-space: nowrap; }
    .pill {
      display: inline-block; padding: 3px 11px; border-radius: 999px;
      font-size: 8.5pt; font-weight: 600; border: 1px solid transparent;
      white-space: nowrap;
    }

    tfoot td {
      border-top: 2px solid #0F172A; border-bottom: none;
      padding-top: 12px; font-weight: 700; font-size: 10.5pt;
    }
    tfoot .label { color: #64748B; font-weight: 600; font-size: 9pt; }

    .footer {
      margin-top: 28px; padding-top: 14px; border-top: 1px solid #E2E8F0;
      font-size: 8.3pt; color: #94A3B8; text-align: center; line-height: 1.6;
    }

    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
    .no-print {
      position: fixed; top: 14px; left: 14px; display: flex; gap: 8px; z-index: 10;
    }
    .no-print button {
      background: #EA580C; color: #fff; border: none; border-radius: 8px;
      padding: 9px 16px; cursor: pointer; font-family: inherit;
      font-size: 10.5pt; font-weight: 600; box-shadow: 0 2px 8px rgba(234,88,12,0.25);
    }
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">🖨 הדפסה / שמירה כ-PDF</button></div>

  <div class="brandbar">
    <div class="brand">
      <div class="brand-mark">ב</div>
      <div>
        <div class="brand-name">בט״ל</div>
        <div class="brand-doc">דף תשלומים</div>
      </div>
    </div>
    <div class="gen-date">הופק בתאריך ${today}</div>
  </div>

  <div class="patient-block">
    <h1 class="patient-name">${escape(patient.full_name)}</h1>
    ${patientMeta ? `<div class="patient-meta">${patientMeta}</div>` : ""}
    <div>
      <span class="filter-note">${exportTasks.length} פגישות${filterLabel}</span>
    </div>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="label">סך שעות</div>
      <div class="value">${escape(formatDecimalHoursAsHHMM(exportTotals.hours))}</div>
    </div>
    <div class="stat paid">
      <div class="label">שולם</div>
      <div class="value">${escape(formatCurrency(exportTotals.paid))}</div>
    </div>
    <div class="stat unpaid">
      <div class="label">פתוח לתשלום</div>
      <div class="value">${escape(formatCurrency(exportTotals.unpaid))}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>תאריך</th>
        <th>משימה</th>
        <th>סוג פגישה</th>
        <th>שעות</th>
        <th>סכום</th>
        <th>יתרה לתשלום</th>
        <th>סטטוס תשלום</th>
      </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" class="label">סה״כ</td>
        <td class="num">${escape(formatDecimalHoursAsHHMM(exportTotals.hours))}</td>
        <td class="num amount">${escape(formatCurrency(totalAmount))}</td>
        <td class="num amount">${escape(formatCurrency(exportTotals.unpaid))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    מסמך זה הופק אוטומטית ממערכת בט״ל לניהול משימות ואינו מהווה חשבונית מס.<br />
    בט״ל — מערכת ניהול משימות
  </div>

  <script>setTimeout(() => window.print(), 300);</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      alert("הדפדפן חסם פתיחת חלון. אפשרי חלונות קופצים לאתר זה ונסי שוב.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
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
          <div className="stat-value">{formatDecimalHoursAsHHMM(totals.hours)}</div>
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

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="section-title">רישום תשלום</h2>
            <p className="text-xs text-ink-500 mt-1">
              הזיני סכום שהתקבל — המערכת תוריד אותו מהחוב הפתוח, מתחילה
              מהמשימה הוותיקה ביותר; אם הסכום לא מכסה משימה במלואה היא
              תסומן "שולם חלקית" והיתרה שלה תרד בהתאם.
            </p>
          </div>
          {!paymentFormOpen && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setPaymentFormOpen(true)}
              disabled={unpaidTasks.length === 0}
              title={unpaidTasks.length === 0 ? "אין משימות פתוחות לתשלום" : undefined}
            >
              + רישום תשלום
            </button>
          )}
        </div>

        {paymentFormOpen && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="label">סכום ששולם (₪)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  autoFocus
                />
              </div>
              {Number(paymentAmount) > 0 && (
                <div className="text-sm">
                  <div className="text-ink-500">
                    יוקצו {formatCurrency(paymentAllocation.totalApplied)} ל-
                    {paymentAllocation.allocations.length} משימות
                  </div>
                  {paymentAllocation.leftover > 0.009 && (
                    <div className="text-amber-700">
                      {formatCurrency(paymentAllocation.leftover)} מהסכום לא
                      ניתן לשיוך — אין מספיק חוב פתוח
                    </div>
                  )}
                </div>
              )}
            </div>

            {paymentAllocation.allocations.length > 0 && (
              <div className="overflow-x-auto border border-line rounded-md max-h-80 overflow-y-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>משימה</th>
                      <th>יתרה לפני</th>
                      <th>מוקצה עכשיו</th>
                      <th>יתרה אחרי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentAllocation.allocations.map(({ task: t, before, apply, after }) => (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap">
                          {formatDate(t.date_gregorian) || "—"}
                        </td>
                        <td className="max-w-xs">
                          <div className="line-clamp-1 text-sm">
                            {t.task_definition || "—"}
                          </div>
                        </td>
                        <td>{formatCurrency(before)}</td>
                        <td className="font-medium text-emerald-700">
                          {formatCurrency(apply)}
                        </td>
                        <td>
                          {after > 0.009 ? (
                            formatCurrency(after)
                          ) : (
                            <span className="badge-success">שולם במלואו</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                className="btn-primary"
                onClick={recordPayment}
                disabled={recordingPayment || paymentAllocation.allocations.length === 0}
              >
                {recordingPayment
                  ? "רושם..."
                  : `רישום תשלום של ${formatCurrency(paymentAllocation.totalApplied)}`}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={closePaymentForm}
                disabled={recordingPayment}
              >
                ביטול
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="section-title">הורדת דף תשלומים</h2>
          <span className="text-xs text-ink-500">
            {exportTasks.length} מתוך {tasks.length} פגישות ייכללו
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="label">סטטוס תשלום</label>
            <select
              className="input"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
            >
              <option value="all">הכל</option>
              <option value="paid">רק ששולם</option>
              <option value="unpaid">רק שלא שולם</option>
            </select>
          </div>
          <div>
            <label className="label">מתאריך</label>
            <input
              type="date"
              className="input"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">עד תאריך</label>
            <input
              type="date"
              className="input"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={downloadPaymentsExcel}
              title="הורדת דף תשלומים כקובץ Excel"
            >
              ⬇ Excel
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={printPaymentsSheet}
              title="הפקת דף תשלומים מסודר להדפסה / PDF"
            >
              ⬇ PDF
            </button>
          </div>
        </div>
        {(exportStatus !== "all" || exportFrom || exportTo) && (
          <button
            type="button"
            className="text-xs text-accent-700 hover:underline mt-3"
            onClick={() => {
              setExportStatus("all");
              setExportFrom("");
              setExportTo("");
            }}
          >
            איפוס סינון
          </button>
        )}
      </section>

      <TasksSection
        title="משימות לא שולמו"
        subtitle="חוב פתוח לתשלום"
        items={unpaidTasks}
        emptyText="אין משימות לא שולמו"
        onTogglePaid={togglePaymentStatus}
        accent="open"
        getAmount={remainingAmount}
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
        <div className="px-6 py-5 border-b border-line flex items-center justify-between flex-wrap gap-3">
          <h2 className="section-title">גורמי קשר של המטופלת</h2>
          {!contactFormOpen && (
            <button
              type="button"
              className="btn-primary"
              onClick={openContactForm}
            >
              + הוספת גורם קשר
            </button>
          )}
        </div>

        {contactFormOpen && (
          <form
            onSubmit={submitLinkContact}
            className="p-6 space-y-4 border-b border-line bg-surface-subtle"
          >
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setContactMode("link")}
                className={
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors " +
                  (contactMode === "link"
                    ? "bg-accent-600 text-white"
                    : "bg-white border border-line text-ink-700 hover:bg-surface-subtle")
                }
              >
                קישור גורם קשר קיים
              </button>
              <button
                type="button"
                onClick={() => setContactMode("create")}
                className={
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors " +
                  (contactMode === "create"
                    ? "bg-accent-600 text-white"
                    : "bg-white border border-line text-ink-700 hover:bg-surface-subtle")
                }
              >
                יצירת גורם קשר חדש
              </button>
            </div>

            {contactMode === "link" ? (
              <div>
                <label className="label">בחרי גורם קשר *</label>
                <select
                  className="input"
                  value={linkExistingId}
                  onChange={(e) => setLinkExistingId(e.target.value)}
                  required
                >
                  <option value="">— בחרי —</option>
                  {allContacts
                    .filter(
                      (c) =>
                        !linkedContacts.some(
                          (lc) => lc.contact && lc.contact.id === c.id,
                        ),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                        {c.organization ? ` — ${c.organization}` : ""}
                        {c.contact_type ? ` (${c.contact_type})` : ""}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">שם *</label>
                  <input
                    className="input"
                    value={newContact.full_name}
                    onChange={(e) =>
                      setNewContact((c) => ({
                        ...c,
                        full_name: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="label">סוג גורם</label>
                  <input
                    className="input"
                    placeholder="ביטוח לאומי / קופ״ח / רווחה / וכו'"
                    value={newContact.contact_type}
                    onChange={(e) =>
                      setNewContact((c) => ({
                        ...c,
                        contact_type: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="label">ארגון</label>
                  <input
                    className="input"
                    value={newContact.organization}
                    onChange={(e) =>
                      setNewContact((c) => ({
                        ...c,
                        organization: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="label">תפקיד</label>
                  <input
                    className="input"
                    value={newContact.role}
                    onChange={(e) =>
                      setNewContact((c) => ({ ...c, role: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">טלפון</label>
                  <input
                    className="input"
                    value={newContact.phone}
                    onChange={(e) =>
                      setNewContact((c) => ({ ...c, phone: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">אימייל</label>
                  <input
                    className="input"
                    type="email"
                    value={newContact.email}
                    onChange={(e) =>
                      setNewContact((c) => ({ ...c, email: e.target.value }))
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">כתובת / סניף</label>
                  <input
                    className="input"
                    value={newContact.address}
                    onChange={(e) =>
                      setNewContact((c) => ({
                        ...c,
                        address: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">הערה ספציפית למטופלת</label>
              <textarea
                className="input min-h-[60px]"
                placeholder="לדוגמה: עו״ס מטפלת — לפנות בבקרים בלבד"
                value={linkNotes}
                onChange={(e) => setLinkNotes(e.target.value)}
              />
            </div>

            {contactError && (
              <p className="text-red-700 text-sm">{contactError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                className="btn-primary"
                disabled={savingContact}
              >
                {savingContact ? "שומר..." : "שמירה"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeContactForm}
                disabled={savingContact}
              >
                ביטול
              </button>
            </div>
          </form>
        )}

        <div className="p-6">
          {linkedContacts.length === 0 ? (
            <p className="text-sm text-ink-500">
              עדיין אין גורמי קשר מקושרים — לחצי על "+ הוספת גורם קשר" כדי
              להוסיף.
            </p>
          ) : (
            <div className="space-y-3">
              {linkedContacts.map((lc) => {
                const c = lc.contact || {};
                return (
                  <div
                    key={lc.id}
                    className="border border-line rounded-md p-4 bg-white"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink-900">
                            {c.full_name || "—"}
                          </span>
                          {c.contact_type && (
                            <span className="badge-info">
                              {c.contact_type}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-ink-500 mt-0.5">
                          {[c.role, c.organization].filter(Boolean).join(" · ") ||
                            "—"}
                        </div>
                        <div className="mt-2 text-sm text-ink-700 flex flex-wrap gap-x-4 gap-y-1">
                          {c.phone && (
                            <span>
                              <span className="text-ink-500 text-xs">טל׳: </span>
                              {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span>
                              <span className="text-ink-500 text-xs">מייל: </span>
                              {c.email}
                            </span>
                          )}
                          {c.address && (
                            <span>
                              <span className="text-ink-500 text-xs">
                                כתובת:{" "}
                              </span>
                              {c.address}
                            </span>
                          )}
                        </div>
                        {lc.notes && (
                          <div className="mt-2 text-sm bg-accent-50 border border-accent-200 rounded-md p-2 whitespace-pre-wrap">
                            <span className="text-accent-700 text-xs font-semibold">
                              הערה למטופלת:
                            </span>
                            <div className="text-ink-900">{lc.notes}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <IconButton
                          variant="edit"
                          title="עריכת הערה"
                          onClick={() => updateLinkNote(lc.id, lc.notes)}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          variant="delete"
                          title="הסרת הקישור"
                          onClick={() => unlinkContact(lc.id)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

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
