"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

const STATUSES = ["פעיל", "לא פעיל", "בהמתנה"];

const emptyForm = {
  full_name: "",
  phone: "",
  email: "",
  status: "פעיל",
  notes: "",
  treatment_type: "",
  hourly_rate: "",
  hourly_rate_discounted: "",
  extra_rates: [], // [{label, rate}]
};

function toNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function PatientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // Document upload form state
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [docPatientId, setDocPatientId] = useState("");
  const [docType, setDocType] = useState("");
  const [docFile, setDocFile] = useState(null);
  const [docNotes, setDocNotes] = useState("");
  const [docUploading, setDocUploading] = useState(false);

  function openDocForm() {
    setDocPatientId("");
    setDocType("");
    setDocFile(null);
    setDocNotes("");
    setFormOpen(false);
    setDocFormOpen(true);
  }

  function closeDocForm() {
    setDocFormOpen(false);
    setDocPatientId("");
    setDocType("");
    setDocFile(null);
    setDocNotes("");
  }

  async function handleDocSubmit(e) {
    e.preventDefault();
    if (!docPatientId) {
      alert("יש לבחור מטופל");
      return;
    }
    if (!docFile) {
      alert("יש לבחור קובץ");
      return;
    }
    setDocUploading(true);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      setDocUploading(false);
      alert("אין סשן פעיל. נא להתחבר מחדש.");
      return;
    }

    const safe = (s) =>
      String(s || "file").replace(/[^a-zA-Z0-9א-ת._-]+/g, "_").slice(0, 80);
    const path = `patient-docs/${docPatientId}/${Date.now()}_${safe(docFile.name)}`;

    const { data: up, error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, docFile, { upsert: false });

    if (upErr) {
      console.error("[doc upload] storage error:", upErr);
      const detail =
        upErr.message ||
        upErr.error ||
        JSON.stringify(upErr, Object.getOwnPropertyNames(upErr || {}));
      setDocUploading(false);
      alert("העלאת הקובץ נכשלה (Supabase Storage):\n\n" + detail);
      return;
    }

    const { data: pub } = supabase.storage
      .from("documents")
      .getPublicUrl(up.path);
    const file_url = pub?.publicUrl;

    const { error: insErr } = await supabase
      .from("patient_documents")
      .insert([
        {
          patient_id: docPatientId,
          doc_type: docType || null,
          notes: docNotes || null,
          file_url,
        },
      ]);

    if (insErr) {
      console.error("[doc upload] db insert error:", insErr);
      const detail =
        insErr.message ||
        insErr.details ||
        JSON.stringify(insErr, Object.getOwnPropertyNames(insErr || {}));
      setDocUploading(false);
      alert(
        "שמירת המסמך ב-DB נכשלה (patient_documents):\n\n" + detail,
      );
      return;
    }

    setDocUploading(false);
    closeDocForm();
    alert("המסמך הועלה. הוא יופיע בכרטיס המטופל.");
  }

  async function load() {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setPatients(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Handle ?edit=<id> coming from the patient card "edit" link
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && patients.length > 0) {
      const p = patients.find((x) => x.id === editId);
      if (p) {
        startEdit(p);
        router.replace("/patients");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, patients]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startEdit(p) {
    setEditingId(p.id);
    setForm({
      full_name: p.full_name || "",
      phone: p.phone || "",
      email: p.email || "",
      status: p.status || "פעיל",
      notes: p.notes || "",
      treatment_type: p.treatment_type || "",
      hourly_rate: p.hourly_rate ?? "",
      hourly_rate_discounted: p.hourly_rate_discounted ?? "",
      extra_rates: Array.isArray(p.extra_rates) ? p.extra_rates : [],
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addExtraRate() {
    setForm((f) => ({
      ...f,
      extra_rates: [...(f.extra_rates || []), { label: "", rate: "" }],
    }));
  }

  function updateExtraRate(idx, field, value) {
    setForm((f) => ({
      ...f,
      extra_rates: f.extra_rates.map((r, i) =>
        i === idx ? { ...r, [field]: value } : r,
      ),
    }));
  }

  function removeExtraRate(idx) {
    setForm((f) => ({
      ...f,
      extra_rates: f.extra_rates.filter((_, i) => i !== idx),
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function openAddForm() {
    resetForm();
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setError("יש להזין שם מטופל");
      return;
    }
    setError("");
    setSaving(true);
    const cleanExtraRates = (form.extra_rates || [])
      .map((r) => ({
        label: String(r.label || "").trim(),
        rate: toNumOrNull(r.rate),
      }))
      .filter((r) => r.label && r.rate !== null && r.rate > 0);

    const payload = {
      full_name: form.full_name,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      notes: form.notes || null,
      treatment_type: form.treatment_type || null,
      hourly_rate: toNumOrNull(form.hourly_rate),
      hourly_rate_discounted: toNumOrNull(form.hourly_rate_discounted),
      extra_rates: cleanExtraRates,
    };
    let saveError = null;
    if (editingId) {
      const { error: e } = await supabase
        .from("patients")
        .update(payload)
        .eq("id", editingId);
      saveError = e;
    } else {
      const { error: e } = await supabase
        .from("patients")
        .insert([payload]);
      saveError = e;
    }
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    closeForm();
    load();
  }

  async function handleDelete(id) {
    if (!confirm("למחוק את המטופל?")) return;
    const { error } = await supabase.from("patients").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">מטופלים</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">מטופלים</h1>
          <p className="page-subtitle">ניהול רשימת המטופלים ותעריפים.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">סה״כ: {patients.length}</span>
          {!formOpen && !docFormOpen && (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={openDocForm}
              >
                + הוספת מסמך
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={openAddForm}
              >
                + הוספת מטופל
              </button>
            </>
          )}
        </div>
      </header>

      {docFormOpen && (
        <form onSubmit={handleDocSubmit} className="card p-6 space-y-5">
          <h2 className="section-title">העלאת מסמך</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="label">מטופל *</label>
              <select
                className="input"
                value={docPatientId}
                onChange={(e) => setDocPatientId(e.target.value)}
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
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">קובץ *</label>
              <input
                type="file"
                className="text-sm"
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                required
              />
              {docFile && (
                <p className="text-xs text-ink-500 mt-1">
                  {docFile.name} ({Math.round(docFile.size / 1024)} KB)
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="label">הערות</label>
              <textarea
                className="input min-h-[80px]"
                value={docNotes}
                onChange={(e) => setDocNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="btn-primary"
              disabled={docUploading}
            >
              {docUploading ? "מעלה..." : "שמירת מסמך"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={closeDocForm}
              disabled={docUploading}
            >
              ביטול
            </button>
          </div>
        </form>
      )}

      {formOpen && (
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <h2 className="section-title">
          {editingId ? "עריכת מטופל" : "הוספת מטופל"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="label">שם מלא *</label>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => update("full_name", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">טלפון</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="label">אימייל</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div>
            <label className="label">סטטוס</label>
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
            <label className="label">סוג טיפול</label>
            <input
              className="input"
              value={form.treatment_type}
              onChange={(e) => update("treatment_type", e.target.value)}
            />
          </div>
          <div>
            <label className="label">מחיר לשעה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.hourly_rate}
              onChange={(e) => update("hourly_rate", e.target.value)}
            />
          </div>
          <div>
            <label className="label">מחיר לשעה אחרי הנחה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.hourly_rate_discounted}
              onChange={(e) => update("hourly_rate_discounted", e.target.value)}
            />
          </div>

          <div className="md:col-span-2 border-t border-line pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="label mb-0">תעריפים נוספים</label>
              <button
                type="button"
                onClick={addExtraRate}
                className="text-sm text-accent-700 hover:bg-accent-50 px-3 py-1 rounded-md"
              >
                + הוספת תעריף
              </button>
            </div>
            {(form.extra_rates || []).length === 0 ? (
              <p className="text-xs text-ink-500">
                ניתן להוסיף סוגי חיוב נוספים (למשל "פרונטלית 300 ₪", "ליווי 180 ₪") שיופיעו כבחירה בעת יצירת משימה.
              </p>
            ) : (
              <div className="space-y-2">
                {form.extra_rates.map((r, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-end gap-2 bg-surface-subtle border border-line rounded-md p-3"
                  >
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-xs text-ink-500 block mb-1">
                        תיאור / שם התעריף
                      </label>
                      <input
                        className="input"
                        placeholder="פגישה פרונטלית / ליווי / וכו'"
                        value={r.label}
                        onChange={(e) =>
                          updateExtraRate(idx, "label", e.target.value)
                        }
                      />
                    </div>
                    <div className="w-32">
                      <label className="text-xs text-ink-500 block mb-1">
                        מחיר לשעה (₪)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={r.rate}
                        onChange={(e) =>
                          updateExtraRate(idx, "rate", e.target.value)
                        }
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExtraRate(idx)}
                      className="text-red-700 hover:bg-red-50 w-9 h-9 rounded-md flex items-center justify-center"
                      title="הסרת תעריף"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="label">הערות</label>
            <textarea
              className="input min-h-[80px]"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-red-700 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "שומר..." : editingId ? "עדכן מטופל" : "שמור מטופל"}
          </button>
          <button type="button" className="btn-ghost" onClick={closeForm}>
            ביטול
          </button>
        </div>
      </form>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>שם מלא</th>
              <th>טלפון</th>
              <th>אימייל</th>
              <th>סטטוס</th>
              <th>סוג טיפול</th>
              <th>מחיר לשעה</th>
              <th>אחרי הנחה</th>
              <th>הערות</th>
              <th>תאריך יצירה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="text-center text-ink-500 py-6">
                  טוען...
                </td>
              </tr>
            ) : patients.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center text-ink-500 py-6">
                  אין מטופלים עדיין
                </td>
              </tr>
            ) : (
              patients.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/patients/${p.id}`)}
                  className="cursor-pointer"
                >
                  <td className="font-medium">{p.full_name}</td>
                  <td>{p.phone}</td>
                  <td>{p.email}</td>
                  <td>{p.status}</td>
                  <td>{p.treatment_type || "—"}</td>
                  <td>
                    {p.hourly_rate != null
                      ? formatCurrency(p.hourly_rate)
                      : "—"}
                  </td>
                  <td>
                    {p.hourly_rate_discounted != null
                      ? formatCurrency(p.hourly_rate_discounted)
                      : "—"}
                  </td>
                  <td className="max-w-xs truncate">{p.notes}</td>
                  <td className="text-ink-500 whitespace-nowrap">
                    {formatDate(p.created_at)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      <IconButton
                        variant="edit"
                        title="עריכה"
                        onClick={() => startEdit(p)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => handleDelete(p.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </div>
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
