// Server-side Hebrew transcription + field extraction via OpenAI.
//
// Used by the phone-recording pull flow (in the background, after the recording
// is already saved) to: (1) transcribe the .wav to Hebrew text, and (2) extract
// ONLY the three fields batal needs as structured JSON. The OPENAI_API_KEY is
// never logged or returned.

const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";

export function transcribeReady() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Pull only a general, non-sensitive error code from an OpenAI error response
// (e.g. "insufficient_quota", "invalid_request_error"). Never returns the key,
// transcript, or full body.
async function errorCode(res) {
  try {
    const j = await res.json();
    const code = j?.error?.code || j?.error?.type || "";
    return code ? ` ${code}` : "";
  } catch {
    return "";
  }
}

// (1) Transcribe an audio buffer to Hebrew text. Throws on failure.
export async function transcribeHebrew(buffer, fileName = "recording.wav") {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), fileName);
  form.append("model", model);
  form.append("language", "he");
  form.append("response_format", "json");

  const res = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  console.log(`[transcribe] openai response status=${res.status} op=transcription`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}${await errorCode(res)}`);
  }
  const json = await res.json().catch(() => null);
  return String(json?.text || "").trim();
}

// System prompt: batal needs ONLY patient name, hours, task definition.
const EXTRACT_SYS = `אתה מקבל תמלול בעברית של הקלטה טלפונית קצרה שבה נאמרים שם מטופלת משך זמן והגדרת משימה.
חלץ שלושה שדות בלבד והחזר JSON תקין:
- spoken_patient_name: שם המטופלת כפי שנאמר בלי תארים. אם לא נאמר שם החזר null.
- hours: משך בשעות כמספר עשרוני. שעה וחצי=1.5 חצי שעה=0.5 רבע שעה=0.25 תשעים דקות=1.5 שעתיים=2. אם לא נאמר החזר null.
- task_definition: תיאור המשימה במילות המתקשרת בלי שם המטופלת ובלי אזכור המשך. אם אין החזר null.
אל תמציא מידע. החזר אך ורק את שלושת השדות.`;

// (2) Extract the three fields from the transcript as structured JSON.
export async function extractTaskFields(transcript) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const model = process.env.OPENAI_EXTRACT_MODEL || "gpt-4o-mini";

  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: String(transcript || "") },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "phone_task_fields",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["spoken_patient_name", "hours", "task_definition"],
          properties: {
            spoken_patient_name: {
              type: ["string", "null"],
              description: "שם המטופלת שנאמר, בלי תארים",
            },
            hours: {
              type: ["number", "null"],
              description: "משך בשעות כמספר עשרוני",
            },
            task_definition: {
              type: ["string", "null"],
              description: "תיאור המשימה בלי השם ובלי המשך",
            },
          },
        },
      },
    },
  };

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`[transcribe] openai response status=${res.status} op=extract`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}${await errorCode(res)}`);
  }
  const j = await res.json();
  let parsed = {};
  try {
    parsed = JSON.parse(j?.choices?.[0]?.message?.content || "{}");
  } catch {
    parsed = {};
  }
  const hoursNum = Number(parsed.hours);
  return {
    spoken_patient_name: parsed.spoken_patient_name || null,
    hours: Number.isFinite(hoursNum) ? hoursNum : null,
    task_definition: parsed.task_definition || null,
  };
}
