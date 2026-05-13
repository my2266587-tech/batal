// Israeli currency / number formatting helpers.
// Uses Intl.NumberFormat with he-IL locale for thousands separators.

export function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₪0";
  const hasCents = Math.abs(n - Math.round(n)) > 0.005;
  const formatted = new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
  return `₪${formatted}`;
}

/**
 * Format any date-ish value as DD/MM/YYYY with slashes.
 * Accepts:
 *   - "YYYY-MM-DD" (Postgres date column)
 *   - "YYYY-MM-DDTHH:MM:SS..." (timestamp)
 *   - Date object
 * Always returns a 2-digit day, 2-digit month, 4-digit year — or "" if invalid.
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === "") return "";
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const s = String(value);
    // For plain "YYYY-MM-DD" Postgres date strings, construct in local time
    // to avoid UTC offset shifting the day.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      d = new Date(s);
    }
  }
  if (!d || isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
