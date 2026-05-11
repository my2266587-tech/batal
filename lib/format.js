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

export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
