// Telephone capture via Yemot Hamashiach ("ימות המשיח") — single-recording flow.
//
// A single Yemot "API" extension points at this endpoint. The caller says ONE
// sentence containing: the patient's name, the duration (hours), and the task
// definition. After she confirms (presses 1), the server parses the transcript
// and saves a row to the `phone_recordings` review table — it does NOT create
// a task. A task in the existing `tasks` table is created only later, when a
// user approves the recording on the "טלפונים ממתינים" screen.
//
// State for the (multi-request) call lives in the transient `ivr_sessions`
// table, so a dropped call before confirmation never saves a partial row.
// Duplicates are prevented by the unique call id (ApiCallId).
//
// Field mapping (`phone_recordings` columns):
//   spoken patient name → spoken_patient_name (kept verbatim, never overwritten)
//   matched patient     → patient_id (exact name match; null when unmatched)
//   duration (hours)    → hours
//   task definition     → task_definition
//   caller number       → caller_phone
//   recording path      → recording_url
//   full transcript     → transcription
//   unique call id      → call_external_id
//   review state        → status (ready / needs_patient / failed)
//
// No payment / case logic is touched. Anon key only (server-side).

import { getServerSupabase } from "@/lib/supabaseServer";
import {
  parseYemotParams,
  readTap,
  readRecord,
  sayAndHangup,
  t,
  f,
  parseHebrewDuration,
} from "@/lib/yemot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Steps in the (short) conversation.
const STEP = { START: 1, RECORD: 2, CONFIRM: 3, DONE: 4 };

const TASK_PLACEHOLDER = "🎤 משימה מהטלפון - יש להאזין להקלטה";

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Variable name Yemot reads each step into — namespaced by attempt so a
// "re-record" (which bumps `attempt`) is never shadowed by an echoed value.
function varName(step, attempt) {
  return `v${step}_${attempt}`;
}

// Normalise a Hebrew string for name comparison.
function normHeb(s) {
  return String(s || "")
    .replace(/[֑-ׇ]/g, "") // niqqud / cantillation
    .replace(/["'׳״.,\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pull a transcription out of whatever field Yemot may have used.
function pickTranscription(params, recVar) {
  const keys = [
    "transcription", "transcript", "ApiTranscript", "ApiTranscription",
    "text", "ApiRecordingText",
    `${recVar}_transcription`, `${recVar}Transcription`, `${recVar}_text`,
  ];
  for (const k of keys) {
    if (params[k] != null && String(params[k]).trim() !== "") {
      return String(params[k]).trim();
    }
  }
  return "";
}

function renderStep(session) {
  switch (session.step) {
    case STEP.START:
      return readTap(t("להקלטת משימה חדשה הקישי 1"), varName(STEP.START, 1), {
        max: 1,
        min: 1,
        sec: 8,
      });
    case STEP.RECORD:
      return readRecord(
        t(
          "אמרי במשפט אחד את שם המטופלת משך השעות והגדרת המשימה ולסיום הקישי סולמית",
        ),
        varName(STEP.RECORD, session.attempt),
      );
    case STEP.CONFIRM: {
      const d = session.data || {};
      const messages = [t("ההקלטה שהוקלטה היא")];
      if (d.rec) messages.push(f(d.rec));
      messages.push(
        t("לשמירה הקישי 1 להקלטה מחדש הקישי 2 לביטול הקישי 3"),
      );
      return readTap(messages, varName(STEP.CONFIRM, session.attempt), {
        max: 1,
        min: 1,
        sec: 10,
      });
    }
    default:
      return sayAndHangup(t("תודה רבה ולהתראות"));
  }
}

// Match a patient by the name spoken in the transcript. Returns the patient id
// and the matched full name, or nulls. Picks the longest full_name that occurs
// in the transcript (most specific match).
async function matchPatientByName(supabase, transcript) {
  const norm = normHeb(transcript);
  if (!norm) return { patientId: null, matchedName: null };
  const { data, error } = await supabase.from("patients").select("id, full_name");
  if (error || !Array.isArray(data)) return { patientId: null, matchedName: null };
  let best = null;
  for (const p of data) {
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

// Best-effort extraction of the spoken patient name from the transcript.
// When an exact patient was matched, the matched full name *is* what was said
// (it occurs verbatim in the transcript), so prefer it. Otherwise fall back to
// a heuristic: the caller is asked to say the name first, so take the words up
// to the first duration/number token (capped at 3 words).
function extractSpokenName(transcript, matchedName) {
  if (matchedName) return matchedName;
  const norm = normHeb(transcript);
  if (!norm) return null;
  const words = norm.split(" ").filter(Boolean);
  if (!words.length) return null;
  const DUR = /^(שעה|שעתיים|שעות|דקה|דקות|חצי|רבע|שלושת|רבעי)$/;
  let idx = words.findIndex((w) => /\d/.test(w) || DUR.test(w));
  if (idx <= 0) idx = Math.min(2, words.length); // no marker → first two words
  idx = Math.min(idx, 3); // never let the "name" run longer than 3 words
  const name = words.slice(0, idx).join(" ").trim();
  return name || null;
}

// Derive a clean task definition: the transcript with the patient name removed
// (so it reads as the task only). Falls back to the full transcript.
function buildTaskDefinition(transcript, spokenName, matchedName) {
  if (!transcript) return null;
  let def = transcript;
  for (const n of [matchedName, spokenName]) {
    if (n) def = def.replace(new RegExp(escapeRegex(n), "g"), " ");
  }
  def = def.replace(/\s+/g, " ").trim();
  return def.length >= 2 ? def : transcript;
}

// Save the confirmed recording to the review table. Idempotent on
// call_external_id — never creates a task here (that happens on approval).
async function createRecording(supabase, session, callId, phone) {
  const d = session.data || (session.data = {});

  if (d.recording_id) return { ok: true, recordingId: d.recording_id };
  const existing = await supabase
    .from("phone_recordings")
    .select("id")
    .eq("call_external_id", callId)
    .maybeSingle();
  if (existing.data?.id) return { ok: true, recordingId: existing.data.id };

  const transcript = (d.transcript || "").trim();

  // Exact patient match (best-effort) + the name the caller actually said.
  let patientId = null;
  let matchedName = null;
  if (transcript) {
    const m = await matchPatientByName(supabase, transcript);
    patientId = m.patientId;
    matchedName = m.matchedName;
  }
  const spokenName = extractSpokenName(transcript, matchedName);
  const hours = transcript ? parseHebrewDuration(transcript) : null;
  const taskDefinition = transcript
    ? buildTaskDefinition(transcript, spokenName, matchedName)
    : d.rec
      ? TASK_PLACEHOLDER
      : null;

  // Review state: no transcript → failed (needs manual listen); matched
  // patient → ready for approval; otherwise needs a patient to be linked.
  const status = !transcript ? "failed" : patientId ? "ready" : "needs_patient";

  const payload = {
    call_external_id: callId,
    caller_phone: phone || session.caller_phone || null,
    recording_url: d.rec || null,
    transcription: transcript || null,
    spoken_patient_name: spokenName || null,
    patient_id: patientId,
    hours: hours != null ? hours : null,
    task_definition: taskDefinition,
    status,
  };

  const { data, error } = await supabase
    .from("phone_recordings")
    .insert([payload])
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const again = await supabase
        .from("phone_recordings")
        .select("id")
        .eq("call_external_id", callId)
        .maybeSingle();
      if (again.data?.id) return { ok: true, recordingId: again.data.id };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, recordingId: data.id };
}

async function loadSession(supabase, callId, phone) {
  const { data } = await supabase
    .from("ivr_sessions")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle();
  if (data) return data;
  const fresh = {
    call_id: callId,
    caller_phone: phone || null,
    step: STEP.START,
    attempt: 1,
    data: {},
    task_id: null,
  };
  await supabase.from("ivr_sessions").upsert(fresh, { onConflict: "call_id" });
  return fresh;
}

async function saveSession(supabase, session) {
  await supabase
    .from("ivr_sessions")
    .update({
      step: session.step,
      attempt: session.attempt,
      data: session.data,
      task_id: session.task_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("call_id", session.call_id);
}

async function handle(request) {
  const params = await parseYemotParams(request);

  // --- Auth (fail-closed) — checked before anything else ---
  const expected = process.env.YEMOT_IVR_TOKEN;
  if (!expected) {
    console.error(
      "[yemot-ivr] YEMOT_IVR_TOKEN is not configured — refusing all requests (fail-closed)",
    );
    return textResponse(sayAndHangup(t("המערכת אינה זמינה כעת")), 503);
  }
  if (!params.token || params.token !== expected) {
    console.warn("[yemot-ivr] rejected request: missing/invalid token");
    return textResponse(sayAndHangup(t("שגיאת הרשאה לא ניתן להמשיך")), 401);
  }

  // Hang-up notification — nothing to do, no partial task.
  if (params.hangup === "yes" || params.ApiHangup === "yes") {
    return textResponse("");
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    console.error("[yemot-ivr] Supabase env not configured");
    return textResponse(
      sayAndHangup(t("המערכת אינה זמינה כעת אנא נסי מאוחר יותר")),
    );
  }

  const callId = params.ApiCallId || params.PBXcallId || params.callId;
  const phone = params.ApiPhone || params.PBXphone || params.phone || null;
  if (!callId) {
    console.warn("[yemot-ivr] request without call id");
    return textResponse(sayAndHangup(t("שגיאה בזיהוי השיחה")));
  }

  const session = await loadSession(supabase, callId, phone);

  if (session.step === STEP.DONE) {
    return textResponse(sayAndHangup(t("תודה רבה ולהתראות")));
  }

  const expectedVar = varName(session.step, session.attempt);
  const incoming = params[expectedVar];

  if (incoming !== undefined) {
    const value = String(incoming);
    const terminal = await applyInput(supabase, session, value, params, callId, phone);
    if (terminal) {
      await saveSession(supabase, session);
      return textResponse(terminal);
    }
    await saveSession(supabase, session);
  }

  return textResponse(renderStep(session));
}

// Mutates `session` based on the caller's input. Returns a terminal response
// string when the call should end, else null.
async function applyInput(supabase, session, value, params, callId, phone) {
  const d = session.data || (session.data = {});
  const v = value.trim();

  switch (session.step) {
    case STEP.START:
      if (v === "1") {
        session.step = STEP.RECORD;
      } else {
        session.step = STEP.DONE;
        return sayAndHangup(t("לא נבחרה אפשרות תקינה להתראות"));
      }
      break;

    case STEP.RECORD:
      d.rec = v;
      d.transcript = pickTranscription(params, varName(STEP.RECORD, session.attempt));
      session.step = STEP.CONFIRM;
      break;

    case STEP.CONFIRM:
      if (v === "1") {
        const res = await createRecording(supabase, session, callId, phone);
        session.step = STEP.DONE;
        if (res.ok) {
          // Track the saved recording id in the session data (jsonb) so a
          // duplicate request within the same call never inserts twice.
          d.recording_id = res.recordingId;
          console.log(
            `[yemot-ivr] recording saved call=${callId} recording=${res.recordingId}`,
          );
          return sayAndHangup(
            t("ההקלטה נשמרה וממתינה לאישור תודה ולהתראות"),
          );
        }
        console.error(`[yemot-ivr] recording save failed call=${callId}`);
        return sayAndHangup(t("אירעה שגיאה בשמירת ההקלטה אנא נסי שוב מאוחר יותר"));
      } else if (v === "2") {
        // Re-record: bump attempt (avoid echoed-var shadowing) and restart.
        session.attempt += 1;
        session.data = {};
        session.step = STEP.RECORD;
      } else if (v === "3") {
        session.step = STEP.DONE;
        return sayAndHangup(t("המשימה בוטלה להתראות"));
      }
      // any other key → re-issue confirm
      break;

    default:
      break;
  }
  return null;
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
