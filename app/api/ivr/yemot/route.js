// Telephone task creation via Yemot Hamashiach ("ימות המשיח").
//
// A single Yemot "API" extension points at this endpoint. The server drives the
// whole conversation: on every interaction Yemot calls us, we look up the call
// state in the transient `ivr_sessions` table, advance one step, and answer with
// the next prompt. The task is written to the existing `tasks` table ONLY when
// the caller confirms (presses 1). A dropped call therefore never creates a
// partial task. Duplicates are prevented by the unique call id (ApiCallId).
//
// No payment / case / RLS logic is touched. Anon key only (server-side).

import { getServerSupabase } from "@/lib/supabaseServer";
import {
  parseYemotParams,
  readTap,
  readRecord,
  sayAndHangup,
  t,
  f,
  priorityText,
  resolveDueDate,
  parseManualDate,
  parseManualTime,
  dueDateText,
} from "@/lib/yemot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Steps in the conversation.
const STEP = {
  START: 1,
  TITLE: 2,
  DESC: 3,
  DATE_CHOICE: 4,
  DATE_MANUAL: 5,
  TIME_CHOICE: 6,
  TIME_MANUAL: 7,
  PRIORITY: 8,
  LINK_CHOICE: 9,
  PATIENT_KEY: 10,
  CONFIRM: 11,
  DONE: 12,
};

const TITLE_PLACEHOLDER = "🎤 משימה מהטלפון - יש להאזין להקלטה";
const DESC_PLACEHOLDER = "🎤 תיאור מוקלט - יש להאזין להקלטה";

function textResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Variable name Yemot reads each step into — namespaced by attempt so that a
// "re-record" (which bumps `attempt`) is never shadowed by an echoed old value.
function varName(step, attempt) {
  return `v${step}_${attempt}`;
}

// Keep only digits from a phone-ish string.
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

// Build the prompt to send for the current step.
function renderStep(session) {
  const v = (step) => varName(step, session.attempt);
  switch (session.step) {
    case STEP.START:
      return readTap(t("להקלטת משימה חדשה הקישי 1"), varName(STEP.START, 1), {
        max: 1,
        min: 1,
        sec: 8,
      });
    case STEP.TITLE:
      return readRecord(
        t("הקליטי בקצרה את כותרת המשימה ולסיום הקישי סולמית"),
        v(STEP.TITLE),
      );
    case STEP.DESC:
      return readRecord(
        t("הקליטי פרטים נוספים למשימה אם אין פרטים נוספים הקישי סולמית"),
        v(STEP.DESC),
      );
    case STEP.DATE_CHOICE:
      return readTap(
        t(
          "לתאריך יעד להיום הקישי 1 למחר הקישי 2 לבחירת תאריך הקישי 3 ללא תאריך הקישי 4",
        ),
        v(STEP.DATE_CHOICE),
        { max: 1, min: 1 },
      );
    case STEP.DATE_MANUAL:
      return readTap(
        t("הקישי תאריך בספרות יום חודש ושנה שמונה ספרות ולסיום הקישי סולמית"),
        v(STEP.DATE_MANUAL),
        { max: 8, min: 8 },
      );
    case STEP.TIME_CHOICE:
      return readTap(
        t("לשעת יעד להקלדת שעה הקישי 1 ללא שעה הקישי 2"),
        v(STEP.TIME_CHOICE),
        { max: 1, min: 1 },
      );
    case STEP.TIME_MANUAL:
      return readTap(
        t("הקישי שעה בספרות שעות ודקות ארבע ספרות ולסיום הקישי סולמית"),
        v(STEP.TIME_MANUAL),
        { max: 4, min: 4 },
      );
    case STEP.PRIORITY:
      return readTap(
        t("לעדיפות רגילה הקישי 1 לעדיפות גבוהה הקישי 2 לעדיפות דחופה הקישי 3"),
        v(STEP.PRIORITY),
        { max: 1, min: 1 },
      );
    case STEP.LINK_CHOICE:
      return readTap(
        t("לשיוך המשימה ללא שיוך הקישי 1 לשיוך לתיק קיים הקישי 2"),
        v(STEP.LINK_CHOICE),
        { max: 1, min: 1 },
      );
    case STEP.PATIENT_KEY:
      return readTap(
        t("הקישי את מספר המזהה או הטלפון של המטופלת ולסיום הקישי סולמית"),
        v(STEP.PATIENT_KEY),
        { max: 20, min: 1 },
      );
    case STEP.CONFIRM:
      return renderConfirm(session);
    default:
      return sayAndHangup(t("תודה רבה ולהתראות"));
  }
}

// The confirmation summary: plays the recorded title, then reads the choice.
function renderConfirm(session) {
  const d = session.data || {};
  const dateTxt = dueDateText(d.date_choice, d.date_manual);
  const prioTxt = priorityText(d.priority);
  const messages = [t("המשימה היא")];
  if (d.title_rec) messages.push(f(d.title_rec));
  messages.push(
    t(
      `לתאריך ${dateTxt} בעדיפות ${prioTxt} לשמירה הקישי 1 להקלטה מחדש הקישי 2 לביטול הקישי 3`,
    ),
  );
  return readTap(messages, varName(STEP.CONFIRM, session.attempt), {
    max: 1,
    min: 1,
    sec: 10,
  });
}

// Resolve a patient by the digits the caller typed (matched against phone).
// Returns { patient_id, matched } — patient_id null if not exactly resolvable.
async function resolvePatient(supabase, key) {
  const digits = digitsOnly(key);
  if (!digits) return { patient_id: null, matched: false };
  const { data, error } = await supabase
    .from("patients")
    .select("id, phone")
    .not("phone", "is", null);
  if (error || !Array.isArray(data)) return { patient_id: null, matched: false };
  const matches = data.filter((p) => {
    const pd = digitsOnly(p.phone);
    return pd && (pd === digits || pd.endsWith(digits) || digits.endsWith(pd));
  });
  if (matches.length === 1) return { patient_id: matches[0].id, matched: true };
  return { patient_id: null, matched: false };
}

// Create the task from the confirmed session. Idempotent on call_external_id.
async function createTask(supabase, session, callId, phone) {
  const d = session.data || {};

  // Already created for this call? (session bookkeeping or unique key)
  if (session.task_id) return { ok: true, taskId: session.task_id };
  const existing = await supabase
    .from("tasks")
    .select("id")
    .eq("call_external_id", callId)
    .maybeSingle();
  if (existing.data?.id) return { ok: true, taskId: existing.data.id };

  // Patient link (optional).
  let patientId = null;
  let unresolvedKey = null;
  if (String(d.link_choice) === "2" && d.patient_key) {
    const r = await resolvePatient(supabase, d.patient_key);
    patientId = r.patient_id;
    if (!r.matched) unresolvedKey = digitsOnly(d.patient_key);
  }

  // Title / description: use transcription text if the IVR provided any,
  // otherwise fall back to a placeholder and rely on the recording.
  const titleText = (d.title_text || "").trim();
  const descText = (d.desc_text || "").trim();

  const otherNotes = [];
  if (d.desc_rec && !descText)
    otherNotes.push(`הקלטת תיאור: ${d.desc_rec}`);
  if (unresolvedKey)
    otherNotes.push(`מספר שהוקש לשיוך (לא זוהה אוטומטית): ${unresolvedKey}`);

  const payload = {
    task_definition: titleText || (d.title_rec ? TITLE_PLACEHOLDER : null),
    call_details: descText || (d.desc_rec ? DESC_PLACEHOLDER : null),
    date_gregorian: resolveDueDate(d.date_choice, d.date_manual),
    start_time:
      String(d.time_choice) === "1" ? parseManualTime(d.time_manual) : null,
    priority: priorityText(d.priority),
    status: "פתוח",
    patient_id: patientId,
    source: "phone",
    caller_phone: phone || session.caller_phone || null,
    recording_url: d.title_rec || null,
    transcription: titleText || null,
    other_details: otherNotes.length ? otherNotes.join(" | ") : null,
    call_external_id: callId,
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert([payload])
    .select("id")
    .single();

  if (error) {
    // Unique-violation → another concurrent request already created it.
    if (error.code === "23505") {
      const again = await supabase
        .from("tasks")
        .select("id")
        .eq("call_external_id", callId)
        .maybeSingle();
      if (again.data?.id) return { ok: true, taskId: again.data.id };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, taskId: data.id };
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

  // Call hang-up notification from Yemot — nothing to do, no partial task.
  if (params.hangup === "yes" || params.ApiHangup === "yes") {
    return textResponse("");
  }

  // Auth: require a shared token if configured (Yemot sends it as a param).
  const expected = process.env.YEMOT_IVR_TOKEN;
  if (expected) {
    if (params.token !== expected) {
      console.warn("[yemot-ivr] rejected request: bad/missing token");
      return textResponse(sayAndHangup(t("שגיאת הרשאה לא ניתן להמשיך")));
    }
  } else {
    console.warn(
      "[yemot-ivr] YEMOT_IVR_TOKEN is not set — endpoint is unauthenticated",
    );
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

  // If the call already finished, just hang up cleanly.
  if (session.step === STEP.DONE) {
    return textResponse(sayAndHangup(t("תודה רבה ולהתראות")));
  }

  // Did Yemot send the value for the step we're waiting on?
  const expectedVar = varName(session.step, session.attempt);
  const incoming = params[expectedVar];

  if (incoming !== undefined) {
    const value = String(incoming);
    const advanceResult = await applyInput(supabase, session, value, callId, phone);
    if (advanceResult) {
      // Terminal response (save / cancel) produced directly.
      await saveSession(supabase, session);
      return textResponse(advanceResult);
    }
    await saveSession(supabase, session);
  }

  return textResponse(renderStep(session));
}

// Mutates `session` based on the caller's input for the current step.
// Returns a terminal response string when the call should end, else null.
async function applyInput(supabase, session, value, callId, phone) {
  const d = session.data || (session.data = {});
  const v = value.trim();

  switch (session.step) {
    case STEP.START:
      if (v === "1") {
        session.step = STEP.TITLE;
      } else {
        session.step = STEP.DONE;
        return sayAndHangup(t("לא נבחרה אפשרות תקינה להתראות"));
      }
      break;

    case STEP.TITLE:
      d.title_rec = v;
      session.step = STEP.DESC;
      break;

    case STEP.DESC:
      d.desc_rec = v && v !== "0" ? v : "";
      session.step = STEP.DATE_CHOICE;
      break;

    case STEP.DATE_CHOICE:
      d.date_choice = v;
      session.step = v === "3" ? STEP.DATE_MANUAL : STEP.TIME_CHOICE;
      break;

    case STEP.DATE_MANUAL:
      if (parseManualDate(v)) {
        d.date_manual = v;
        session.step = STEP.TIME_CHOICE;
      }
      // invalid → stay on this step and re-prompt
      break;

    case STEP.TIME_CHOICE:
      d.time_choice = v;
      session.step = v === "1" ? STEP.TIME_MANUAL : STEP.PRIORITY;
      break;

    case STEP.TIME_MANUAL:
      if (parseManualTime(v)) {
        d.time_manual = v;
        session.step = STEP.PRIORITY;
      }
      break;

    case STEP.PRIORITY:
      d.priority = ["1", "2", "3"].includes(v) ? v : "1";
      session.step = STEP.LINK_CHOICE;
      break;

    case STEP.LINK_CHOICE:
      d.link_choice = v;
      session.step = v === "2" ? STEP.PATIENT_KEY : STEP.CONFIRM;
      break;

    case STEP.PATIENT_KEY:
      d.patient_key = v;
      session.step = STEP.CONFIRM;
      break;

    case STEP.CONFIRM:
      if (v === "1") {
        const res = await createTask(supabase, session, callId, phone);
        session.step = STEP.DONE;
        if (res.ok) {
          session.task_id = res.taskId;
          console.log(
            `[yemot-ivr] task created call=${callId} task=${res.taskId}`,
          );
          return sayAndHangup(t("המשימה נשמרה בהצלחה תודה ולהתראות"));
        }
        console.error(`[yemot-ivr] task save failed call=${callId}`);
        return sayAndHangup(
          t("אירעה שגיאה בשמירת המשימה אנא נסי שוב מאוחר יותר"),
        );
      } else if (v === "2") {
        // Re-record: bump attempt (so echoed vars don't shadow) and restart.
        session.attempt += 1;
        session.data = {};
        session.step = STEP.TITLE;
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
