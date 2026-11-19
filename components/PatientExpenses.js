"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/components/UIProvider";
import { DeleteIcon, IconButton } from "@/components/Icons";
import { formatCurrency, formatDate } from "@/lib/format";

// Travel and out-of-pocket expenses she laid out for a patient — e.g. a taxi
// there (₪80) and back (₪60), or ₪1,200 she paid the doctor at a treatment.
// Each line is saved as a regular row in `tasks` (like "הוספת חיוב"), so it
// joins the open balance, the record-payment allocation and the payments
// sheet with no schema change. Travel lines also fill travel / travel_payment,
// so the existing travel totals (summary page) include them.

export const EXPENSE_TYPES = {
  travel: { label: "נסיעה", meetingType: "נסיעה" },
  doctor: { label: "תשלום לרופא", meetingType: "תשלום לרופא" },
  other: { label: "הוצאה אחרת", meetingType: "הוצאה" },
};

const EXPENSE_MEETING_TYPES = ["נסיעה", "תשלום לרופא", "הוצאה"];
export const isExpenseRow = (t) => EXPENSE_MEETING_TYPES.includes(t?.meeting_type);

// Which kind of expense a row is, for colouring it in the task lists:
// "travel" | "doctor" | "other" | null (a regular task/charge).
// Doctor payments saved before they had their own type were stored as
// "הוצאה" with "רופא" in the text — still recognised.
export function expenseKind(t) {
  const type = t?.meeting_type;
  if (type === "נסיעה") return "travel";
  if (type === "תשלום לרופא") return "doctor";
  if (type === "הוצאה")
    return /רופא/.test(t?.task_definition || "") ? "doctor" : "other";
  return null;
}

// Colours live in app/globals.css (.row-* / .badge-*).
export const EXPENSE_STYLES = {
  travel: { label: "נסיעה / מונית", row: "row-travel", badge: "badge-travel", tint: "tint-travel" },
  doctor: { label: "תשלום לרופא", row: "row-doctor", badge: "badge-doctor", tint: "tint-doctor" },
  other: { label: "הוצאה אחרת", row: "row-expense", badge: "badge-expense", tint: "tint-expense" },
};

export function ExpenseLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
      <span>מקרא:</span>
      {Object.entries(EXPENSE_STYLES).map(([k, s]) => (
        <span key={k} className={s.badge}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

let lineSeq = 0;
function newLine(type = "travel", description = "") {
  lineSeq += 1;
  return { key: `l${lineSeq}`, type, description, amount: "" };
}

const QUICK_ADD = [
  { type: "travel", description: "מונית הלוך", text: "+ מונית הלוך" },
  { type: "travel", description: "מונית חזור", text: "+ מונית חזור" },
  { type: "doctor", description: "תשלום לרופא", text: "+ תשלום לרופא" },
  { type: "other", description: "", text: "+ שורה אחרת" },
];

// Local (Israel) date, not UTC — after midnight toISOString() is still "yesterday".
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Rendered by the patient card only while the form is open (one of the big
// action buttons opens it); closes itself after a successful save.
export default function PatientExpenses({ patientId, tasks, onSaved, onClose }) {
  const ui = useUI();
  const [date, setDate] = useState(todayLocal);
  const [treatmentId, setTreatmentId] = useState("");
  const [lines, setLines] = useState(() => [
    newLine("travel", "מונית הלוך"),
    newLine("travel", "מונית חזור"),
  ]);
  const [billPatient, setBillPatient] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Treatments/meetings she can attach the expenses to (not other expense
  // rows), newest first.
  const treatments = useMemo(
    () =>
      tasks
        .filter((t) => !isExpenseRow(t))
        .slice()
        .sort((a, b) =>
          String(b.date_gregorian || "").localeCompare(String(a.date_gregorian || "")),
        ),
    [tasks],
  );

  const linesTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  function chooseTreatment(id) {
    setTreatmentId(id);
    const t = treatments.find((x) => x.id === id);
    if (t?.date_gregorian) setDate(t.date_gregorian);
  }

  function updateLine(key, field, value) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  }

  function removeLine(key) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function save(e) {
    e.preventDefault();
    // A line left without an amount (e.g. no taxi back) is simply skipped.
    const filled = lines.filter((l) => String(l.amount).trim() !== "");
    if (filled.length === 0) {
      setError("לא הוזן אף סכום.");
      return;
    }
    for (const l of filled) {
      if (!(Number(l.amount) > 0)) {
        setError(`יש להזין סכום גדול מ-0 בשורה "${l.description.trim() || EXPENSE_TYPES[l.type].label}".`);
        return;
      }
    }

    const treatment = treatments.find((t) => t.id === treatmentId);
    const suffix = treatment
      ? " — " +
        ["טיפול", formatDate(treatment.date_gregorian)].filter(Boolean).join(" ") +
        (treatment.task_definition ? ` (${treatment.task_definition.slice(0, 40)})` : "")
      : "";

    const rows = filled.map((l) => {
      const amount = Math.round(Number(l.amount) * 100) / 100;
      const kind = EXPENSE_TYPES[l.type] || EXPENSE_TYPES.other;
      const description = l.description.trim() || kind.label;
      const isTravel = l.type === "travel";
      return {
        patient_id: patientId,
        date_gregorian: date || null,
        task_definition: description + suffix,
        meeting_type: kind.meetingType,
        travel: isTravel ? description : null,
        travel_payment: isTravel ? amount : 0,
        hours: 0,
        total_before_discount: amount,
        total_after_discount: amount,
        status: "בוצע",
        payment_status: billPatient ? "לא שולם" : "לא לחיוב",
      };
    });

    setSaving(true);
    setError("");
    // .select() confirms the rows were really written (not silently blocked).
    const { data, error: insErr } = await supabase.from("tasks").insert(rows).select("id");
    setSaving(false);
    if (insErr || !data || data.length !== rows.length) {
      setError(
        "שמירת ההוצאות נכשלה" +
          (insErr?.message ? `: ${insErr.message}` : " — נסי לרענן את הדף ולנסות שוב."),
      );
      if (data?.length) onSaved?.();
      return;
    }
    const total = rows.reduce((sum, r) => sum + r.total_after_discount, 0);
    ui.toast(`נשמר: ${formatCurrency(total)}`);
    onSaved?.();
    onClose?.();
  }

  return (
    <section className="card p-5 border-accent-200">
      <h2 className="text-xl font-bold text-ink-900">נסיעה / הוצאה</h2>
        <form onSubmit={save} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label" htmlFor="expense-date">
                תאריך
              </label>
              <input
                id="expense-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-3 min-w-0">
              <label className="label" htmlFor="expense-treatment">
                באיזה טיפול? (לא חובה)
              </label>
              <select
                id="expense-treatment"
                className="input"
                value={treatmentId}
                onChange={(e) => chooseTreatment(e.target.value)}
              >
                <option value="">ללא שיוך לטיפול</option>
                {treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatDate(t.date_gregorian) || "ללא תאריך"} ·{" "}
                    {(t.task_definition || "משימה").slice(0, 50)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {lines.map((l) => (
              <div
                key={l.key}
                className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-end border border-line rounded-md p-3 md:border-0 md:p-0"
              >
                <div className="md:col-span-3">
                  <label className="label">סוג</label>
                  <select
                    className="input"
                    value={l.type}
                    onChange={(e) => updateLine(l.key, "type", e.target.value)}
                  >
                    {Object.entries(EXPENSE_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-5">
                  <label className="label">פירוט</label>
                  <input
                    className="input"
                    placeholder={l.type === "travel" ? "למשל: מונית הלוך" : "למשל: ד״ר כהן"}
                    value={l.description}
                    onChange={(e) => updateLine(l.key, "description", e.target.value)}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="label">סכום (₪)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    className="input"
                    value={l.amount}
                    onChange={(e) => updateLine(l.key, "amount", e.target.value)}
                  />
                </div>
                <div className="md:col-span-1 flex justify-end md:pb-1">
                  <IconButton
                    variant="delete"
                    title="הסרת השורה"
                    onClick={() => removeLine(l.key)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_ADD.map((q) => (
              <button
                key={q.text}
                type="button"
                className="btn-ghost min-h-[44px]"
                onClick={() => setLines((ls) => [...ls, newLine(q.type, q.description)])}
              >
                {q.text}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-900 cursor-pointer w-fit">
            <input
              type="checkbox"
              className="w-4 h-4 accent-accent-600"
              checked={billPatient}
              onChange={(e) => setBillPatient(e.target.checked)}
            />
            המטופל צריך להחזיר לי את זה
          </label>

          <div className="text-sm">
            סה״כ:{" "}
            <span className="font-bold text-accent-700">{formatCurrency(linesTotal)}</span>
          </div>

          {error && <p className="text-red-700 text-sm">{error}</p>}
          <div className="flex gap-3 flex-wrap">
            <button type="submit" className="btn-primary min-h-[44px] px-8" disabled={saving}>
              {saving ? "שומר..." : "שמירה"}
            </button>
            <button type="button" className="btn-ghost min-h-[44px]" onClick={onClose} disabled={saving}>
              ביטול
            </button>
          </div>
        </form>
    </section>
  );
}
