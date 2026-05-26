"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, DocumentIcon, IconButton } from "@/components/Icons";
import { formatDate } from "@/lib/format";

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

export default function DocumentsPage() {
  const [patients, setPatients] = useState([]);
  const [docs, setDocs] = useState([]);
  const [taskDocs, setTaskDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterPatient, setFilterPatient] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Upload form
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uPatientId, setUPatientId] = useState("");
  const [uDocType, setUDocType] = useState("");
  const [uNotes, setUNotes] = useState("");
  const [uFile, setUFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function loadAll() {
    setLoading(true);
    const [pRes, dRes, tRes] = await Promise.all([
      supabase.from("patients").select("id, full_name").order("full_name"),
      supabase
        .from("patient_documents")
        .select("*")
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("tasks")
        .select(
          "id, patient_id, date_gregorian, task_definition, documents_url, meeting_type",
        )
        .not("documents_url", "is", null)
        .neq("documents_url", "")
        .order("date_gregorian", { ascending: false, nullsFirst: false })
        .order("start_time", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);
    if (pRes.error) setError(pRes.error.message);
    if (dRes.error) setError(dRes.error.message);
    if (tRes.error) setError(tRes.error.message);
    setPatients(pRes.data || []);
    setDocs(dRes.data || []);
    setTaskDocs(tRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    loadAll();
  }, []);

  const patientNameById = useMemo(() => {
    const m = {};
    patients.forEach((p) => (m[p.id] = p.full_name));
    return m;
  }, [patients]);

  const filteredDocs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return docs.filter((d) => {
      if (filterPatient && d.patient_id !== filterPatient) return false;
      if (q) {
        const hay = [
          patientNameById[d.patient_id],
          d.doc_type,
          d.notes,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, filterPatient, searchTerm, patientNameById]);

  const filteredTaskDocs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return taskDocs.filter((t) => {
      if (filterPatient && t.patient_id !== filterPatient) return false;
      if (q) {
        const hay = [
          patientNameById[t.patient_id],
          t.task_definition,
          t.meeting_type,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [taskDocs, filterPatient, searchTerm, patientNameById]);

  function resetUpload() {
    setUPatientId("");
    setUDocType("");
    setUNotes("");
    setUFile(null);
    setUploadError("");
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uPatientId) {
      setUploadError("יש לבחור מטופל");
      alert("יש לבחור מטופל");
      return;
    }
    if (!uFile) {
      setUploadError("יש לבחור קובץ");
      alert("יש לבחור קובץ");
      return;
    }
    setUploadError("");
    setUploading(true);

    // STEP 1: session
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

    // STEP 2: authorization
    const { data: isAuth, error: authErr } = await supabase.rpc("is_authorized");
    console.log("[upload step 2] is_authorized:", isAuth, "err:", authErr);
    if (authErr) {
      const msg =
        "STEP 2 — is_authorized נכשל. " + describeError(authErr, "שגיאה");
      alert(msg + "\n\n" + fullDump(authErr));
      setUploadError(msg);
      setUploading(false);
      return;
    }
    if (!isAuth) {
      const msg = `STEP 2 — המשתמש ${userEmail} אינו מורשה.`;
      alert(msg);
      setUploadError(msg);
      setUploading(false);
      return;
    }

    // STEP 3: storage upload
    const path = `patient-docs/${uPatientId}/${Date.now()}_${sanitize(uFile.name)}`;
    console.log("[upload step 3] bucket=documents path=", path);
    const { data: up, error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, uFile, { upsert: false });
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

    // STEP 4: public URL
    const { data: pub } = supabase.storage
      .from("documents")
      .getPublicUrl(up.path);
    const file_url = pub?.publicUrl;
    console.log("[upload step 4] file_url:", file_url);

    // STEP 5: insert metadata
    const { error: insErr } = await supabase.from("patient_documents").insert([
      {
        patient_id: uPatientId,
        doc_type: uDocType || null,
        notes: uNotes || null,
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

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">מסמכים</h1>
        <SetupNotice />
      </div>
    );
  }

  const totalCount = filteredDocs.length + filteredTaskDocs.length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">מסמכים</h1>
          <p className="page-subtitle">
            ניהול מסמכים של מטופלים, עם סינון לפי מטופל.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">סה״כ: {totalCount}</span>
          {!uploadOpen && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setUPatientId(filterPatient || "");
                setUploadOpen(true);
              }}
            >
              + העלאת מסמך
            </button>
          )}
        </div>
      </header>

      {uploadOpen && (
        <form onSubmit={handleUpload} className="card p-6 space-y-5">
          <h2 className="section-title">העלאת מסמך</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="label">מטופל *</label>
              <select
                className="input"
                value={uPatientId}
                onChange={(e) => setUPatientId(e.target.value)}
                required
              >
                <option value="">— בחרי —</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">סוג מסמך</label>
              <input
                className="input"
                placeholder="לדוגמה: תעודה, דוח, אישור"
                value={uDocType}
                onChange={(e) => setUDocType(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">קובץ *</label>
              <input
                type="file"
                className="text-sm"
                onChange={(e) => setUFile(e.target.files?.[0] || null)}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">הערות</label>
              <textarea
                className="input min-h-[70px]"
                value={uNotes}
                onChange={(e) => setUNotes(e.target.value)}
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

      <div className="card p-5 space-y-4">
        <input
          type="search"
          placeholder="חיפוש (סוג מסמך, הערות, שם מטופל)..."
          className="input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div>
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
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>מטופל</th>
              <th>סוג</th>
              <th>הערות</th>
              <th>מקור</th>
              <th>פתיחה</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center text-ink-500 py-8">
                  טוען...
                </td>
              </tr>
            ) : totalCount === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-ink-500 py-8">
                  אין מסמכים להצגה — לחצי "+ העלאת מסמך" כדי להוסיף.
                </td>
              </tr>
            ) : (
              <>
                {filteredDocs.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">
                      {formatDate(d.uploaded_at)}
                    </td>
                    <td className="font-medium">
                      {patientNameById[d.patient_id] || "—"}
                    </td>
                    <td>
                      {d.doc_type ? (
                        <span className="badge-info">{d.doc_type}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-md">
                      <div className="line-clamp-2 text-sm whitespace-pre-wrap">
                        {d.notes || "—"}
                      </div>
                    </td>
                    <td>
                      <span className="badge-neutral">מסמך</span>
                    </td>
                    <td>
                      <a
                        href={d.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-700 hover:underline font-medium text-sm"
                      >
                        פתיחה
                      </a>
                    </td>
                    <td>
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => deleteDoc(d)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </td>
                  </tr>
                ))}
                {filteredTaskDocs.map((t) => (
                  <tr key={`task-${t.id}`}>
                    <td className="whitespace-nowrap">
                      {formatDate(t.date_gregorian) || "—"}
                    </td>
                    <td className="font-medium">
                      {patientNameById[t.patient_id] || "—"}
                    </td>
                    <td>
                      {t.meeting_type ? (
                        <span className="badge-info">{t.meeting_type}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-md">
                      <div className="line-clamp-2 text-sm whitespace-pre-wrap">
                        {t.task_definition || "—"}
                      </div>
                    </td>
                    <td>
                      <span className="badge-neutral">משימה</span>
                    </td>
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
                    <td></td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
