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
//   5. insert a row in `phone_recordings` (status: needs_patient / failed)
//
// It never creates a task in `tasks` (that only happens on manual approval in
// the "טלפונים ממתינים" screen). The YEMOT_API_TOKEN is never logged.

import { getServerSupabase } from "@/lib/supabaseServer";
import { parseYemotParams, sayAndHangup, t } from "@/lib/yemot";
import {
  yemotApiReady,
  fetchLatestRecording,
  recordDirPath,
  redact,
} from "@/lib/yemotApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// Insert the review row. Idempotent on call_external_id.
async function saveRecordingRow(supabase, { callId, phone, storagePath, status }) {
  const payload = {
    call_external_id: callId,
    caller_phone: phone || null,
    recording_url: storagePath || null, // storage object path (signed on read)
    transcription: null, // no STT in this flow — filled by hand in the review modal
    spoken_patient_name: null,
    patient_id: null,
    hours: null,
    task_definition: null,
    status,
  };
  const { error } = await supabase.from("phone_recordings").insert([payload]);
  if (error && error.code === "23505") return { ok: true, duplicate: true };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
    await saveRecordingRow(supabase, { callId, phone, storagePath: null, status: "failed" });
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("אירעה שגיאה תודה")));
  }

  // --- Pull the recording from Yemot and store it privately ---
  let storagePath = null;
  let status = "needs_patient";
  try {
    const { buffer, fileName } = await fetchLatestRecording(recordDirPath());
    storagePath = `phone/${safeName(callId)}_${safeName(fileName) || "rec"}.wav`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "audio/wav",
        upsert: true,
      });
    if (upErr) throw new Error(`storage upload: ${upErr.message}`);
    console.log(
      `[yemot-rec] pulled+stored call=${callId} file=${redact(fileName)} -> ${BUCKET}/${storagePath}`,
    );
  } catch (e) {
    status = "failed";
    storagePath = null;
    console.error(`[yemot-rec] pull failed call=${callId}: ${redact(e?.message || String(e))}`);
  }

  const res = await saveRecordingRow(supabase, { callId, phone, storagePath, status });
  if (!res.ok) {
    console.error(`[yemot-rec] db insert failed call=${callId}: ${res.error}`);
    return isHangup ? textResponse("") : textResponse(sayAndHangup(t("אירעה שגיאה תודה")));
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
