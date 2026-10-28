"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

// Amounts are stored signed: an addition (money set aside) is positive,
// a deduction (money given out of it) is negative — so the sum is the
// balance left. The form always takes a positive number plus a direction.
const emptyForm = {
  date: "",
  direction: "in",
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
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [r.purpose, r.notes, String(r.amount || ""), r.date].some((v) =>
        String(v || "").toLowerCase().includes(q),
      ),
    );
  }, [records, searchTerm]);

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
      direction: Number(r.amount) < 0 ? "out" : "in",
      amount: r.amount == null ? "" : Math.abs(Number(r.amount)),
      purpose: r.purpose || "",
      notes: r.notes || "",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const abs = Math.abs(Number(form.amount));
    if (form.amount === "" || !(abs > 0)) {
      setError("יש להזין סכום גדול מ-0.");
      return;
    }
    setSaving(true);
    const payload = {
      date: form.date || null,
      amount: form.direction === "out" ? -abs : abs,
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

  const totals = useMemo(() => {
    let added = 0,
      deducted = 0;
    records.forEach((r) => {
      const n = Number(r.amount) || 0;
      if (n < 0) deducted -= n;
      else added += n;
    });
    return { added, deducted, balance: added - deducted };
  }, [records]);

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
          <p className="page-subtitle">
            הוספה — כסף שנכנס לקופה. הורדה — כסף שיצא ממנה. היתרה מחושבת
            אוטומטית.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            placeholder="חיפוש..."
            className="input md:max-w-xs"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={openAddForm}>
              + הוספת רישום
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-label">נוסף</div>
          <div className="stat-value text-emerald-700">
            {formatCurrency(totals.added)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ירד</div>
          <div className="stat-value text-red-700">
            {formatCurrency(totals.deducted)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">יתרה ({records.length} רישומים)</div>
          <div className="stat-value-accent">{formatCurrency(totals.balance)}</div>
        </div>
      </section>

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
          <div className="md:col-span-4">
            <label className="label">סוג</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={form.direction === "in" ? "btn-primary" : "btn-ghost"}
                onClick={() => update("direction", "in")}
              >
                + הוספה
              </button>
              <button
                type="button"
                className={form.direction === "out" ? "btn-primary" : "btn-ghost"}
                onClick={() => update("direction", "out")}
              >
                − הורדה
              </button>
            </div>
          </div>
          <div>
            <label className="label">סכום (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
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
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-500 py-6">
                  {searchTerm ? "אין תוצאות לחיפוש" : "אין רישומים"}
                </td>
              </tr>
            ) : (
              filteredRecords.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    {formatDate(r.date)}
                  </td>
                  <td
                    className={`whitespace-nowrap font-medium ${
                      Number(r.amount) < 0 ? "text-red-700" : "text-emerald-700"
                    }`}
                  >
                    {Number(r.amount) < 0 ? "− " : "+ "}
                    {formatCurrency(Math.abs(Number(r.amount) || 0))}
                  </td>
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
