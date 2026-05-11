"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency } from "@/lib/format";

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
};

function toNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function PatientsPage() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

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
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    const payload = {
      full_name: form.full_name,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      notes: form.notes || null,
      treatment_type: form.treatment_type || null,
      hourly_rate: toNumOrNull(form.hourly_rate),
      hourly_rate_discounted: toNumOrNull(form.hourly_rate_discounted),
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
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={openAddForm}>
              + הוספת מטופל
            </button>
          )}
        </div>
      </header>

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
                <tr key={p.id}>
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
                    {p.created_at
                      ? new Date(p.created_at).toLocaleDateString("he-IL")
                      : ""}
                  </td>
                  <td>
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
