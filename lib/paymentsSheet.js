import {
  formatCurrency,
  formatDate,
  formatDecimalHoursAsHHMM,
} from "@/lib/format";
import { remainingAmount } from "@/components/PatientTasksList";

// The printable, client-ready payments sheet for one patient (opened in a
// new window and printed / saved as PDF from the patient card).
export function buildPaymentsSheetHtml({
  patient,
  exportTasks,
  exportStatus,
  exportFrom,
  exportTo,
  exportTotals,
}) {
  const today = formatDate(new Date());

  const filterParts = [];
  if (exportStatus === "paid") filterParts.push("רק ששולם");
  if (exportStatus === "unpaid") filterParts.push("רק שלא שולם");
  if (exportFrom) filterParts.push(`מתאריך ${formatDate(exportFrom)}`);
  if (exportTo) filterParts.push(`עד תאריך ${formatDate(exportTo)}`);
  const filterLabel = filterParts.length ? ` · מסונן: ${filterParts.join(", ")}` : "";

  const escape = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Same four payment states shown in the app (PaymentBadge), so the
  // printed sheet reads consistently with the on-screen table.
  const STATUS_STYLE = {
    "שולם": { bg: "#ECFDF5", text: "#047857", border: "#A7F3D0" },
    "שולם חלקית": { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
    "לא שולם": { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" },
    "לא לחיוב": { bg: "#F1F5F9", text: "#475569", border: "#E2E8F0" },
  };

  const bodyHtml = exportTasks
    .map((t, i) => {
      const status = t.payment_status || "לא שולם";
      const st = STATUS_STYLE[status] || STATUS_STYLE["לא שולם"];
      const label = t.task_definition ? escape(t.task_definition.slice(0, 90)) : "—";
      const type = t.meeting_type ? escape(t.meeting_type) : "—";
      const remaining = remainingAmount(t);
      return `<tr class="${i % 2 === 1 ? "alt" : ""}">
        <td class="nowrap">${escape(formatDate(t.date_gregorian) || "—")}</td>
        <td>${label}</td>
        <td class="nowrap">${type}</td>
        <td class="nowrap num">${escape(formatDecimalHoursAsHHMM(t.hours))}</td>
        <td class="nowrap num amount">${escape(formatCurrency(t.total_after_discount))}</td>
        <td class="nowrap num">${remaining > 0.009 ? escape(formatCurrency(remaining)) : "—"}</td>
        <td class="nowrap">
          <span class="pill" style="background:${st.bg};color:${st.text};border-color:${st.border}">${escape(status)}</span>
        </td>
      </tr>`;
    })
    .join("");

  const totalAmount = exportTotals.paid + exportTotals.unpaid;
  const patientMetaParts = [];
  if (patient.phone) patientMetaParts.push(patient.phone);
  if (patient.treatment_type) patientMetaParts.push(patient.treatment_type);
  const patientMeta = patientMetaParts.map(escape).join(" · ");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <title>דף תשלומים — ${escape(patient.full_name)}</title>
  <style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    font-family: "Heebo", "Arial Hebrew", Arial, sans-serif;
    direction: rtl;
    color: #0F172A;
    background: #ffffff;
  }
  body { font-size: 10.5pt; margin: 0; padding: 28px; }

  /* Brand strip */
  .brandbar {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 14px; margin-bottom: 18px;
    border-bottom: 2px solid #0F172A;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-mark {
    width: 26px; height: 26px; border-radius: 7px;
    background: #EA580C; color: #fff; font-weight: 700; font-size: 12pt;
    display: flex; align-items: center; justify-content: center;
  }
  .brand-name { font-weight: 700; font-size: 11.5pt; letter-spacing: 0.2px; }
  .brand-doc { color: #64748B; font-size: 9.5pt; }
  .gen-date { color: #64748B; font-size: 9pt; text-align: left; }

  /* Patient header */
  .patient-block { margin-bottom: 20px; }
  .patient-name { font-size: 19pt; font-weight: 700; margin: 0 0 4px; }
  .patient-meta { color: #64748B; font-size: 10pt; }
  .filter-note {
    display: inline-block; margin-top: 8px;
    background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 999px;
    padding: 4px 12px; font-size: 8.8pt; color: #475569;
  }

  /* Summary cards */
  .summary {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 12px; margin: 20px 0 24px;
  }
  .stat {
    border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;
    background: #F8FAFC;
  }
  .stat .label {
    font-size: 8.5pt; color: #64748B; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;
  }
  .stat .value { font-size: 15pt; font-weight: 700; }
  .stat.paid { background: #ECFDF5; border-color: #A7F3D0; }
  .stat.paid .value { color: #047857; }
  .stat.unpaid { background: #FEF2F2; border-color: #FECACA; }
  .stat.unpaid .value { color: #B91C1C; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { padding: 9px 10px; text-align: right; vertical-align: middle; }
  th {
    background: #0F172A; color: #ffffff; font-weight: 600;
    font-size: 8.8pt; letter-spacing: 0.02em;
  }
  th:first-child { border-top-right-radius: 8px; }
  th:last-child { border-top-left-radius: 8px; }
  td { border-bottom: 1px solid #EEF2F6; }
  tbody tr.alt td { background: #FAFBFC; }
  .num { font-variant-numeric: tabular-nums; }
  .amount { font-weight: 700; }
  .nowrap { white-space: nowrap; }
  .pill {
    display: inline-block; padding: 3px 11px; border-radius: 999px;
    font-size: 8.5pt; font-weight: 600; border: 1px solid transparent;
    white-space: nowrap;
  }

  tfoot td {
    border-top: 2px solid #0F172A; border-bottom: none;
    padding-top: 12px; font-weight: 700; font-size: 10.5pt;
  }
  tfoot .label { color: #64748B; font-weight: 600; font-size: 9pt; }

  .footer {
    margin-top: 28px; padding-top: 14px; border-top: 1px solid #E2E8F0;
    font-size: 8.3pt; color: #94A3B8; text-align: center; line-height: 1.6;
  }

  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
  .no-print {
    position: fixed; top: 14px; left: 14px; display: flex; gap: 8px; z-index: 10;
  }
  .no-print button {
    background: #EA580C; color: #fff; border: none; border-radius: 8px;
    padding: 9px 16px; cursor: pointer; font-family: inherit;
    font-size: 10.5pt; font-weight: 600; box-shadow: 0 2px 8px rgba(234,88,12,0.25);
  }
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">🖨 הדפסה / שמירה כ-PDF</button></div>

  <div class="brandbar">
  <div class="brand">
    <div class="brand-mark">ב</div>
    <div>
      <div class="brand-name">בט״ל</div>
      <div class="brand-doc">דף תשלומים</div>
    </div>
  </div>
  <div class="gen-date">הופק בתאריך ${today}</div>
  </div>

  <div class="patient-block">
  <h1 class="patient-name">${escape(patient.full_name)}</h1>
  ${patientMeta ? `<div class="patient-meta">${patientMeta}</div>` : ""}
  <div>
    <span class="filter-note">${exportTasks.length} פגישות${filterLabel}</span>
  </div>
  </div>

  <div class="summary">
  <div class="stat">
    <div class="label">סך שעות</div>
    <div class="value">${escape(formatDecimalHoursAsHHMM(exportTotals.hours))}</div>
  </div>
  <div class="stat paid">
    <div class="label">שולם</div>
    <div class="value">${escape(formatCurrency(exportTotals.paid))}</div>
  </div>
  <div class="stat unpaid">
    <div class="label">פתוח לתשלום</div>
    <div class="value">${escape(formatCurrency(exportTotals.unpaid))}</div>
  </div>
  </div>

  <table>
  <thead>
    <tr>
      <th>תאריך</th>
      <th>משימה</th>
      <th>סוג פגישה</th>
      <th>שעות</th>
      <th>סכום</th>
      <th>יתרה לתשלום</th>
      <th>סטטוס תשלום</th>
    </tr>
  </thead>
  <tbody>${bodyHtml}</tbody>
  <tfoot>
    <tr>
      <td colspan="3" class="label">סה״כ</td>
      <td class="num">${escape(formatDecimalHoursAsHHMM(exportTotals.hours))}</td>
      <td class="num amount">${escape(formatCurrency(totalAmount))}</td>
      <td class="num amount">${escape(formatCurrency(exportTotals.unpaid))}</td>
      <td></td>
    </tr>
  </tfoot>
  </table>

  <div class="footer">
  מסמך זה הופק אוטומטית ממערכת בט״ל לניהול משימות ואינו מהווה חשבונית מס.<br />
  בט״ל — מערכת ניהול משימות
  </div>

  <script>setTimeout(() => window.print(), 300);</script>
</body>
</html>`;

  return html;
}
