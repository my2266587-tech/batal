"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatDate } from "@/lib/format";

const CONTACT_TYPES = [
  "ביטוח לאומי",
  "קופת חולים",
  "עירייה",
  "רווחה",
  "עו\"ס",
  "רופא",
  "מטפל חיצוני",
  "אחר",
];

const emptyForm = {
  full_name: "",
  contact_type: "",
  organization: "",
  role: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  async function load() {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("full_name", { ascending: true });
    if (error) setError(error.message);
    setContacts(data || []);
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

  function startEdit(c) {
    setEditingId(c.id);
    setForm({
      full_name: c.full_name || "",
      contact_type: c.contact_type || "",
      organization: c.organization || "",
      role: c.role || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      notes: c.notes || "",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setError("יש להזין שם");
      return;
    }
    setError("");
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      contact_type: form.contact_type || null,
      organization: form.organization || null,
      role: form.role || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
    };
    let saveError = null;
    if (editingId) {
      const { error: e } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", editingId);
      saveError = e;
    } else {
      const { error: e } = await supabase.from("contacts").insert([payload]);
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
    if (
      !confirm(
        "למחוק את גורם הקשר? פעולה זו תסיר אותו גם מכל המטופלות שאליהן הוא משויך.",
      )
    )
      return;
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  const filteredContacts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [
        c.full_name,
        c.contact_type,
        c.organization,
        c.role,
        c.phone,
        c.email,
        c.address,
        c.notes,
      ].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [contacts, searchTerm]);

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">גורמי קשר</h1>
        <SetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">גורמי קשר</h1>
          <p className="page-subtitle">
            ניהול אנשי קשר חיצוניים — ביטוח לאומי, קופ"ח, רווחה, רופאים, מטפלים
            וכו'.
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
          <span className="text-sm text-ink-500">
            {searchTerm
              ? `${filteredContacts.length}/${contacts.length}`
              : `סה״כ: ${contacts.length}`}
          </span>
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={openAddForm}>
              + הוספת גורם קשר
            </button>
          )}
        </div>
      </header>

      {formOpen && (
        <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          <h2 className="section-title">
            {editingId ? "עריכת גורם קשר" : "הוספת גורם קשר"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="label">שם *</label>
              <input
                className="input"
                value={form.full_name}
                onChange={(e) => update("full_name", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">סוג גורם</label>
              <input
                className="input"
                list="contact-types-list"
                placeholder="בחרי או הקלידי"
                value={form.contact_type}
                onChange={(e) => update("contact_type", e.target.value)}
              />
              <datalist id="contact-types-list">
                {CONTACT_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="label">ארגון</label>
              <input
                className="input"
                placeholder="קופ״ח / משרד / מוסד"
                value={form.organization}
                onChange={(e) => update("organization", e.target.value)}
              />
            </div>
            <div>
              <label className="label">תפקיד</label>
              <input
                className="input"
                value={form.role}
                onChange={(e) => update("role", e.target.value)}
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
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">כתובת / סניף</label>
              <input
                className="input"
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
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
              {saving ? "שומר..." : editingId ? "עדכן" : "שמור"}
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
              <th>שם</th>
              <th>סוג</th>
              <th>ארגון</th>
              <th>תפקיד</th>
              <th>טלפון</th>
              <th>אימייל</th>
              <th>כתובת / סניף</th>
              <th>הערות</th>
              <th>נוצר</th>
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
            ) : filteredContacts.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center text-ink-500 py-6">
                  {searchTerm ? "אין תוצאות לחיפוש" : "אין עדיין גורמי קשר"}
                </td>
              </tr>
            ) : (
              filteredContacts.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.full_name}</td>
                  <td>
                    {c.contact_type ? (
                      <span className="badge-info">{c.contact_type}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{c.organization || "—"}</td>
                  <td>{c.role || "—"}</td>
                  <td className="whitespace-nowrap">{c.phone || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td className="max-w-xs truncate">{c.address || "—"}</td>
                  <td className="max-w-xs truncate">{c.notes || "—"}</td>
                  <td className="text-ink-500 whitespace-nowrap">
                    {formatDate(c.created_at)}
                  </td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <IconButton
                        variant="edit"
                        title="עריכה"
                        onClick={() => startEdit(c)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        variant="delete"
                        title="מחיקה"
                        onClick={() => handleDelete(c.id)}
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
