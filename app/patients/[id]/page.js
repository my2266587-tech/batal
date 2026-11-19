"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import MultiFilePicker from "@/components/MultiFilePicker";
import PatientExpenses, { todayLocal } from "@/components/PatientExpenses";
import PatientTasksList, {
  DeleteTaskDialog,
  remainingAmount,
} from "@/components/PatientTasksList";
import Collapsible from "@/components/Collapsible";
import { useUI } from "@/components/UIProvider";
import { DeleteIcon, DocumentIcon, EditIcon, IconButton } from "@/components/Icons";
import { buildPaymentsSheetHtml } from "@/lib/paymentsSheet";
import {
  formatCurrency,
  formatDate,
  formatDecimalHoursAsHHMM,
} from "@/lib/format";
import { uploadPatientDocuments } from "@/lib/patientDocuments";

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

const PAYMENT_METHODS = ["מזומן", "העברה בנקאית", "צ׳ק", "אשראי", "ביט / פייבוקס", "ברטר", "אחר"];

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
  const id = params?.id;
  const ui = useUI();

  const [patient, setPatient] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [payments, setPayments] = useState([]);
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
  // Optional: the specific charge this payment is for (e.g. the 12% charge).
  // Empty = automatic, oldest debt first.
  const [paymentTargetId, setPaymentTargetId] = useState("");
  // How it was paid (cash, transfer, barter...) and a free-text note,
  // e.g. "פדיקור" for a barter payment.
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Manual charge state — a one-off amount added to the patient's open
  // balance (e.g. "פדיקור ₪350") without filling the full task form.
  const [chargeFormOpen, setChargeFormOpen] = useState(false);
  const [chargeDate, setChargeDate] = useState("");
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [savingCharge, setSavingCharge] = useState(false);
  const [chargeError, setChargeError] = useState("");
  // Optional percent helper — e.g. 12% of an insurance payment she received.
  const [chargeByPercent, setChargeByPercent] = useState(false);
  const [chargeBase, setChargeBase] = useState("");
  const [chargePercent, setChargePercent] = useState("12");

  // Travel / expenses form (components/PatientExpenses.js).
  const [expenseOpen, setExpenseOpen] = useState(false);

  // Row pending deletion (drives the confirmation dialog).
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [deleteTaskError, setDeleteTaskError] = useState("");

  // Upload form state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState("");
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

  // The first load shows "טוען..."; later reloads (after saving) refresh the
  // data in place so open sections and the scroll position stay put.
  async function loadAll() {
    const [pRes, tRes, dRes, pcRes, cRes, payRes] = await Promise.all([
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
      supabase
        .from("payments")
        .select("*")
        .eq("patient_id", id)
        .order("paid_at", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    if (pRes.error) setError(pRes.error.message);
    if (tRes.error) setError(tRes.error.message);
    if (dRes.error) setError(dRes.error.message);
    if (pcRes.error) setError(pcRes.error.message);
    if (cRes.error) setError(cRes.error.message);
    // Payments history is additive (migrations/20260903_payments_history.sql) —
    // don't block the whole page on it if that migration hasn't run yet.
    if (payRes.error) console.warn("[payments history] load failed:", payRes.error);
    setPatient(pRes.data || null);
    setTasks(tRes.data || []);
    setDocs(dRes.data || []);
    setLinkedContacts(pcRes.data || []);
    setAllContacts(cRes.data || []);
    setPayments(payRes.error ? [] : payRes.data || []);
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
    const ok = await ui.confirm({
      title: "להסיר את איש הקשר מהמטופל?",
      message: "איש הקשר עצמו יישאר ברשימת אנשי הקשר.",
      confirmText: "הסרה",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase
      .from("patient_contacts")
      .delete()
      .eq("id", patientContactId);
    if (error) ui.toast("ההסרה נכשלה: " + error.message, "error");
    else {
      ui.toast("הוסר");
      loadAll();
    }
  }

  async function updateLinkNote(patientContactId, currentNote) {
    const note = await ui.prompt({ title: "הערה על איש הקשר", defaultValue: currentNote || "" });
    if (note === null) return;
    const { error } = await supabase
      .from("patient_contacts")
      .update({ notes: note.trim() || null })
      .eq("id", patientContactId);
    if (error) ui.toast("השמירה נכשלה: " + error.message, "error");
    else {
      ui.toast("נשמר");
      loadAll();
    }
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
    setUploadFiles([]);
    setUploadError("");
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFiles.length) {
      setUploadError("יש לבחור לפחות קובץ אחד");
      return;
    }
    setUploadError("");
    setUploading(true);
    const res = await uploadPatientDocuments({
      patientId: id,
      files: uploadFiles,
      docType: uploadDocType,
      notes: uploadNotes,
      onProgress: (n, total) => setUploadProgress(`${n}/${total}`),
    });
    setUploading(false);
    setUploadProgress("");
    if (res.fatal) {
      setUploadError(res.fatal);
      return;
    }
    if (res.uploaded) loadAll();
    if (res.failures.length) {
      // Keep only the failed files in the list so the user can retry them.
      setUploadFiles(res.failures.map((f) => f.file));
      setUploadError(
        `הועלו ${res.uploaded} מתוך ${res.uploaded + res.failures.length} קבצים. נכשלו:\n` +
          res.failures.map((f) => `• ${f.file.name} — ${f.message}`).join("\n"),
      );
      return;
    }
    setUploadOpen(false);
    resetUpload();
  }

  async function deleteDoc(doc) {
    const ok = await ui.confirm({ title: "למחוק את המסמך?", confirmText: "מחיקה", danger: true });
    if (!ok) return;
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
      console.error("[delete] db error:", error.code);
      ui.toast(describeError(error, "המחיקה נכשלה"), "error");
    } else {
      ui.toast("המסמך נמחק");
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
  // When a specific charge is chosen it's paid first; anything left over
  // still goes to the oldest remaining debt.
  const paymentAllocation = useMemo(() => {
    let budget = Number(paymentAmount) || 0;
    const allocations = [];
    const target = unpaidTasksAsc.find((t) => t.id === paymentTargetId);
    const order = target
      ? [target, ...unpaidTasksAsc.filter((t) => t.id !== target.id)]
      : unpaidTasksAsc;
    for (const t of order) {
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
  }, [paymentAmount, paymentTargetId, unpaidTasksAsc]);

  function openChargeForm() {
    setPaymentFormOpen(false);
    setExpenseOpen(false);
    setChargeDate(todayLocal());
    setChargeLabel("");
    setChargeAmount("");
    setChargeError("");
    setChargeByPercent(false);
    setChargeBase("");
    setChargePercent("12");
    setChargeFormOpen(true);
  }

  function closeChargeForm() {
    setChargeFormOpen(false);
    setChargeError("");
  }

  // Saved as a regular task so it joins the open balance, the payment
  // allocation and the payments sheet exactly like any other charge.
  const percentAmount = useMemo(() => {
    const base = Number(chargeBase) || 0;
    const pct = Number(chargePercent) || 0;
    return Math.round(base * pct) / 100;
  }, [chargeBase, chargePercent]);

  async function saveCharge(e) {
    e.preventDefault();
    const amount = chargeByPercent ? percentAmount : Number(chargeAmount);
    if (!chargeLabel.trim()) {
      setChargeError("יש לכתוב עבור מה החיוב.");
      return;
    }
    if (!(amount > 0)) {
      setChargeError("יש להזין סכום גדול מ-0.");
      return;
    }
    setSavingCharge(true);
    setChargeError("");
    const { error: insErr } = await supabase.from("tasks").insert([
      {
        patient_id: id,
        date_gregorian: chargeDate || null,
        task_definition: chargeLabel.trim(),
        hours: 0,
        total_before_discount: amount,
        total_after_discount: amount,
        status: "בוצע",
        payment_status: "לא שולם",
      },
    ]);
    setSavingCharge(false);
    if (insErr) {
      setChargeError(describeError(insErr, "שמירת החיוב נכשלה"));
      return;
    }
    ui.toast(`החיוב נשמר: ${formatCurrency(amount)}`);
    closeChargeForm();
    loadAll();
  }

  function askDeleteTask(task) {
    setDeleteTaskError("");
    setTaskToDelete(task);
  }

  function cancelDeleteTask() {
    setTaskToDelete(null);
    setDeleteTaskError("");
  }

  async function confirmDeleteTask() {
    if (!taskToDelete) return;
    setDeletingTask(true);
    setDeleteTaskError("");
    // .select() returns the deleted rows, so a delete that silently
    // matched nothing (e.g. blocked by permissions) is reported, not hidden.
    const { data, error: delErr } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskToDelete.id)
      .select("id");
    setDeletingTask(false);
    if (delErr || !data || data.length === 0) {
      setDeleteTaskError(
        delErr
          ? describeError(delErr, "המחיקה נכשלה")
          : "המחיקה נכשלה — השורה לא נמחקה. נסי לרענן את הדף.",
      );
      return;
    }
    setTaskToDelete(null);
    loadAll();
  }

  function openPaymentForm() {
    setChargeFormOpen(false);
    setExpenseOpen(false);
    setPaymentFormOpen(true);
  }

  function openExpenseForm() {
    setChargeFormOpen(false);
    setPaymentFormOpen(false);
    setExpenseOpen(true);
  }

  function closePaymentForm() {
    setPaymentFormOpen(false);
    setPaymentAmount("");
    setPaymentTargetId("");
    setPaymentMethod("");
    setPaymentNote("");
  }

  // The form already shows exactly what the amount will close (preview
  // list), so saving needs no extra confirmation step.
  async function recordPayment() {
    const { allocations, totalApplied } = paymentAllocation;
    if (allocations.length === 0) {
      ui.toast("יש להזין סכום", "error");
      return;
    }

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
        await ui.alert({
          title: "התשלום לא נשמר",
          message:
            "נסי שוב. אם זה חוזר — צריך תמיכה טכנית.\n\n" +
            (missingColumn ? "(migrations/20260903_task_paid_amount.sql) " : "") +
            (updErr.message || ""),
        });
        loadAll(); // reflect whatever already went through
        return;
      }
    }

    // Log the payment itself as its own record — so a partial payment
    // stays visible even though the task it touched didn't move to "paid".
    const paymentRow = {
      patient_id: id,
      amount: totalApplied,
      paid_at: todayLocal(),
      allocations: allocations.map((a) => ({
        task_id: a.task.id,
        task_definition: a.task.task_definition || null,
        date_gregorian: a.task.date_gregorian || null,
        amount: a.apply,
        fully_paid: a.after <= 0.009,
      })),
    };
    const extras = {
      method: paymentMethod || null,
      note: paymentNote.trim() || null,
    };
    let { error: payErr } = await supabase
      .from("payments")
      .insert([{ ...paymentRow, ...extras }]);
    // method/note are additive (migrations/20261028_payment_method.sql) —
    // until that migration runs, still save the payment itself without them.
    let extrasDropped = false;
    if (
      payErr &&
      (payErr.code === "PGRST204" ||
        payErr.code === "42703" ||
        /\b(method|note)\b/i.test(payErr.message || ""))
    ) {
      ({ error: payErr } = await supabase.from("payments").insert([paymentRow]));
      extrasDropped = !payErr && Boolean(extras.method || extras.note);
    }
    if (payErr) {
      console.warn("[payments history] insert failed:", payErr.code);
      const missingTable = /payments/i.test(payErr.message || "") || payErr.code === "PGRST205";
      await ui.alert({
        title: "התשלום נרשם, אבל לא נכנס לרשימת התשלומים",
        message:
          `החוב ירד ב-${formatCurrency(totalApplied)}. רק הרישום ב"תשלומים שהתקבלו" לא נשמר.\n\n` +
          (missingTable ? "(migrations/20260903_payments_history.sql) " : "") +
          (payErr.message || ""),
      });
    } else if (extrasDropped) {
      ui.toast("התשלום נרשם, בלי אופן התשלום וההערה (migrations/20261028_payment_method.sql)", "error");
    } else {
      ui.toast(`התשלום נרשם: ${formatCurrency(totalApplied)}`);
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
      console.error("[toggle paid] error:", updErr.code);
      ui.toast("העדכון נכשל: " + (updErr.message || ""), "error");
      return;
    }
    ui.toast(newStatus === "שולם" ? "סומן כשולם" : "סומן כלא שולם");
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

  async function downloadPaymentsExcel() {
    if (exportTasks.length === 0) {
      await ui.alert("אין שורות שמתאימות לסינון שבחרת.");
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

  async function printPaymentsSheet() {
    if (exportTasks.length === 0) {
      await ui.alert("אין שורות שמתאימות לסינון שבחרת.");
      return;
    }
    const html = buildPaymentsSheetHtml({
      patient,
      exportTasks,
      exportStatus,
      exportFrom,
      exportTo,
      exportTotals,
    });
    const win = window.open("", "_blank");
    if (!win) {
      await ui.alert("הדפדפן חסם את פתיחת הדף. יש לאשר חלונות קופצים לאתר הזה ולנסות שוב.");
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

  const hasDebt = totals.unpaid > 0.009;
  const hasDetails =
    patient.email ||
    patient.hourly_rate != null ||
    patient.hourly_rate_discounted != null ||
    (Array.isArray(patient.extra_rates) && patient.extra_rates.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/patients"
          className="inline-flex items-center min-h-[44px] text-base text-accent-700 hover:underline"
        >
          → כל המטופלים
        </Link>
        <Link
          href={`/patients?edit=${patient.id}`}
          className="inline-flex items-center gap-2 min-h-[44px] text-base text-ink-700 hover:text-accent-700 hover:bg-accent-50 px-3 rounded-lg transition-colors"
        >
          <EditIcon />
          עריכת פרטים
        </Link>
      </div>

      <header className="card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-ink-900">{patient.full_name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base text-ink-500">
              {patient.treatment_type && <span>{patient.treatment_type}</span>}
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="text-accent-700 hover:underline" dir="ltr">
                  {patient.phone}
                </a>
              )}
            </div>
          </div>
          {(patient.status || "פעיל") !== "פעיל" && (
            <span className="badge-neutral">{patient.status}</span>
          )}
        </div>
        {patient.notes && (
          <p className="mt-3 text-base text-ink-700 whitespace-pre-wrap bg-surface-subtle rounded-lg p-3">
            {patient.notes}
          </p>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3 md:gap-4">
        <div className={"card p-4 md:p-5 " + (hasDebt ? "border-red-200 bg-red-50" : "")}>
          <div className="text-base font-medium text-ink-700">פתוח לתשלום</div>
          <div
            className={
              "text-2xl md:text-4xl font-bold mt-1 tabular-nums " +
              (hasDebt ? "text-red-700" : "text-ink-900")
            }
          >
            {formatCurrency(totals.unpaid)}
          </div>
        </div>
        <div className="card p-4 md:p-5">
          <div className="text-base font-medium text-ink-700">שולם</div>
          <div className="text-2xl md:text-4xl font-bold mt-1 tabular-nums text-emerald-700">
            {formatCurrency(totals.paid)}
          </div>
          <div className="text-sm text-ink-500 mt-1">
            {formatDecimalHoursAsHHMM(totals.hours)} שעות
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href={`/tasks?new=1&patient=${patient.id}`} className="action-btn">
          + פגישה / משימה
        </Link>
        <button
          type="button"
          className={"action-btn" + (chargeFormOpen ? " action-btn-active" : "")}
          onClick={openChargeForm}
        >
          + חיוב
        </button>
        <button
          type="button"
          className={"action-btn" + (expenseOpen ? " action-btn-active" : "")}
          onClick={openExpenseForm}
        >
          + נסיעה / הוצאה
        </button>
        <button
          type="button"
          className={"action-btn action-btn-pay" + (paymentFormOpen ? " action-btn-active" : "")}
          onClick={openPaymentForm}
          disabled={!hasDebt}
          title={hasDebt ? undefined : "אין חוב פתוח"}
        >
          ✓ קיבלתי תשלום
        </button>
      </section>

      {chargeFormOpen && (
        <section className="card p-5 border-accent-200">
          <h2 className="text-xl font-bold text-ink-900">חיוב חדש</h2>
          <form onSubmit={saveCharge} className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="label" htmlFor="charge-label">
                  על מה?
                </label>
                <input
                  id="charge-label"
                  className="input"
                  placeholder="למשל: פדיקור"
                  value={chargeLabel}
                  onChange={(e) => setChargeLabel(e.target.value)}
                  autoFocus
                />
              </div>
              {!chargeByPercent && (
                <div>
                  <label className="label" htmlFor="charge-amount">
                    סכום (₪)
                  </label>
                  <input
                    id="charge-amount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    className="input"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="label" htmlFor="charge-date">
                  תאריך
                </label>
                <input
                  id="charge-date"
                  type="date"
                  className="input"
                  value={chargeDate}
                  onChange={(e) => setChargeDate(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-base text-ink-900 cursor-pointer w-fit min-h-[44px]">
              <input
                type="checkbox"
                className="w-5 h-5 accent-accent-600"
                checked={chargeByPercent}
                onChange={(e) => {
                  setChargeByPercent(e.target.checked);
                  if (e.target.checked && !chargeLabel.trim()) setChargeLabel("12% מתשלום ביטוח");
                }}
              />
              לחשב לפי אחוז (למשל 12% מביטוח)
            </label>
            {chargeByPercent && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="label" htmlFor="charge-base">
                    הסכום שהתקבל (₪)
                  </label>
                  <input
                    id="charge-base"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    className="input"
                    value={chargeBase}
                    onChange={(e) => setChargeBase(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="charge-percent">
                    אחוז (%)
                  </label>
                  <input
                    id="charge-percent"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    className="input"
                    value={chargePercent}
                    onChange={(e) => setChargePercent(e.target.value)}
                  />
                </div>
                <div className="col-span-2 text-base pb-2">
                  חיוב: <span className="font-bold text-accent-700">{formatCurrency(percentAmount)}</span>
                </div>
              </div>
            )}
            {chargeError && <p className="text-red-700 text-sm">{chargeError}</p>}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary min-h-[44px] px-8" disabled={savingCharge}>
                {savingCharge ? "שומר..." : "שמירה"}
              </button>
              <button
                type="button"
                className="btn-ghost min-h-[44px]"
                onClick={closeChargeForm}
                disabled={savingCharge}
              >
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      {expenseOpen && (
        <PatientExpenses
          patientId={id}
          tasks={tasks}
          onSaved={loadAll}
          onClose={() => setExpenseOpen(false)}
        />
      )}

      {paymentFormOpen && (
        <section className="card p-5 border-emerald-200 space-y-4">
          <h2 className="text-xl font-bold text-ink-900">קיבלתי תשלום</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="payment-amount">
                כמה התקבל? (₪)
              </label>
              <input
                id="payment-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="input text-xl font-semibold"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="text-sm text-accent-700 hover:underline mt-1 min-h-[32px]"
                onClick={() => setPaymentAmount(String(Math.round(totals.unpaid * 100) / 100))}
              >
                כל החוב ({formatCurrency(totals.unpaid)})
              </button>
            </div>
            <div className="md:col-span-2 min-w-0">
              <label className="label" htmlFor="payment-target">
                על חשבון (לא חובה)
              </label>
              <select
                id="payment-target"
                className="input"
                value={paymentTargetId}
                onChange={(e) => setPaymentTargetId(e.target.value)}
              >
                <option value="">אוטומטי — החוב הכי ישן קודם</option>
                {unpaidTasksAsc
                  .filter((t) => remainingAmount(t) > 0.009)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.task_definition || "משימה").slice(0, 40)}
                      {t.date_gregorian ? ` · ${formatDate(t.date_gregorian)}` : ""}
                      {` · נשאר ${formatCurrency(remainingAmount(t))}`}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <div className="label">איך שולם?</div>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={"chip" + (paymentMethod === m ? " chip-on" : "")}
                  aria-pressed={paymentMethod === m}
                  onClick={() => setPaymentMethod(paymentMethod === m ? "" : m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="payment-note">
              הערה (לא חובה)
            </label>
            <input
              id="payment-note"
              className="input"
              placeholder={paymentMethod === "ברטר" ? "למשל: פדיקור" : ""}
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
            />
          </div>

          {paymentAllocation.allocations.length > 0 && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1">
              <div className="text-sm font-semibold text-emerald-800">התשלום ייכנס על:</div>
              <ul className="text-sm text-ink-900 space-y-1">
                {paymentAllocation.allocations.map(({ task: t, apply, after }) => (
                  <li key={t.id} className="flex flex-wrap gap-x-2">
                    <span className="truncate max-w-[60vw] md:max-w-md">
                      {(t.task_definition || "משימה").slice(0, 60)}
                      {t.date_gregorian ? ` (${formatDate(t.date_gregorian)})` : ""}
                    </span>
                    <span className="font-semibold">{formatCurrency(apply)}</span>
                    <span className="text-ink-500">
                      {after > 0.009 ? `· נשאר ${formatCurrency(after)}` : "· נסגר ✓"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {paymentAllocation.leftover > 0.009 && (
            <p className="text-sm text-amber-700">
              {formatCurrency(paymentAllocation.leftover)} יותר מהחוב — הסכום הזה לא יירשם.
            </p>
          )}

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              className="btn-primary min-h-[44px] px-8 bg-emerald-600 hover:bg-emerald-700"
              onClick={recordPayment}
              disabled={recordingPayment || paymentAllocation.allocations.length === 0}
            >
              {recordingPayment
                ? "שומר..."
                : `שמירה — ${formatCurrency(paymentAllocation.totalApplied)}`}
            </button>
            <button
              type="button"
              className="btn-ghost min-h-[44px]"
              onClick={closePaymentForm}
              disabled={recordingPayment}
            >
              ביטול
            </button>
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div
          className={
            "px-5 py-4 border-b border-line flex items-center justify-between gap-3 " +
            (hasDebt ? "bg-red-50/60" : "bg-emerald-50/60")
          }
        >
          <h2 className="text-lg font-semibold text-ink-900">
            לא שולם <span className="text-ink-500 font-normal">({unpaidTasks.length})</span>
          </h2>
          <span className={"text-lg font-bold tabular-nums " + (hasDebt ? "text-red-700" : "text-emerald-700")}>
            {formatCurrency(totals.unpaid)}
          </span>
        </div>
        <PatientTasksList
          items={unpaidTasks}
          emptyText="אין חובות פתוחים 🎉"
          onTogglePaid={togglePaymentStatus}
          onDelete={askDeleteTask}
          getAmount={remainingAmount}
        />
      </section>

      <Collapsible title="שולם" count={paidTasks.length}>
        <PatientTasksList
          items={paidTasks}
          emptyText="עדיין אין שורות ששולמו"
          onTogglePaid={togglePaymentStatus}
          onDelete={askDeleteTask}
        />
      </Collapsible>

      <Collapsible title="תשלומים שהתקבלו" count={payments.length}>
        <div className="divide-y divide-line">
          {payments.length === 0 ? (
            <p className="p-6 text-center text-ink-500">עדיין לא נרשמו תשלומים.</p>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-500 flex items-center gap-2 flex-wrap min-w-0">
                    <span className="whitespace-nowrap">{formatDate(p.paid_at)}</span>
                    {p.method && <span className="badge-neutral">{p.method}</span>}
                    {p.note && <span className="text-ink-700">{p.note}</span>}
                  </span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
                {Array.isArray(p.allocations) && p.allocations.length > 0 && (
                  <ul className="mt-1.5 text-xs text-ink-500 space-y-0.5">
                    {p.allocations.map((a, i) => (
                      <li key={i}>
                        • {(a.task_definition || "משימה").slice(0, 70)}
                        {a.date_gregorian ? ` (${formatDate(a.date_gregorian)})` : ""} —{" "}
                        <span className="font-medium text-ink-700">{formatCurrency(a.amount)}</span>{" "}
                        {a.fully_paid ? "· נסגר" : "· חלקי"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </Collapsible>

      <Collapsible title="דף תשלומים להדפסה / שליחה">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="export-status">
                מה לכלול
              </label>
              <select
                id="export-status"
                className="input"
                value={exportStatus}
                onChange={(e) => setExportStatus(e.target.value)}
              >
                <option value="all">הכל</option>
                <option value="unpaid">רק מה שלא שולם</option>
                <option value="paid">רק מה ששולם</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="export-from">
                מתאריך (לא חובה)
              </label>
              <input
                id="export-from"
                type="date"
                className="input"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="export-to">
                עד תאריך (לא חובה)
              </label>
              <input
                id="export-to"
                type="date"
                className="input"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <button type="button" className="btn-primary min-h-[44px]" onClick={printPaymentsSheet}>
              🖨 הדפסה / PDF
            </button>
            <button type="button" className="btn-ghost min-h-[44px]" onClick={downloadPaymentsExcel}>
              ⬇ Excel
            </button>
            <span className="text-sm text-ink-500">{exportTasks.length} שורות</span>
          </div>
        </div>
      </Collapsible>

      {hasDetails && (
        <Collapsible title="פרטים ותעריפים">
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="אימייל" value={patient.email} />
            <Field
              label="מחיר לשעה"
              value={patient.hourly_rate != null ? formatCurrency(patient.hourly_rate) : null}
            />
            <Field
              label="אחרי הנחה"
              value={
                patient.hourly_rate_discounted != null
                  ? formatCurrency(patient.hourly_rate_discounted)
                  : null
              }
            />
            {Array.isArray(patient.extra_rates) &&
              patient.extra_rates.map((r, i) => (
                <Field key={i} label={r.label} value={formatCurrency(r.rate)} />
              ))}
          </div>
        </Collapsible>
      )}

      {taskToDelete && (
        <DeleteTaskDialog
          task={taskToDelete}
          deleting={deletingTask}
          error={deleteTaskError}
          onCancel={cancelDeleteTask}
          onConfirm={confirmDeleteTask}
        />
      )}

      <Collapsible title="אנשי קשר" count={linkedContacts.length}>
        {!contactFormOpen && (
          <div className="px-5 pt-4">
            <button type="button" className="btn-ghost min-h-[44px]" onClick={openContactForm}>
              + הוספת איש קשר
            </button>
          </div>
        )}

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
                <label className="label">בחירת איש קשר</label>
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
              אין עדיין אנשי קשר.
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
      </Collapsible>

      <Collapsible title="מסמכים" count={docs.length + documents.length}>
        {!uploadOpen && (
          <div className="px-5 pt-4">
            <button type="button" className="btn-ghost min-h-[44px]" onClick={() => setUploadOpen(true)}>
              + העלאת מסמכים
            </button>
          </div>
        )}

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
                <label className="label">קבצים *</label>
                <MultiFilePicker
                  files={uploadFiles}
                  onChange={setUploadFiles}
                  disabled={uploading}
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
                {uploading
                  ? `מעלה ${uploadProgress}...`
                  : uploadFiles.length > 1
                    ? `העלאת ${uploadFiles.length} קבצים`
                    : "העלאה ושמירה"}
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
              אין עדיין מסמכים.
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
      </Collapsible>

      {error && <p className="text-red-700 text-sm">{error}</p>}
    </div>
  );
}
