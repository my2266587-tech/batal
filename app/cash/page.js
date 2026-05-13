"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

const emptyForm = {
  date: "",
  amount: "",
  purpose: "",
  notes: "",
};

export default function CashPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("cash_records")
      .select("*")
      .order("date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setRecords(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function openAddForm() {
    resetForm();
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
    setError("");
  }

  function startEdit(r) {
    setEditingId(r.id);
    setForm({
      date: r.date || "",
      amount: r.amount ?? "",
      purpose: r.purpose || "",
      notes: r.notes || "",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      date: form.date || null,
      amount: form.amount === "" ? null : Number(form.amount),
      purpose: form.purpose || null,
      notes: form.notes || null,
    };
    let res;
    if (editingId) {
      res = await supabase
        .from("cash_records")
        .update(payload)
        .eq("id", editingId);
    } else {
      res = await supabase.from("cash_records").insert([payload]);
    }
    if (res.error) setError(res.error.message);
    setSaving(false);
    if (!res.error) {
      closeForm();
      load();
    }
  }

  async function handleDelete(id) {
    if (!confirm("למחוק את הרישום?")) return;
    const { error } = await supabase
      .from("cash_records")
      .delete()
      .eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  const total = useMemo(
    () => records.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [records],
  );

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">מעשר געלט</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">מעשר געלט</h1>
          <p className="page-subtitle">רישום הוצאות והכנסות.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">
            סה״כ: {formatCurrency(total)} ({records.length} רישומים)
          </span>
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={openAddForm}>
              + הוספת רישום
            </button>
          )}
        </div>
      </header>

      {formOpen && (
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <h2 className="section-title">
          {editingId ? "עריכת רישום" : "הוספת רישום"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <div>
            <label className="label">תאריך</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </div>
          <div>
            <label className="label">סכום (₪)</label>
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">עבור</label>
            <input
              className="input"
              value={form.purpose}
              onChange={(e) => update("purpose", e.target.value)}
            />
          </div>
          <div className="md:col-span-4">
            <label className="label">הערות</label>
            <textarea
              className="input min-h-[70px]"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-red-700 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "שומר..." : editingId ? "עדכן רישום" : "שמור רישום"}
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
              <th>תאריך</th>
              <th>סכום</th>
              <th>עבור</th>
              <th>הערות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-500 py-6">
                  טוען...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-500 py-6">
                  אין רישומים
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    {formatDate(r.date)}
                  </td>
                  <td>{formatCurrency(r.amount)}</td>
                  <td>{r.purpose}</td>
                  <td className="max-w-md">{r.notes}</td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <IconButton
                        variant="edit"
                        title="עריכה"
                        onClick={() => startEdit(r)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => handleDelete(r.id)}
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
