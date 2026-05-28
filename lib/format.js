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

/* ===== Duration / meeting length helpers =====
 *
 * The user can type duration in two flavours, and there is one legacy exception:
 *
 *   "0.5"   → 5 minutes        (new: fractional part = minutes)
 *   "0.10"  → 10 minutes       (new)
 *   "0.15"  → 15 minutes       (new)
 *   "0.30"  → 30 minutes       (new)
 *   "0.50"  → 30 minutes       (LEGACY: half hour, preserved)
 *   "1"     → 60 minutes
 *   "1.5"   → 90 minutes       (LEGACY decimal hours when Y >= 1 with single
 *                                digit fractional)
 *   "1.30"  → 90 minutes       (new: H.MM format)
 *   "2"     → 120 minutes
 *
 * The DB only has a numeric(6,2) `hours` column. We continue to store decimal
 * hours there. Round-trip works because minutes/60 fits in 2 decimal places
 * for all the minute values we care about, and Math.round(decimal*60) recovers
 * the minutes exactly.
 *
 * IMPORTANT: Always parse from the original typed STRING. Do not use parseFloat
 * for the initial parse — "0.5" and "0.50" must be distinguishable.
 */

/**
 * Parse a duration string into total minutes.
 * Returns null for invalid / empty input.
 */
export function parseDurationInputToMinutes(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  // Lenient normalization for ".5" and "1."
  if (s.startsWith(".")) s = "0" + s;
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  // LEGACY exception: "0.50" continues to mean 30 minutes
  if (s === "0.50") return 30;

  // Pure integer → hours
  if (!s.includes(".")) {
    const h = parseInt(s, 10);
    if (!Number.isFinite(h)) return null;
    return h * 60;
  }

  const [intStr, fracStr] = s.split(".");
  const intNum = parseInt(intStr || "0", 10);
  const fracNum = parseInt(fracStr, 10);
  if (!Number.isFinite(intNum) || !Number.isFinite(fracNum)) return null;

  // 0.X cases: fractional part read as minutes
  if (intNum === 0) {
    return fracNum;
  }

  // Y.X (single-digit fractional, Y >= 1): legacy decimal hours
  if (fracStr.length === 1) {
    return Math.round((intNum + fracNum / 10) * 60);
  }

  // Y.XX (two+ digit fractional, Y >= 1): H.MM format
  return intNum * 60 + fracNum;
}

/**
 * Convert minutes to the canonical input string we want to show in the form.
 * 30 min → "0.30", 5 min → "0.5", 90 min → "1.30", 60 min → "1".
 */
export function minutesToInputString(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `0.${mm}`;
  if (mm === 0) return String(h);
  return `${h}.${String(mm).padStart(2, "0")}`;
}

/**
 * Convert the DB-stored decimal hours value to the canonical input string.
 * Existing 0.50 (legacy half hour) becomes "0.30" which by the new rules
 * parses back to 30 minutes — same value, no DB change needed.
 */
export function decimalHoursToInputString(decimalHours) {
  const h = Number(decimalHours);
  if (!Number.isFinite(h) || h <= 0) return "";
  return minutesToInputString(Math.round(h * 60));
}

/**
 * Human-readable Hebrew text for a duration in minutes.
 * 30  → "30 דקות"
 * 60  → "שעה"
 * 90  → "שעה ו-30 דקות"
 * 120 → "שעתיים"
 */
export function formatMinutesHebrew(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm} דקות`;
  let hp;
  if (h === 1) hp = "שעה";
  else if (h === 2) hp = "שעתיים";
  else hp = `${h} שעות`;
  if (mm === 0) return hp;
  return `${hp} ו-${mm} דקות`;
}

/**
 * Compact h:mm display for tables.
 * 30 min → "0:30", 90 min → "1:30", 60 min → "1:00".
 */
export function formatDecimalHoursAsHHMM(decimalHours) {
  const h = Number(decimalHours);
  if (!Number.isFinite(h) || h <= 0) return "—";
  const minutes = Math.round(h * 60);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}
