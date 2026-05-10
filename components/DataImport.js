"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";

/* ---------- Helpers ---------- */

function normalize(s) {
  return String(s ?? "")
    .replace(/[״"׳']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeName(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const cleaned = String(v).replace(/[,₪\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read worksheet cells directly so we can inspect each cell's number format.
 * Excel stores times as fractions of a day (02:30 = 0.10417). When the cell's
 * number format is a time format (contains "h"), we multiply by 24 to get hours.
 */
function readSheet(sheet) {
  if (!sheet || !sheet["!ref"]) return { headers: [], rows: [] };
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell ? String(cell.v ?? "").trim() : "");
  }

  const rows = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row = {};
    let hasAny = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c];
      if (!header) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) {
        row[header] = "";
        continue;
      }
      hasAny = true;
      const fmt = String(cell.z || "");
      const isTimeFmt = /(\[h\]|h)/i.test(fmt) && !/y/i.test(fmt);

      if (cell.t === "n" && isTimeFmt) {
        // Excel time fraction → decimal hours
        row[header] = Number(cell.v) * 24;
      } else if (cell.v instanceof Date) {
        row[header] = cell.v;
      } else if (cell.t === "n") {
        row[header] = cell.v;
      } else {
        row[header] = cell.w !== undefined ? cell.w : cell.v ?? "";
      }
    }
    if (hasAny) rows.push(row);
  }
  return { headers, rows };
}

function parseHours(v) {
  if (v === null || v === undefined || v === "") return null;

  // Excel time fraction (xlsx with cellDates returns a Date near 1899-12-30)
  if (v instanceof Date && !isNaN(v.getTime())) {
    const year = v.getUTCFullYear();
    if (year < 1910) {
      const epochMs = Date.UTC(1899, 11, 30);
      const hours = (v.getTime() - epochMs) / (1000 * 60 * 60);
      return Number.isFinite(hours) ? hours : null;
    }
    return null;
  }

  let s = String(v).trim();
  if (s === "") return null;
  s = s.replace(/\s*(am|pm|בבוקר|בערב|בצהריים)\s*$/i, "").trim();

  // HH:MM or HH:MM:SS or HHH:MM (e.g. "02:30", "120:00", "5:00")
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const h = Number(colon[1]);
    const mm = Number(colon[2]);
    const ss = colon[3] ? Number(colon[3]) : 0;
    if (Number.isFinite(h) && mm < 60 && ss < 60) {
      return h + mm / 60 + ss / 3600;
    }
    return null;
  }

  // Decimal number with optional thousands/whitespace
  const cleaned = s.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateString(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/))) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/))) {
    const [, yy, mm, dd] = m;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

/* ---------- Synonym maps ---------- */

const SYNONYMS = {
  patient_name: [
    "שם מטופל",
    "שם המטופל",
    "מטופל",
    "שם מלא",
    "שם",
    "name",
    "patient",
    "patient name",
  ],
  patient_phone: ["טלפון מטופל", "טלפון", "נייד", "מס טלפון", "phone", "mobile"],
  patient_email: ["אימייל", "מייל", "דוא״ל", "דואר אלקטרוני", "email"],
  patient_status: ["סטטוס", "מצב", "status"],
  treatment_type: ["סוג טיפול", "טיפול", "treatment"],
  hourly_rate: ["מחיר לשעה", "תעריף לשעה", "תעריף", "מחיר", "rate", "hourly rate"],
  hourly_rate_discounted: [
    "מחיר לשעה אחרי הנחה",
    "תעריף אחרי הנחה",
    "מחיר אחרי הנחה",
    "מחיר מוזל",
    "discounted rate",
  ],
  patient_notes: ["הערות מטופל"],
  date_gregorian: ["תאריך לועזי", "תאריך", "date"],
  date_hebrew: ["תאריך עברי"],
  hours: ["משך שעות", "שעות", "משך", "hours"],
  task_definition: ["הגדרת משימה", "משימה", "task"],
  meeting_type: ["סוג פגישה", "פגישה", "meeting type"],
  detail_type: ["סוג פירוט"],
  detail_text: ["פירוט"],
  travel: ["נסיעות", "נסיעה"],
  travel_payment: ["תשלום נסיעה", "תשלום נסיעות"],
  attendance: ["נוכחות"],
  total_before_discount: ['סה"כ לתשלום לפני הנחה', "סהכ לפני הנחה", "לפני הנחה"],
  total_after_discount: ['סה"כ לתשלום אחרי הנחה', "סהכ אחרי הנחה", "אחרי הנחה"],
  notes: ["הערות", "notes"],
  // cash-specific
  amount: ["סכום", "amount"],
  purpose: ["עבור", "מטרה", "purpose"],
};

const DETAIL_TYPE_TO_FIELD = {
  פגישה: "meeting_details",
  שיחה: "call_details",
  מייל: "email_details",
  אחר: "other_details",
};

const DETAIL_TYPES = Object.keys(DETAIL_TYPE_TO_FIELD);

/* ---------- Column auto-mapping ---------- */

function buildColumnMap(headers) {
  const headerByNorm = new Map();
  headers.forEach((h) => headerByNorm.set(normalize(h), h));
  const map = {};
  for (const [field, synonyms] of Object.entries(SYNONYMS)) {
    for (const syn of synonyms) {
      const found = headerByNorm.get(normalize(syn));
      if (found) {
        map[field] = found;
        break;
      }
    }
  }
  return map;
}

function getCell(row, columnName) {
  if (!columnName) return undefined;
  return row[columnName];
}

/* ---------- Targets ---------- */

const TARGETS = [
  { value: "tasks", label: "משימות / פגישות" },
  { value: "patients", label: "מטופלים" },
  { value: "cash", label: "קופה" },
];

const TARGET_REQUIRED_FIELDS = {
  tasks: ["patient_name"],
  patients: ["patient_name"],
  cash: [],
};

const TARGET_FIELD_LABELS = {
  patient_name: "שם מטופל",
  patient_phone: "טלפון",
  patient_email: "אימייל",
  patient_status: "סטטוס",
  treatment_type: "סוג טיפול",
  hourly_rate: "מחיר לשעה",
  hourly_rate_discounted: "מחיר לשעה אחרי הנחה",
  patient_notes: "הערות מטופל",
  date_gregorian: "תאריך לועזי",
  date_hebrew: "תאריך עברי",
  hours: "משך שעות",
  task_definition: "הגדרת משימה",
  meeting_type: "סוג פגישה",
  detail_type: "סוג פירוט",
  detail_text: "פירוט",
  travel: "נסיעות",
  travel_payment: "תשלום נסיעה",
  attendance: "נוכחות",
  total_before_discount: 'סה"כ לפני הנחה',
  total_after_discount: 'סה"כ אחרי הנחה',
  notes: "הערות",
  amount: "סכום",
  purpose: "עבור",
};

/* ---------- Templates ---------- */

function downloadTemplate(target) {
  let headers, examples, sheetName, fileName;
  if (target === "tasks") {
    headers = [
      "שם המטופל",
      "טלפון מטופל",
      "סוג טיפול",
      "מחיר לשעה",
      "מחיר לשעה אחרי הנחה",
      "תאריך לועזי",
      "תאריך עברי",
      "משך שעות",
      "הגדרת משימה",
      "סוג פגישה",
      "סוג פירוט",
      "פירוט",
      "נסיעות",
      "תשלום נסיעה",
      "נוכחות",
      'סה"כ לתשלום לפני הנחה',
      'סה"כ לתשלום אחרי הנחה',
      "הערות",
    ];
    examples = [
      [
        "ישראל ישראלי",
        "0501234567",
        "טיפול רגשי",
        300,
        270,
        "10/05/2026",
        'כ"ז ניסן ה\'תשפ"ה',
        1.5,
        "פגישת המשך",
        "פרונטלית",
        "פגישה",
        "המטופל הציג שיפור משמעותי",
        "תל אביב — ירושלים",
        80,
        "נוכח",
        "",
        "",
        "להתקשר אליו בשבוע הבא",
      ],
    ];
    sheetName = "משימות";
    fileName = "תבנית_משימות.xlsx";
  } else if (target === "patients") {
    headers = [
      "שם מלא",
      "טלפון",
      "אימייל",
      "סטטוס",
      "סוג טיפול",
      "מחיר לשעה",
      "מחיר לשעה אחרי הנחה",
      "הערות",
    ];
    examples = [
      [
        "ישראל ישראלי",
        "0501234567",
        "israel@example.com",
        "פעיל",
        "טיפול רגשי",
        300,
        270,
        "מטופל קבוע",
      ],
      [
        "שרה כהן",
        "0521112233",
        "",
        "פעיל",
        "ייעוץ זוגי",
        350,
        "",
        "",
      ],
    ];
    sheetName = "מטופלים";
    fileName = "תבנית_מטופלים.xlsx";
  } else {
    headers = ["תאריך", "סכום", "עבור", "הערות"];
    examples = [
      ["10/05/2026", 250, "תשלום נסיעות", ""],
      ["12/05/2026", -120, "ציוד משרדי", "חנות הספרים"],
    ];
    sheetName = "קופה";
    fileName = "תבנית_קופה.xlsx";
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

/* ---------- Parsing per target ---------- */

async function parseTasks(rows, columnMap) {
  const errors = [];
  const valid = [];
  const skippedNoName = [];
  const newPatients = new Map();
  const patientUpdates = new Map();

  const { data: existing, error: pErr } = await supabase
    .from("patients")
    .select(
      "id, full_name, phone, treatment_type, hourly_rate, hourly_rate_discounted",
    );
  if (pErr) throw new Error(pErr.message);

  // Group existing patients by normalized name for ambiguity detection.
  const existingByName = new Map();
  (existing || []).forEach((p) => {
    const k = normalizeName(p.full_name);
    if (!existingByName.has(k)) existingByName.set(k, []);
    existingByName.get(k).push(p);
  });

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const name = String(getCell(r, columnMap.patient_name) ?? "").trim();
    const phone = String(getCell(r, columnMap.patient_phone) ?? "").trim();
    if (!name) {
      skippedNoName.push(line);
      return;
    }

    // Match candidates by name
    const nameKey = normalizeName(name);
    const candidates = existingByName.get(nameKey) || [];

    let matchedPatientId = null;
    let isNew = false;
    if (candidates.length === 1) {
      // Single name match — use it (regardless of phone)
      matchedPatientId = candidates[0].id;
    } else if (candidates.length > 1) {
      if (!phone) {
        errors.push({
          line,
          msg: `נמצאו ${candidates.length} מטופלים בשם "${name}" — נא להוסיף טלפון בקובץ`,
        });
        return;
      }
      const byPhone = candidates.filter(
        (c) => String(c.phone || "").trim() === phone,
      );
      if (byPhone.length === 1) {
        matchedPatientId = byPhone[0].id;
      } else if (byPhone.length === 0) {
        errors.push({
          line,
          msg: `מטופל "${name}" קיים אך לא עם הטלפון ${phone}`,
        });
        return;
      } else {
        errors.push({
          line,
          msg: `מטופלים מרובים עם שם וטלפון זהים`,
        });
        return;
      }
    } else {
      // 0 candidates — new patient
      isNew = true;
    }

    const detailType = String(getCell(r, columnMap.detail_type) ?? "").trim();
    const detailText = String(getCell(r, columnMap.detail_text) ?? "").trim();
    let detailField = null;
    if (detailType) {
      detailField = DETAIL_TYPE_TO_FIELD[detailType];
      if (!detailField) {
        errors.push({
          line,
          msg: `סוג פירוט לא חוקי: "${detailType}" — מותר: ${DETAIL_TYPES.join(", ")}`,
        });
        return;
      }
    }

    const dateGregRaw = getCell(r, columnMap.date_gregorian);
    const date_gregorian =
      dateGregRaw === "" || dateGregRaw === undefined
        ? null
        : toDateString(dateGregRaw);
    if (
      dateGregRaw !== "" &&
      dateGregRaw !== undefined &&
      date_gregorian === null
    ) {
      errors.push({ line, msg: `תאריך לועזי לא ניתן לפענוח: "${dateGregRaw}"` });
      return;
    }

    const hoursRaw = getCell(r, columnMap.hours);
    let hours = 0;
    if (hoursRaw !== "" && hoursRaw !== undefined && hoursRaw !== null) {
      const h = parseHours(hoursRaw);
      if (h === null) {
        errors.push({ line, msg: `משך שעות לא תקין: "${hoursRaw}"` });
        return;
      }
      hours = h;
    }

    const treatmentType = String(getCell(r, columnMap.treatment_type) ?? "").trim();
    const hourlyRate = toNumberOrNull(getCell(r, columnMap.hourly_rate));
    const hourlyRateDisc = toNumberOrNull(
      getCell(r, columnMap.hourly_rate_discounted),
    );
    const travelPay = toNumberOrNull(getCell(r, columnMap.travel_payment));
    const totalBefore = toNumberOrNull(
      getCell(r, columnMap.total_before_discount),
    );
    const totalAfter = toNumberOrNull(
      getCell(r, columnMap.total_after_discount),
    );
    const notesVal = String(getCell(r, columnMap.notes) ?? "").trim();

    const task = {
      date_gregorian,
      date_hebrew: String(getCell(r, columnMap.date_hebrew) ?? "").trim() || null,
      hours,
      task_definition:
        String(getCell(r, columnMap.task_definition) ?? "").trim() || null,
      meeting_type:
        String(getCell(r, columnMap.meeting_type) ?? "").trim() || null,
      meeting_details: null,
      call_details: null,
      email_details: null,
      other_details: null,
      travel: String(getCell(r, columnMap.travel) ?? "").trim() || null,
      travel_payment: travelPay ?? 0,
      attendance: String(getCell(r, columnMap.attendance) ?? "").trim() || null,
      total_before_discount: totalBefore ?? 0,
      total_after_discount: totalAfter ?? 0,
      status: "פתוח",
    };

    if (detailField && detailText) task[detailField] = detailText;
    if (notesVal) {
      task.other_details = task.other_details
        ? task.other_details + "\n" + notesVal
        : notesVal;
    }

    // Auto-compute totals from rates when missing
    const matchedPatient = matchedPatientId
      ? candidates.find((c) => c.id === matchedPatientId)
      : null;
    const effRate =
      hourlyRate !== null
        ? hourlyRate
        : matchedPatient?.hourly_rate != null
          ? Number(matchedPatient.hourly_rate)
          : null;
    const effRateDisc =
      hourlyRateDisc !== null
        ? hourlyRateDisc
        : matchedPatient?.hourly_rate_discounted != null
          ? Number(matchedPatient.hourly_rate_discounted)
          : effRate;
    if (totalBefore === null && effRate !== null && hours > 0) {
      task.total_before_discount = Number((hours * effRate).toFixed(2));
    }
    if (totalAfter === null && effRateDisc !== null && hours > 0) {
      task.total_after_discount = Number((hours * effRateDisc).toFixed(2));
    }

    if (isNew) {
      const k = nameKey + "|" + phone;
      if (!newPatients.has(k)) {
        newPatients.set(k, {
          full_name: name,
          phone: phone || null,
          treatment_type: treatmentType || null,
          hourly_rate: hourlyRate,
          hourly_rate_discounted: hourlyRateDisc,
        });
      }
    } else if (matchedPatientId && !patientUpdates.has(matchedPatientId)) {
      const upd = { id: matchedPatientId };
      if (treatmentType) upd.treatment_type = treatmentType;
      if (hourlyRate !== null) upd.hourly_rate = hourlyRate;
      if (hourlyRateDisc !== null) upd.hourly_rate_discounted = hourlyRateDisc;
      if (Object.keys(upd).length > 1) patientUpdates.set(matchedPatientId, upd);
    }

    valid.push({
      line,
      patient_name: name,
      patient_phone: phone,
      is_new_patient: isNew,
      matched_patient_id: matchedPatientId,
      newPatientKey: isNew ? nameKey + "|" + phone : null,
      task,
    });
  });

  return { valid, errors, skippedNoName, newPatients, patientUpdates };
}

async function parsePatients(rows, columnMap) {
  const errors = [];
  const valid = [];
  const skippedNoName = [];

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const name = String(getCell(r, columnMap.patient_name) ?? "").trim();
    if (!name) {
      skippedNoName.push(line);
      return;
    }
    const hourlyRate = toNumberOrNull(getCell(r, columnMap.hourly_rate));
    if (
      getCell(r, columnMap.hourly_rate) !== undefined &&
      getCell(r, columnMap.hourly_rate) !== "" &&
      hourlyRate === null
    ) {
      errors.push({ line, msg: "מחיר לשעה לא תקין" });
      return;
    }
    const hourlyRateDisc = toNumberOrNull(
      getCell(r, columnMap.hourly_rate_discounted),
    );

    valid.push({
      line,
      patient: {
        full_name: name,
        phone: String(getCell(r, columnMap.patient_phone) ?? "").trim() || null,
        email: String(getCell(r, columnMap.patient_email) ?? "").trim() || null,
        status:
          String(getCell(r, columnMap.patient_status) ?? "").trim() || "פעיל",
        treatment_type:
          String(getCell(r, columnMap.treatment_type) ?? "").trim() || null,
        hourly_rate: hourlyRate,
        hourly_rate_discounted: hourlyRateDisc,
        notes:
          String(
            getCell(r, columnMap.patient_notes) ??
              getCell(r, columnMap.notes) ??
              "",
          ).trim() || null,
      },
    });
  });

  return { valid, errors, skippedNoName };
}

async function parseCash(rows, columnMap) {
  const errors = [];
  const valid = [];

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const dateRaw = getCell(r, columnMap.date_gregorian);
    const date = dateRaw === "" || dateRaw === undefined ? null : toDateString(dateRaw);
    if (dateRaw !== "" && dateRaw !== undefined && date === null) {
      errors.push({ line, msg: `תאריך לא ניתן לפענוח: "${dateRaw}"` });
      return;
    }
    const amount = toNumberOrNull(getCell(r, columnMap.amount));
    if (
      getCell(r, columnMap.amount) !== undefined &&
      getCell(r, columnMap.amount) !== "" &&
      amount === null
    ) {
      errors.push({ line, msg: "סכום לא תקין" });
      return;
    }
    valid.push({
      line,
      record: {
        date,
        amount,
        purpose: String(getCell(r, columnMap.purpose) ?? "").trim() || null,
        notes: String(getCell(r, columnMap.notes) ?? "").trim() || null,
      },
    });
  });

  return { valid, errors };
}

/* ---------- Component ---------- */

export default function DataImport({ onDone }) {
  const [target, setTarget] = useState("tasks");
  const [parsed, setParsed] = useState(null);
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState("");
  const [fileError, setFileError] = useState("");
  const [fileName, setFileName] = useState("");

  function reset() {
    setParsed(null);
    setResultMsg("");
    setFileError("");
    setFileName("");
  }

  const requiredFields = TARGET_REQUIRED_FIELDS[target] || [];
  const optionalFieldsByTarget = useMemo(() => {
    if (target === "tasks") {
      return [
        "patient_phone",
        "treatment_type",
        "hourly_rate",
        "hourly_rate_discounted",
        "date_gregorian",
        "date_hebrew",
        "hours",
        "task_definition",
        "meeting_type",
        "detail_type",
        "detail_text",
        "travel",
        "travel_payment",
        "attendance",
        "total_before_discount",
        "total_after_discount",
        "notes",
      ];
    }
    if (target === "patients") {
      return [
        "patient_phone",
        "patient_email",
        "patient_status",
        "treatment_type",
        "hourly_rate",
        "hourly_rate_discounted",
        "notes",
      ];
    }
    return ["date_gregorian", "amount", "purpose", "notes"];
  }, [target]);

  async function handleFile(file) {
    if (!file) return;
    reset();
    setFileName(file.name);

    let workbook;
    try {
      const buf = await file.arrayBuffer();
      workbook = XLSX.read(buf, { cellDates: true, cellNF: true });
    } catch (err) {
      setFileError("לא ניתן לקרוא את הקובץ: " + err.message);
      return;
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      setFileError("הקובץ ריק");
      return;
    }
    const { headers, rows } = readSheet(sheet);
    if (rows.length === 0) {
      setFileError("לא נמצאו שורות בקובץ");
      return;
    }
    const columnMap = buildColumnMap(headers);
    const missingRequired = requiredFields.filter((f) => !columnMap[f]);

    if (missingRequired.length > 0) {
      setFileError(
        `חסרות עמודות חובה בקובץ: ${missingRequired
          .map((f) => `"${TARGET_FIELD_LABELS[f]}"`)
          .join(", ")}`,
      );
      setParsed({
        target,
        headers,
        columnMap,
        missingRequired,
        valid: [],
        errors: [],
      });
      return;
    }

    try {
      let result;
      if (target === "tasks") result = await parseTasks(rows, columnMap);
      else if (target === "patients") result = await parsePatients(rows, columnMap);
      else result = await parseCash(rows, columnMap);

      setParsed({
        target,
        headers,
        columnMap,
        missingRequired: [],
        total: rows.length,
        ...result,
      });
    } catch (err) {
      setFileError("שגיאה בעיבוד הקובץ: " + err.message);
    }
  }

  async function commit() {
    if (!parsed || !parsed.valid || parsed.valid.length === 0) return;
    setImporting(true);
    setResultMsg("");

    try {
      if (parsed.target === "patients") {
        const inserts = parsed.valid.map((v) => v.patient);
        const { error } = await supabase.from("patients").insert(inserts);
        if (error) throw new Error(error.message);
        setResultMsg(`יובאו ${inserts.length} מטופלים.`);
      } else if (parsed.target === "cash") {
        const inserts = parsed.valid.map((v) => v.record);
        const { error } = await supabase.from("cash_records").insert(inserts);
        if (error) throw new Error(error.message);
        setResultMsg(`יובאו ${inserts.length} רישומי קופה.`);
      } else {
        // tasks — create new patients first, then update existing, then insert tasks
        const keyToId = new Map();
        if (parsed.newPatients && parsed.newPatients.size > 0) {
          const toInsert = Array.from(parsed.newPatients.values());
          const { data, error } = await supabase
            .from("patients")
            .insert(toInsert)
            .select("id, full_name, phone");
          if (error) throw new Error(error.message);
          (data || []).forEach((p) => {
            const k = normalizeName(p.full_name) + "|" + (p.phone || "").trim();
            keyToId.set(k, p.id);
          });
        }

        if (parsed.patientUpdates && parsed.patientUpdates.size > 0) {
          for (const upd of parsed.patientUpdates.values()) {
            const { id, ...fields } = upd;
            const { error } = await supabase
              .from("patients")
              .update(fields)
              .eq("id", id);
            if (error) throw new Error(error.message);
          }
        }

        const tasksToInsert = parsed.valid.map((v) => {
          const pid =
            v.matched_patient_id ||
            keyToId.get(v.newPatientKey) ||
            null;
          return { ...v.task, patient_id: pid };
        });
        const { error } = await supabase.from("tasks").insert(tasksToInsert);
        if (error) throw new Error(error.message);

        const updatedCount = parsed.patientUpdates
          ? parsed.patientUpdates.size
          : 0;
        const newCount = parsed.newPatients ? parsed.newPatients.size : 0;
        setResultMsg(
          `יובאו ${tasksToInsert.length} משימות, ${newCount} מטופלים חדשים, ${updatedCount} מטופלים עודכנו.`,
        );
      }

      setParsed(null);
      setFileName("");
      if (onDone) onDone();
    } catch (err) {
      setResultMsg("שגיאה בייבוא: " + err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="section-title mb-3">לאן לייבא?</h2>
        <div className="grid grid-cols-3 gap-2">
          {TARGETS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setTarget(t.value);
                reset();
              }}
              className={
                "rounded-lg border px-4 py-3 text-sm font-medium transition-colors " +
                (target === t.value
                  ? "bg-accent-50 border-accent-500 text-accent-700"
                  : "bg-white border-line text-ink-700 hover:bg-surface-subtle")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-line pt-6 space-y-4">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <label className="label">בחר קובץ (xlsx / xls / csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="text-sm"
            />
            {fileName && (
              <p className="text-xs text-ink-500 mt-1">קובץ: {fileName}</p>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => downloadTemplate(target)}
          >
            הורדת תבנית
          </button>
        </div>

        {fileError && (
          <div className="card p-4 border-red-200 bg-red-50">
            <p className="text-red-800 text-sm font-medium">{fileError}</p>
            {parsed?.headers && (
              <div className="mt-2 text-xs text-red-800">
                <div className="font-semibold mb-1">כותרות שזוהו בקובץ:</div>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.headers.map((h, i) => (
                    <span
                      key={i}
                      className="bg-white border border-red-200 px-2 py-0.5 rounded"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {parsed && parsed.valid && (
          <div className="space-y-4">
            <div className="card p-4 bg-surface-subtle border-line">
              <div className="text-xs text-ink-500 font-semibold mb-2">
                עמודות שזוהו (מיפוי אוטומטי):
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {Object.entries(parsed.columnMap || {}).map(
                  ([field, header]) => (
                    <span
                      key={field}
                      className="bg-white border border-line px-2 py-1 rounded"
                    >
                      <span className="text-ink-500">
                        {TARGET_FIELD_LABELS[field] || field}:
                      </span>{" "}
                      <span className="text-ink-900 font-medium">
                        {header}
                      </span>
                    </span>
                  ),
                )}
              </div>
              {parsed.headers.some((h) =>
                !Object.values(parsed.columnMap || {}).includes(h),
              ) && (
                <div className="mt-3 text-xs text-ink-500">
                  כותרות שלא מופו (יתעלמו):{" "}
                  {parsed.headers
                    .filter(
                      (h) => !Object.values(parsed.columnMap || {}).includes(h),
                    )
                    .map((h, i, arr) => (
                      <span key={i}>
                        <span className="bg-white border border-line px-1.5 py-0.5 rounded">
                          {h}
                        </span>
                        {i < arr.length - 1 ? " " : ""}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="card p-4">
                <div className="stat-label">שורות בקובץ</div>
                <div className="stat-value text-xl">{parsed.total}</div>
              </div>
              <div className="card p-4">
                <div className="stat-label">תקינות</div>
                <div className="stat-value text-xl">{parsed.valid.length}</div>
              </div>
              <div className="card p-4">
                <div className="stat-label">דולגו (ללא שם)</div>
                <div className="stat-value text-xl">
                  {parsed.skippedNoName ? parsed.skippedNoName.length : 0}
                </div>
              </div>
              <div className="card p-4">
                <div className="stat-label">שגיאות</div>
                <div className="stat-value text-xl">
                  {parsed.errors.length}
                </div>
              </div>
              {parsed.target === "tasks" && (
                <div className="card p-4">
                  <div className="stat-label">מטופלים חדשים</div>
                  <div className="stat-value text-xl">
                    {parsed.newPatients ? parsed.newPatients.size : 0}
                  </div>
                </div>
              )}
            </div>

            {parsed.skippedNoName && parsed.skippedNoName.length > 0 && (
              <p className="text-xs text-ink-500">
                דולגו {parsed.skippedNoName.length} שורות ללא שם מטופל
                (שורות: {parsed.skippedNoName.slice(0, 12).join(", ")}
                {parsed.skippedNoName.length > 12 ? "..." : ""}).
              </p>
            )}

            {parsed.errors.length > 0 && (
              <div className="card p-4 border-red-200 bg-red-50">
                <p className="font-semibold text-red-800 mb-2">
                  השורות הבאות לא ייובאו:
                </p>
                <ul className="text-sm text-red-800 space-y-1 list-disc pr-5 max-h-48 overflow-y-auto">
                  {parsed.errors.map((e, i) => (
                    <li key={i}>
                      שורה {e.line}: {e.msg}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.valid.length > 0 && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={importing}
                  onClick={commit}
                >
                  {importing
                    ? "מייבא..."
                    : `אשר ייבוא של ${parsed.valid.length} שורות`}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={reset}
                  disabled={importing}
                >
                  ביטול
                </button>
              </div>
            )}
          </div>
        )}

        {resultMsg && (
          <p className="text-sm font-medium text-accent-700">{resultMsg}</p>
        )}
      </div>
    </div>
  );
}
