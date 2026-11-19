"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import SetupNotice from "@/components/SetupNotice";
import { ChevronDownIcon, EditIcon, IconButton } from "@/components/Icons";
import { useUI } from "@/components/UIProvider";
import { remainingAmount } from "@/components/PatientTasksList";
import { formatCurrency } from "@/lib/format";

const STATUSES = ["פעיל", "לא פעיל", "בהמתנה"];
const UNPAID_STATUSES = ["לא שולם", "שולם חלקית"];

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

// Open balance per patient, from all unpaid / partly paid rows. Paged,
// because Supabase silently returns at most 1,000 rows per request.
async function loadBalances() {
  const PAGE = 1000;
  const balances = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, patient_id, total_after_discount, paid_amount, payment_status")
      .in("payment_status", UNPAID_STATUSES)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { balances: null, error };
    for (const t of data || []) {
      if (!t.patient_id) continue;
      balances[t.patient_id] = (balances[t.patient_id] || 0) + remainingAmount(t);
    }
    if (!data || data.length < PAGE) break;
  }
  return { balances, error: null };
}

export default function PatientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ui = useUI();
  const [patients, setPatients] = useState([]);
  const [balances, setBalances] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPatients = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = !q
      ? patients
      : patients.filter((p) =>
          [p.full_name, p.phone, p.email, p.status, p.treatment_type, p.notes].some((v) =>
            String(v || "").toLowerCase().includes(q),
          ),
        );
    // Active patients first, then alphabetical.
    return [...list].sort((a, b) => {
      const aa = (a.status || "פעיל") === "פעיל" ? 0 : 1;
      const bb = (b.status || "פעיל") === "פעיל" ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return String(a.full_name || "").localeCompare(String(b.full_name || ""), "he");
    });
  }, [patients, searchTerm]);

  async function load() {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    const [{ data, error }, bal] = await Promise.all([
      supabase.from("patients").select("*").order("created_at", { ascending: false }),
      loadBalances(),
    ]);
    if (error) setError(error.message);
    else setPatients(data || []);
    if (bal.error) console.warn("[patients] balances failed:", bal.error.code);
    setBalances(bal.balances);
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
    setError("");
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
      extra_rates: f.extra_rates.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
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
    setError("");
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
      setError("יש לכתוב שם");
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
      full_name: form.full_name.trim(),
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
      const { error: e } = await supabase.from("patients").update(payload).eq("id", editingId);
      saveError = e;
    } else {
      const { error: e } = await supabase.from("patients").insert([payload]);
      saveError = e;
    }
    setSaving(false);
    if (saveError) {
      setError("השמירה נכשלה: " + saveError.message);
      return;
    }
    ui.toast(editingId ? "הפרטים עודכנו" : "המטופל נוסף");
    closeForm();
    load();
  }

  // Deleting a patient is rare and serious — it lives inside the edit form,
  // not as an icon on every row.
  async function handleDelete() {
    if (!editingId) return;
    const ok = await ui.confirm({
      title: `למחוק את ${form.full_name || "המטופל"}?`,
      message: "אי אפשר לבטל את המחיקה.",
      confirmText: "מחיקה",
      danger: true,
    });
    if (!ok) return;
    const { data, error: delErr } = await supabase
      .from("patients")
      .delete()
      .eq("id", editingId)
      .select("id");
    if (delErr || !data?.length) {
      ui.toast("המחיקה נכשלה" + (delErr?.message ? ": " + delErr.message : ""), "error");
      return;
    }
    ui.toast("המטופל נמחק");
    closeForm();
    load();
  }

  if (!supabaseReady) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">מטופלים</h1>
        <SetupNotice />
      </div>
    );
  }

  const hasMore =
    form.email ||
    form.hourly_rate_discounted !== "" ||
    (form.extra_rates || []).length > 0 ||
    (form.status && form.status !== "פעיל");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">מטופלים</h1>
        {!formOpen && (
          <button type="button" className="btn-primary min-h-[44px] px-6 text-base" onClick={openAddForm}>
            + מטופל חדש
          </button>
        )}
      </header>

      {formOpen && (
        <form onSubmit={handleSubmit} className="card p-5 md:p-6 space-y-5 border-accent-200">
          <h2 className="text-xl font-bold text-ink-900">{editingId ? "עריכת פרטים" : "מטופל חדש"}</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="label" htmlFor="p-name">
                שם
              </label>
              <input
                id="p-name"
                className="input"
                value={form.full_name}
                onChange={(e) => update("full_name", e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="p-phone">
                טלפון
              </label>
              <input
                id="p-phone"
                className="input"
                type="tel"
                dir="ltr"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="p-type">
                סוג טיפול
              </label>
              <input
                id="p-type"
                className="input"
                value={form.treatment_type}
                onChange={(e) => update("treatment_type", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="p-rate">
                מחיר לשעה (₪)
              </label>
              <input
                id="p-rate"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="input"
                value={form.hourly_rate}
                onChange={(e) => update("hourly_rate", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="p-notes">
                הערות
              </label>
              <textarea
                id="p-notes"
                className="input min-h-[70px]"
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </div>
          </div>

          <details
            key={editingId || "new"}
            className="collapsible rounded-xl border border-line"
            open={Boolean(editingId && hasMore) || undefined}
          >
            <summary className="flex items-center justify-between gap-3 px-4 min-h-[52px] cursor-pointer select-none text-base font-semibold text-ink-700 hover:bg-surface-subtle rounded-xl">
              עוד פרטים (לא חובה)
              <ChevronDownIcon className="collapsible-chevron w-5 h-5 text-ink-500 transition-transform" />
            </summary>
            <div className="p-4 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="label" htmlFor="p-email">
                  אימייל
                </label>
                <input
                  id="p-email"
                  className="input"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="p-status">
                  מצב
                </label>
                <select
                  id="p-status"
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
                <label className="label" htmlFor="p-rate-disc">
                  מחיר לשעה אחרי הנחה (₪)
                </label>
                <input
                  id="p-rate-disc"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="input"
                  value={form.hourly_rate_discounted}
                  onChange={(e) => update("hourly_rate_discounted", e.target.value)}
                />
              </div>

              <div className="md:col-span-2 border-t border-line pt-4">
                <div className="flex items-center justify-between mb-3 gap-3">
                  <span className="label mb-0">מחירים נוספים (למשל ליווי)</span>
                  <button
                    type="button"
                    onClick={addExtraRate}
                    className="btn-ghost min-h-[44px]"
                  >
                    + מחיר
                  </button>
                </div>
                {(form.extra_rates || []).length > 0 && (
                  <div className="space-y-2">
                    {form.extra_rates.map((r, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-end gap-2 bg-surface-subtle border border-line rounded-lg p-3"
                      >
                        <div className="flex-1 min-w-[150px]">
                          <label className="text-sm text-ink-500 block mb-1">שם</label>
                          <input
                            className="input"
                            placeholder="למשל: ליווי"
                            value={r.label}
                            onChange={(e) => updateExtraRate(idx, "label", e.target.value)}
                          />
                        </div>
                        <div className="w-32">
                          <label className="text-sm text-ink-500 block mb-1">לשעה (₪)</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            className="input"
                            value={r.rate}
                            onChange={(e) => updateExtraRate(idx, "rate", e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExtraRate(idx)}
                          className="text-red-700 hover:bg-red-50 w-11 h-11 rounded-lg flex items-center justify-center"
                          title="הסרה"
                          aria-label="הסרה"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </details>

          {error && <p className="text-red-700 text-sm">{error}</p>}

          <div className="flex gap-3 flex-wrap">
            <button type="submit" className="btn-primary min-h-[44px] px-8 text-base" disabled={saving}>
              {saving ? "שומר..." : "שמירה"}
            </button>
            <button type="button" className="btn-ghost min-h-[44px]" onClick={closeForm}>
              ביטול
            </button>
            {editingId && (
              <button type="button" className="btn-danger min-h-[44px] ms-auto" onClick={handleDelete}>
                מחיקת המטופל
              </button>
            )}
          </div>
        </form>
      )}

      <input
        type="search"
        placeholder="🔍 חיפוש מטופל..."
        className="input text-lg min-h-[52px]"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        aria-label="חיפוש מטופל"
      />

      <div className="card divide-y divide-line overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-ink-500">טוען...</p>
        ) : error && patients.length === 0 ? (
          <p className="p-6 text-center text-red-700">{error}</p>
        ) : filteredPatients.length === 0 ? (
          <p className="p-6 text-center text-ink-500">
            {searchTerm ? "לא נמצא מטופל בשם הזה" : "אין מטופלים עדיין"}
          </p>
        ) : (
          filteredPatients.map((p) => {
            const owed = balances ? balances[p.id] || 0 : null;
            const inactive = (p.status || "פעיל") !== "פעיל";
            return (
              <div
                key={p.id}
                className={"flex items-center gap-2 hover:bg-surface-subtle " + (inactive ? "opacity-60" : "")}
              >
                <Link
                  href={`/patients/${p.id}`}
                  className="flex-1 min-w-0 flex items-center justify-between gap-3 px-5 py-4 min-h-[64px]"
                >
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-ink-900 truncate">{p.full_name}</div>
                    <div className="text-sm text-ink-500 flex flex-wrap gap-x-3">
                      {p.phone && <span dir="ltr">{p.phone}</span>}
                      {p.treatment_type && <span>{p.treatment_type}</span>}
                      {inactive && <span>{p.status}</span>}
                    </div>
                  </div>
                  {owed != null &&
                    (owed > 0.009 ? (
                      <span className="badge-danger text-base whitespace-nowrap">
                        חוב {formatCurrency(owed)}
                      </span>
                    ) : (
                      <span className="badge-success whitespace-nowrap">אין חוב</span>
                    ))}
                </Link>
                <div className="pl-3">
                  <IconButton variant="edit" title="עריכת פרטים" onClick={() => startEdit(p)}>
                    <EditIcon />
                  </IconButton>
                </div>
              </div>
            );
          })
        )}
      </div>
      {!loading && patients.length > 0 && (
        <p className="text-sm text-ink-500">{patients.length} מטופלים</p>
      )}
    </div>
  );
}
