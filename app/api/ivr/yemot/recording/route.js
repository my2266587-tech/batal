// Post-recording webhook for the Yemot "type=record" flow.
//
// Flow: extension `/1` is a native `type=record` (record → playback → approve →
// re-record — UNCHANGED). On approval it routes to `/1/9`, a `type=api`
// extension that hits THIS endpoint purely as a TRIGGER. We do NOT rely on
// `record_end_goto` to carry the file. Instead, here we PULL the just-saved
// recording out of Yemot via the management API and store it for review.
//
// Steps:
//   1. authenticate (same YEMOT_IVR_TOKEN, fail-closed)
//   2. idempotency guard on call id (ApiCallId)
//   3. GetIVR2Dir + DownloadFile → newest recording in the record folder
//   4. upload the audio to a PRIVATE Supabase Storage bucket ("recordings")
//   5. insert the `phone_recordings` row and RESPOND TO YEMOT IMMEDIATELY
//   6. in the background (waitUntil): transcribe (Hebrew) + extract the 3 fields
//      (LLM JSON) + match a patient, then UPDATE the row:
//        matched patient      → status "ready"
//        transcript, no match → status "needs_patient"
//        transcription failed → status "failed" (recording kept + editable)
//
// Background work uses waitUntil() from @vercel/functions (Next.js 14.2 — too
// old for next/server after()). It never creates a task in `tasks` (that only
// happens on manual approval in the "טלפונים ממתינים" screen). The
// YEMOT_API_TOKEN / OPENAI_API_KEY are never logged.

import { waitUntil } from "@vercel/functions";
import { getServerSupabase } from "@/lib/supabaseServer";
import { parseYemotParams, sayAndHangup, t } from "@/lib/yemot";
import { yemotApiReady, fetchLatestRecording, redact } from "@/lib/yemotApi";
import { transcribeReady, transcribeHebrew, extractTaskFields } from "@/lib/transcribe";
import { matchPatientByName } from "@/lib/phoneExtract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow time for the background transcription to finish after the response.
export const maxDuration = 60;

const BUCKET = "recordings";

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function safeName(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

// Insert the review row (without transcription — that arrives in the
// background). Idempotent on call_external_id. Returns the new row id.
async function insertRecordingRow(supabase, { callId, phone, storagePath, status }) {
  const payload = {
    call_external_id: callId,
    caller_phone: phone || null,
    recording_url: storagePath || null, // storage object path (signed on read)
    status,
  };
  const { data, error } = await supabase
    .from("phone_recordings")
    .insert([payload])
    .select("id")
    .single();
  if (error && error.code === "23505") return { ok: true, duplicate: true, id: null };
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

// Background: transcribe the audio (Hebrew), extract the 3 fields via the LLM,
// match a patient, and update the row. A failure NEVER loses the recording —
// it just lands as "failed" / "needs_patient" for manual handling.
async function processRecording(supabase, { rowId, audioBuffer, audioName, callId }) {
  console.log(`[yemot-rec] background started call=${callId} bytes=${audioBuffer?.length || 0}`);
  let transcription = null;
  try {
    console.log(`[yemot-rec] openai request started call=${callId} op=transcription`);
    transcription = await transcribeHebrew(audioBuffer, audioName);
    console.log(`[yemot-rec] transcription ok call=${callId} chars=${transcription.length}`);
  } catch (e) {
    console.error(`[yemot-rec] transcription failed call=${callId}: ${redact(e?.message || String(e))}`);
  }

  const update = {
    transcription: transcription || null,
    spoken_patient_name: null,
    hours: null,
    task_definition: null,
    patient_id: null,
    status: "failed",
    updated_at: new Date().toISOString(),
  };

  if (transcription) {
    try {
      console.log(`[yemot-rec] openai request started call=${callId} op=extract`);
      const fields = await extractTaskFields(transcription);
      update.spoken_patient_name = fields.spoken_patient_name || null;
      update.hours = fields.hours != null ? fields.hours : null;
      update.task_definition = fields.task_definition || null;

      const { data: patients } = await supabase
        .from("patients")
        .select("id, full_name");
      const m = matchPatientByName(
        patients || [],
        update.spoken_patient_name || transcription,
      );
      update.patient_id = m.patientId;
      // Unambiguous match → ready; transcript but no clear match → needs patient.
      update.status = m.patientId ? "ready" : "needs_patient";
    } catch (e) {
      // Keep the transcript; leave it for manual linking.
      update.status = "needs_patient";
      console.error(`[yemot-rec] extraction failed call=${callId}: ${redact(e?.message || String(e))}`);
    }
  }

  const { error } = await supabase
    .from("phone_recordings")
    .update(update)
    .eq("id", rowId);
  if (error) {
    console.error(`[yemot-rec] row update failed call=${callId}: ${error.message}`);
  } else {
    console.log(`[yemot-rec] phone_recordings updated call=${callId} status=${update.status}`);
  }
}

async function handle(request) {
  const params = await parseYemotParams(request);

  // --- Auth (fail-closed) ---
  const expected = process.env.YEMOT_IVR_TOKEN;
  if (!expected) {
    console.error("[yemot-rec] YEMOT_IVR_TOKEN not configured — refusing (fail-closed)");
    return textResponse(sayAndHangup(t("המערכת אינה זמינה כעת")), 503);
  }
  if (!params.token || params.token !== expected) {
    console.warn("[yemot-rec] rejected: missing/invalid token");
    return textResponse(sayAndHangup(t("שגיאת הרשאה")), 401);
  }

  const callId = params.ApiCallId || params.PBXcallId || params.callId;
  const phone = params.ApiPhone || params.PBXphone || params.phone || null;
  const isHangup = params.hangup === "yes" || params.ApiHangup === "yes";

  if (!callId) {
    console.warn("[yemot-rec] request without call id");
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("שגיאה בזיהוי השיחה")));
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    console.error("[yemot-rec] Supabase env not configured");
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("המערכת אינה זמינה כעת")));
  }

  // --- Idempotency: this call already captured? ---
  const existing = await supabase
    .from("phone_recordings")
    .select("id")
    .eq("call_external_id", callId)
    .maybeSingle();
  if (existing.data?.id) {
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("ההקלטה כבר נשמרה תודה")));
  }

  if (!yemotApiReady()) {
    console.error("[yemot-rec] YEMOT_API_TOKEN not configured — cannot pull recording");
    // Record a failed row so the call is never silently lost.
    await insertRecordingRow(supabase, { callId, phone, storagePath: null, status: "failed" });
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("אירעה שגיאה תודה")));
  }

  // --- Phase A: pull the recording from Yemot and store it privately ---
  let storagePath = null;
  let audioBuffer = null;
  let audioName = "recording.wav";
  try {
    const { buffer, fileName } = await fetchLatestRecording();
    console.log(`[yemot-rec] audio downloaded call=${callId} bytes=${buffer.length} file=${redact(fileName)}`);
    const path = `phone/${safeName(callId)}_${safeName(fileName) || "rec"}.wav`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: "audio/wav", upsert: true });
    if (upErr) throw new Error(`storage upload: ${upErr.message}`);
    storagePath = path;
    audioBuffer = buffer;
    audioName = fileName || audioName;
    console.log(`[yemot-rec] storage uploaded call=${callId} -> ${BUCKET}/${storagePath}`);
  } catch (e) {
    console.error(`[yemot-rec] pull failed call=${callId}: ${redact(e?.message || String(e))}`);
  }

  // --- Insert the row now (recording present → pending; else failed) and
  //     respond to Yemot immediately. Transcription happens in the background. ---
  const initialStatus = storagePath ? "needs_patient" : "failed";
  const res = await insertRecordingRow(supabase, {
    callId,
    phone,
    storagePath,
    status: initialStatus,
  });
  if (!res.ok) {
    console.error(`[yemot-rec] db insert failed call=${callId}: ${res.error}`);
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("אירעה שגיאה תודה")));
  }

  // --- Background (kept alive past the response via waitUntil): transcribe +
  //     extract + match. ---
  if (res.id && storagePath && transcribeReady()) {
    console.log(`[yemot-rec] scheduling background call=${callId} row=${res.id}`);
    waitUntil(
      processRecording(supabase, { rowId: res.id, audioBuffer, audioName, callId }).catch((e) =>
        console.error(`[yemot-rec] background error call=${callId}: ${redact(e?.message || String(e))}`),
      ),
    );
  } else if (storagePath && !transcribeReady()) {
    console.warn("[yemot-rec] OPENAI_API_KEY not configured — recording saved without transcription");
  }

  return isHangup
    ? textResponse("")
    : textResponse(sayAndHangup(t("ההקלטה נשמרה וממתינה לאישור תודה ולהתראות")));
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
