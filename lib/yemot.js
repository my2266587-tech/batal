// Helpers for the Yemot Hamashiach ("ימות המשיח") telephone API protocol.
//
// Yemot's "API" extension calls our URL on every interaction. We answer with a
// plain-text command string that tells Yemot what to play and what to read.
//
// Protocol notes (official Yemot API, comma format):
//   - id_list_message=<messages>            → play message(s), then continue
//   - read=<messages>,<var>,tap,<max>,<min>,<sec>   → read DTMF digits into <var>
//   - read=<messages>,<var>,record          → record audio into <var>
//   - go_to_folder=hangup                   → end the call
//   <messages> is a list separated by "." where each item is "t-<text>" (TTS)
//   or "f-<file>" (play a stored file).
//
// IMPORTANT: commas and periods are protocol separators, so prompt TEXT must
// not contain them. All prompts below are phrased without "," or ".".

// Build a single text message item.
export function t(text) {
  return "t-" + sanitizeText(text);
}

// Build a "play stored file" item (e.g. a recording the caller just made).
export function f(file) {
  return "f-" + String(file || "").trim();
}

// Strip characters that would corrupt the protocol from free TTS text.
export function sanitizeText(text) {
  return String(text == null ? "" : text)
    .replace(/[,]/g, " ")
    .replace(/[.]/g, " ")
    .replace(/[&=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Join message items (already built with t()/f()) into a Yemot message list.
function msgList(items) {
  const arr = Array.isArray(items) ? items : [items];
  return arr.filter(Boolean).join(".");
}

// Play message(s) and then read DTMF digits into `varName`.
export function readTap(messages, varName, { max = 20, min = 1, sec = 7 } = {}) {
  return `read=${msgList(messages)},${varName},tap,${max},${min},${sec}`;
}

// Play message(s) and then record audio into `varName` (caller ends with #).
export function readRecord(messages, varName) {
  return `read=${msgList(messages)},${varName},record`;
}

// Play message(s) and hang up.
export function sayAndHangup(messages) {
  return `id_list_message=${msgList(messages)}&go_to_folder=hangup`;
}

// Parse an incoming Yemot request (GET query or POST form body) into a flat
// object of string params. Handles both encodings Yemot can be configured with.
export async function parseYemotParams(request) {
  const params = {};
  try {
    const url = new URL(request.url);
    for (const [k, v] of url.searchParams.entries()) params[k] = v;
  } catch {
    // ignore malformed URL
  }
  if (request.method === "POST") {
    try {
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await request.json();
        if (body && typeof body === "object") {
          for (const [k, v] of Object.entries(body)) params[k] = String(v);
        }
      } else {
        const text = await request.text();
        const sp = new URLSearchParams(text);
        for (const [k, v] of sp.entries()) params[k] = v;
      }
    } catch {
      // ignore body parse errors — fall back to query params
    }
  }
  return params;
}

// ---- value helpers ---------------------------------------------------------

export const PRIORITY_TEXT = { "1": "רגילה", "2": "גבוהה", "3": "דחופה" };

export function priorityText(choice) {
  return PRIORITY_TEXT[String(choice)] || "רגילה";
}

// Compute an ISO date (YYYY-MM-DD) for "today" / "tomorrow" in Israel time.
function israelToday(offsetDays = 0) {
  const now = new Date();
  // Convert "now" to Israel local date parts via Intl, then rebuild.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

// Parse 8 digits DDMMYYYY into "YYYY-MM-DD", or null if invalid.
export function parseManualDate(digits) {
  const s = String(digits || "").replace(/\D/g, "");
  if (s.length !== 8) return null;
  const dd = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const yyyy = Number(s.slice(4, 8));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000 || yyyy > 2100)
    return null;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    dt.getUTCFullYear() !== yyyy ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  )
    return null;
  return dt.toISOString().slice(0, 10);
}

// Resolve a date choice (1=today 2=tomorrow 3=manual 4=none) to an ISO date.
export function resolveDueDate(choice, manualDigits) {
  switch (String(choice)) {
    case "1":
      return israelToday(0);
    case "2":
      return israelToday(1);
    case "3":
      return parseManualDate(manualDigits);
    default:
      return null;
  }
}

// Parse 4 digits HHMM into "HH:MM", or null if invalid.
export function parseManualTime(digits) {
  const s = String(digits || "").replace(/\D/g, "");
  if (s.length !== 4) return null;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Parse a spoken/typed Hebrew duration into decimal hours, or null if none
// is recognised. Handles digits ("2 שעות", "1.5 שעה", "90 דקות") and common
// word forms ("שעה", "שעתיים", "שעה וחצי", "חצי שעה", "רבע שעה",
// "שלוש שעות וחצי", "שלושת רבעי שעה").
export function parseHebrewDuration(text) {
  if (!text) return null;
  const s =
    " " +
    String(text)
      .replace(/["'׳״]/g, "")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " ";

  // Minutes in digits → hours.
  const minM = s.match(/(\d+(?:\.\d+)?)\s*דק/);
  if (minM) {
    const m = parseFloat(minM[1]);
    if (Number.isFinite(m) && m > 0) return Math.round((m / 60) * 100) / 100;
  }

  let hours = null;

  // Hours in digits ("2 שעות", "1.5 שעה").
  const hrM = s.match(/(\d+(?:\.\d+)?)\s*שע/);
  if (hrM) {
    const h = parseFloat(hrM[1]);
    if (Number.isFinite(h)) hours = h;
  }

  // Word-based base value.
  if (hours === null) {
    if (/שעתיים/.test(s)) {
      hours = 2;
    } else {
      const NUM = {
        אחת: 1, אחד: 1, שתי: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4,
        ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7,
        שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
      };
      for (const [w, n] of Object.entries(NUM)) {
        if (new RegExp(w + "\\s+שעות").test(s)) { hours = n; break; }
      }
      if (hours === null) {
        if (/חצי שעה/.test(s)) hours = 0.5;
        else if (/שלושת רבעי שעה|שלושה רבעי שעה/.test(s)) hours = 0.75;
        else if (/רבע שעה/.test(s)) hours = 0.25;
        else if (/שעה/.test(s)) hours = 1;
      }
    }
  }

  if (hours === null) return null;

  // Fractional additions ("שעה וחצי", "שעתיים ורבע", "שלוש שעות ושלושת רבעי").
  if (/ושלושת רבעי|ושלושה רבעי/.test(s)) hours += 0.75;
  else if (/וחצי/.test(s)) hours += 0.5;
  else if (/ורבע/.test(s)) hours += 0.25;

  return Math.round(hours * 100) / 100;
}

// Human (TTS) text describing the chosen date, for the confirmation summary.
export function dueDateText(choice, manualDigits) {
  switch (String(choice)) {
    case "1":
      return "היום";
    case "2":
      return "מחר";
    case "3": {
      const iso = parseManualDate(manualDigits);
      if (!iso) return "תאריך שהוקש";
      const [y, m, d] = iso.split("-");
      return `${Number(d)} ${Number(m)} ${y}`;
    }
    default:
      return "ללא תאריך";
  }
}
