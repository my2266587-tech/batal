// Shared patient-matching for phone recordings. Pure functions only — the
// caller passes in the patients list. The spoken name / hours / task definition
// are extracted by the LLM (see lib/transcribe.js); this only maps a spoken name
// to an existing patient for an unambiguous, exact match.

// Normalise a Hebrew string for name comparison.
export function normHeb(s) {
  return String(s || "")
    .replace(/[֑-ׇ]/g, "") // niqqud / cantillation
    .replace(/["'׳״.,\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Match a patient by a spoken name (or transcript). Returns the patient id and
// the matched full name, or nulls. Picks the longest full_name that occurs in
// the text (most specific) — an unambiguous, exact normalized match only.
export function matchPatientByName(patients, text) {
  const norm = normHeb(text);
  if (!norm || !Array.isArray(patients)) {
    return { patientId: null, matchedName: null };
  }
  let best = null;
  for (const p of patients) {
    const fn = normHeb(p.full_name);
    if (fn && norm.includes(fn)) {
      if (!best || fn.length > best.len) {
        best = { id: p.id, name: p.full_name, len: fn.length };
      }
    }
  }
  return best
    ? { patientId: best.id, matchedName: best.name }
    : { patientId: null, matchedName: null };
}
