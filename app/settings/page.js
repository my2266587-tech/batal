"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { DeleteIcon, EditIcon, IconButton } from "@/components/Icons";
import { formatDate } from "@/lib/format";

const emptyForm = {
  email: "",
  role: "staff",
  is_active: true,
  notes: "",
};

export default function SettingsPage() {
  const [role, setRole] = useState(undefined);
  const [currentEmail, setCurrentEmail] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.role, u.notes].some((v) =>
        String(v || "").toLowerCase().includes(q),
      ),
    );
  }, [users, searchTerm]);

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      setRole(null);
      return;
    }
    async function init() {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentEmail(userData?.user?.email || "");

      const { data, error } = await supabase.rpc("current_user_role");
      if (error) {
        setRole(null);
        setLoading(false);
        return;
      }
      setRole(data);
      if (data === "admin") {
        await loadUsers();
      } else {
        setLoading(false);
      }
    }
    init();
  }, []);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("authorized_users")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setUsers(data || []);
    setLoading(false);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function openAddForm() {
    setForm(emptyForm);
    setEditingId(null);
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function startEdit(u) {
    setEditingId(u.id);
    setForm({
      email: u.email,
      role: u.role,
      is_active: u.is_active,
      notes: u.notes || "",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email.trim()) {
      setError("יש להזין מייל");
      return;
    }
    setError("");
    setSaving(true);
    const payload = {
      email: form.email.trim(),
      role: form.role,
      is_active: form.is_active,
      notes: form.notes || null,
    };
    let res;
    if (editingId) {
      res = await supabase
        .from("authorized_users")
        .update(payload)
        .eq("id", editingId);
    } else {
      res = await supabase.from("authorized_users").insert([payload]);
    }
    setSaving(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    closeForm();
    loadUsers();
  }

  async function handleDelete(u) {
    if (u.email === currentEmail) {
      alert("אי אפשר למחוק את החשבון שלך עצמך.");
      return;
    }
    if (!confirm(`למחוק את המשתמש ${u.email}?`)) return;
    const { error } = await supabase
      .from("authorized_users")
      .delete()
      .eq("id", u.id);
    if (error) setError(error.message);
    else loadUsers();
  }

  async function toggleActive(u) {
    if (u.email === currentEmail && u.is_active) {
      if (
        !confirm(
          "השבתת החשבון שלך תוציא אותך מהמערכת מיד. להמשיך בכל זאת?",
        )
      )
        return;
    }
    const { error } = await supabase
      .from("authorized_users")
      .update({ is_active: !u.is_active })
      .eq("id", u.id);
    if (error) setError(error.message);
    else loadUsers();
  }

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">הגדרות</h1>
        <SetupNotice />
      </div>
    );
  }

  if (role === undefined) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">הגדרות</h1>
        <p className="text-ink-500 text-sm">טוען...</p>
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="page-title">הגדרות</h1>
          <p className="page-subtitle">
            ניהול משתמשים מורשים — מיועד למנהלי מערכת בלבד.
          </p>
        </header>
        <div className="card p-6 border-amber-200 bg-amber-50">
          <p className="text-amber-900 text-sm">
            אין לך הרשאת מנהל. כדי לנהל משתמשים יש לפנות למנהל המערכת.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">הגדרות</h1>
          <p className="page-subtitle">ניהול משתמשים מורשים במערכת.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            placeholder="חיפוש..."
            className="input md:max-w-xs"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span className="text-sm text-ink-500">סה״כ: {users.length}</span>
          {!formOpen && (
            <button
              type="button"
              className="btn-primary"
              onClick={openAddForm}
            >
              + הוספת משתמש
            </button>
          )}
        </div>
      </header>

      {formOpen && (
        <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          <h2 className="section-title">
            {editingId ? "עריכת משתמש" : "הוספת משתמש"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="label">מייל (Google) *</label>
              <input
                type="email"
                dir="ltr"
                className="input"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                disabled={!!editingId}
                required
                placeholder="example@gmail.com"
              />
              {editingId && (
                <p className="text-xs text-ink-500 mt-1">
                  לא ניתן לשנות מייל קיים. למחוק וליצור חדש אם צריך.
                </p>
              )}
            </div>
            <div>
              <label className="label">תפקיד</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => update("role", e.target.value)}
              >
                <option value="staff">staff — גישה רגילה</option>
                <option value="admin">admin — ניהול משתמשים</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => update("is_active", e.target.checked)}
                />
                <span className="text-sm font-medium text-ink-900">
                  פעיל (יכול להיכנס למערכת)
                </span>
              </label>
            </div>

            <div className="md:col-span-2">
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
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
            >
              {saving ? "שומר..." : editingId ? "עדכון" : "הוספה"}
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
              <th>מייל</th>
              <th>תפקיד</th>
              <th>סטטוס</th>
              <th>הערות</th>
              <th>נוצר</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-ink-500 py-6">
                  טוען...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-ink-500 py-6">
                  {searchTerm ? "אין תוצאות לחיפוש" : "אין משתמשים מורשים"}
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isMe = u.email === currentEmail;
                return (
                  <tr key={u.id} className={isMe ? "bg-accent-50/40" : ""}>
                    <td className="font-medium">
                      <div
                        className="flex items-center gap-2 justify-end"
                        dir="ltr"
                      >
                        {isMe && (
                          <span className="text-[10px] text-accent-700 font-semibold">
                            (את)
                          </span>
                        )}
                        <span>{u.email}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          u.role === "admin"
                            ? "badge-success"
                            : "badge-neutral"
                        }
                      >
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => toggleActive(u)}
                        className={
                          u.is_active
                            ? "badge-success cursor-pointer hover:opacity-80"
                            : "badge-neutral cursor-pointer hover:opacity-80"
                        }
                        title="לחיצה כדי להחליף סטטוס"
                      >
                        {u.is_active ? "פעיל" : "לא פעיל"}
                      </button>
                    </td>
                    <td className="max-w-xs truncate">{u.notes}</td>
                    <td className="text-ink-500 whitespace-nowrap">
                      {formatDate(u.created_at)}
                    </td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <IconButton
                          variant="edit"
                          title="עריכה"
                          onClick={() => startEdit(u)}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          variant="delete"
                          title="מחיקה"
                          onClick={() => handleDelete(u)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-ink-500 leading-6">
        <strong>הערות:</strong> רק admin יכול לראות את העמוד הזה ולערוך משתמשים.
        משתמש <code>staff</code> רואה את שאר המערכת אך לא את ההגדרות. השבתת
        משתמש (סטטוס "לא פעיל") חוסמת את הגישה שלו לנתונים גם אם הוא מצליח
        להתחבר עם Google.
      </div>
    </div>
  );
}
