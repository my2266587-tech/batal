"use client";

import { useEffect, useRef } from "react";
import { DeleteIcon, IconButton } from "@/components/Icons";
import { EXPENSE_STYLES, ExpenseLegend, expenseKind } from "@/components/PatientExpenses";
import { formatCurrency, formatDate, formatDecimalHoursAsHHMM } from "@/lib/format";

// How much is still owed on a task after any partial payments already
// recorded against it (paid_amount). Never negative.
export function remainingAmount(t) {
  const total = Number(t?.total_after_discount) || 0;
  const paid = Number(t?.paid_amount) || 0;
  const r = total - paid;
  return r > 0.009 ? r : 0;
}

export function PaymentBadge({ status }) {
  const map = {
    "שולם": "badge-success",
    "שולם חלקית": "badge-warning",
    "לא שולם": "badge-danger",
    "לא לחיוב": "badge-neutral",
  };
  return <span className={map[status] || "badge-neutral"}>{status || "—"}</span>;
}

const PAID_VALUES = ["שולם", "לא לחיוב"];

function TypeCell({ t }) {
  const kind = expenseKind(t);
  if (kind) {
    const s = EXPENSE_STYLES[kind];
    return <span className={s.badge}>{s.label}</span>;
  }
  return t.meeting_type ? <span>{t.meeting_type}</span> : null;
}

function AmountCell({ t, amount }) {
  return (
    <>
      {formatCurrency(amount)}
      {t.payment_status === "שולם חלקית" && (
        <div className="text-[11px] text-ink-500 font-normal whitespace-nowrap">
          מתוך {formatCurrency(t.total_after_discount)} · שולם {formatCurrency(t.paid_amount)}
        </div>
      )}
    </>
  );
}

// The patient's charges (meetings, one-off charges, travel and expenses).
// A table on wide screens, a list of cards on a phone. Expense rows are
// coloured by type (see components/PatientExpenses.js).
export default function PatientTasksList({ items, emptyText, onTogglePaid, onDelete, getAmount }) {
  const amountFor = getAmount || ((t) => Number(t.total_after_discount) || 0);
  const hasExpenses = items.some((t) => expenseKind(t));

  if (items.length === 0) {
    return <p className="p-6 text-center text-ink-500">{emptyText}</p>;
  }

  return (
    <div>
      {hasExpenses && (
        <div className="px-5 py-3 border-b border-line">
          <ExpenseLegend />
        </div>
      )}

      {/* Phone: cards */}
      <ul className="md:hidden divide-y divide-line">
        {items.map((t) => {
          const kind = expenseKind(t);
          const checked = PAID_VALUES.includes(t.payment_status);
          return (
            <li key={t.id} className={"p-4 flex gap-3 items-start " + (kind ? EXPENSE_STYLES[kind].tint : "")}>
              <label className="flex items-center justify-center min-w-[44px] min-h-[44px] -m-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onTogglePaid(t)}
                  aria-label={checked ? "סימון כלא שולם" : "סימון כשולם"}
                  className="w-5 h-5 accent-accent-600"
                />
              </label>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap text-sm text-ink-500">
                  <span>{formatDate(t.date_gregorian) || "ללא תאריך"}</span>
                  <TypeCell t={t} />
                  {Number(t.hours) > 0 && <span>{formatDecimalHoursAsHHMM(t.hours)} שעות</span>}
                </div>
                <div className="text-base text-ink-900 line-clamp-3 whitespace-pre-wrap">
                  {t.task_definition || "—"}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lg tabular-nums">
                    <AmountCell t={t} amount={amountFor(t)} />
                  </span>
                  <PaymentBadge status={t.payment_status} />
                </div>
              </div>
              <IconButton variant="delete" title="מחיקת השורה" onClick={() => onDelete(t)}>
                <DeleteIcon />
              </IconButton>
            </li>
          );
        })}
      </ul>

      {/* Wide screen: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16 text-center">שולם?</th>
              <th>תאריך</th>
              <th>מה</th>
              <th>סוג</th>
              <th>שעות</th>
              <th>סכום</th>
              <th>מצב</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const kind = expenseKind(t);
              const checked = PAID_VALUES.includes(t.payment_status);
              return (
                <tr key={t.id} className={kind ? EXPENSE_STYLES[kind].row : undefined}>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onTogglePaid(t)}
                      title={checked ? "סימון כלא שולם" : "סימון כשולם"}
                      className="w-5 h-5 accent-accent-600 cursor-pointer"
                    />
                  </td>
                  <td className="whitespace-nowrap">{formatDate(t.date_gregorian) || "—"}</td>
                  <td className="max-w-xs">
                    <div className="line-clamp-2 text-sm whitespace-pre-wrap">{t.task_definition || "—"}</div>
                  </td>
                  <td>
                    <TypeCell t={t} />
                  </td>
                  <td>{Number(t.hours) > 0 ? formatDecimalHoursAsHHMM(t.hours) : "—"}</td>
                  <td className="font-semibold">
                    <AmountCell t={t} amount={amountFor(t)} />
                  </td>
                  <td>
                    <PaymentBadge status={t.payment_status} />
                  </td>
                  <td>
                    <div className="flex justify-end">
                      <IconButton variant="delete" title="מחיקת השורה" onClick={() => onDelete(t)}>
                        <DeleteIcon />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// In-app confirmation before deleting a charge row. Focus starts on
// "ביטול" and Esc closes, so a stray Enter never deletes anything.
export function DeleteTaskDialog({ task, deleting, error, onCancel, onConfirm }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting, onCancel]);

  const paid = Number(task.paid_amount) || 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !deleting && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-title"
        className="card w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-task-title" className="text-lg font-bold text-ink-900">
          למחוק את השורה?
        </h2>
        <div className="text-base text-ink-900 space-y-1">
          <div>{task.task_definition || "משימה"}</div>
          <div className="text-ink-500">
            {formatDate(task.date_gregorian) || "ללא תאריך"} · {formatCurrency(task.total_after_discount)}
          </div>
        </div>
        {paid > 0.009 && (
          <p className="text-sm text-amber-700">
            כבר שולמו על השורה הזו {formatCurrency(paid)}. הסכום יישאר רק ברשימת התשלומים שהתקבלו.
          </p>
        )}
        {error && <p className="text-red-700 text-sm">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            type="button"
            className="btn-ghost min-h-[44px]"
            onClick={onCancel}
            disabled={deleting}
          >
            ביטול
          </button>
          <button
            type="button"
            className="btn-primary min-h-[44px] bg-red-600 hover:bg-red-700"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "מוחק..." : "מחיקה"}
          </button>
        </div>
      </div>
    </div>
  );
}
