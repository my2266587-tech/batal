// Client for the Yemot Hamashiach *management* API (call2all), used server-side
// only to PULL a finished recording out of the IVR system after a `type=record`
// extension saved it. This is separate from the IVR call-flow protocol in
// `lib/yemot.js`.
//
// Auth: a single token of the form "<system>:<password>" supplied via the
// YEMOT_API_TOKEN env var. The token is NEVER logged or returned to the client.
//
// Docs: https://f2.freeivr.co.il/topic/55  (GetIVR2Dir, DownloadFile)

const API_BASE = "https://www.call2all.co.il/ym/api/";

function apiToken() {
  return process.env.YEMOT_API_TOKEN || "";
}

export function yemotApiReady() {
  return Boolean(apiToken());
}

// The folder where the `/1` record extension stores its recordings.
// Overridable via env; defaults to ivr2:/1 (the record extension itself).
export function recordDirPath() {
  return process.env.YEMOT_RECORD_PATH || "ivr2:/1";
}

// The bare extension path (no "ivr2:" prefix, no surrounding slashes), e.g. "1".
function recordExt() {
  const ext = recordDirPath()
    .replace(/^ivr2:/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return ext || "1";
}

// GetIVR2Dir path variants to try, in order. Yemot is inconsistent about the
// "ivr2:" prefix / leading slash, and the wrong form returns EXCEPTION — so we
// probe these and stop at the first that responds OK.
function dirVariants() {
  const ext = recordExt();
  return [`ivr2:${ext}`, `ivr2:/${ext}`, `/${ext}`, `${ext}`];
}

// Build a URL with the token kept out of anything we might log.
function apiUrl(command, params = {}) {
  const usp = new URLSearchParams({ token: apiToken(), ...params });
  return `${API_BASE}${command}?${usp.toString()}`;
}

// Redact the token from any string before it can reach a log line.
export function redact(s) {
  const tok = apiToken();
  let out = String(s == null ? "" : s);
  if (tok) out = out.split(tok).join("***");
  // also scrub a token=... query param defensively
  return out.replace(/token=[^&\s]+/gi, "token=***");
}

// List a directory. Returns the parsed JSON (responseStatus + files[]).
export async function getDir(path = recordDirPath()) {
  const res = await fetch(apiUrl("GetIVR2Dir", { path }), { cache: "no-store" });
  if (!res.ok) throw new Error(`GetIVR2Dir HTTP ${res.status}`);
  return res.json();
}

// From a GetIVR2Dir response, pick the most recent audio recording file name.
// Yemot record files are numbered (000, 001, ...) and/or carry a modified time;
// we prefer the newest by time, falling back to the highest numeric name.
export function pickLatestRecording(dir) {
  const files = (dir && (dir.files || dir.data || dir.list)) || [];
  if (!Array.isArray(files)) return null;

  const candidates = files
    .map((f) => (typeof f === "string" ? { name: f } : f || {}))
    .filter((f) => {
      const name = String(f.name || f.fileName || "");
      if (!name) return false;
      const isFolder =
        f.what === "folder" ||
        f.type === "folder" ||
        f.isFolder === true ||
        /folder/i.test(String(f.what || f.type || ""));
      if (isFolder) return false;
      // audio recording: .wav, or a bare numeric name (Yemot default naming)
      return /\.wav$/i.test(name) || /^\d+(\.\w+)?$/.test(name);
    });

  if (!candidates.length) return null;

  const timeOf = (f) =>
    Number(f.mtime || f.time || f.fileLastModified || f.lastModified || 0) || 0;
  const numOf = (f) => {
    const m = String(f.name || f.fileName).match(/(\d+)/);
    return m ? Number(m[1]) : -1;
  };

  candidates.sort((a, b) => {
    const t = timeOf(b) - timeOf(a);
    if (t !== 0) return t;
    return numOf(b) - numOf(a);
  });

  const top = candidates[0];
  return String(top.name || top.fileName);
}

// Download a single file by full ivr2 path. Returns a Buffer of the audio.
// On error Yemot replies with JSON instead of the file — we surface that.
export async function downloadFile(fullPath) {
  const res = await fetch(apiUrl("DownloadFile", { path: fullPath }), {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DownloadFile HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json().catch(() => null);
    throw new Error(`DownloadFile failed: ${j?.responseStatus || "unknown"}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("DownloadFile returned empty body");
  return buf;
}

// Try the GetIVR2Dir path variants in order; return the first JSON whose
// responseStatus is OK (else null). Logs ONLY variant/status/file-count — never
// the token. At most 4 attempts.
async function findRecordingDir() {
  const summary = [];
  for (const variant of dirVariants()) {
    let json = null;
    let status = "request_error";
    let count = 0;
    try {
      json = await getDir(variant);
      status = json?.responseStatus || "UNKNOWN";
      const files = (json && (json.files || json.data || json.list)) || [];
      count = Array.isArray(files) ? files.length : 0;
    } catch {
      // network/parse error — keep status generic, no message (avoids any leak)
    }
    console.log(`[yemot-rec] GetIVR2Dir variant=${variant} status=${status} files=${count}`);
    summary.push(`${variant}=${status}`);
    if (status === "OK") return { json, summary };
  }
  return { json: null, summary };
}

// Convenience: locate + download the latest recording in the record folder.
// Returns { buffer, fileName, path } or throws.
export async function fetchLatestRecording() {
  const { json, summary } = await findRecordingDir();
  if (!json) {
    // Fold per-variant statuses into the (captured) error so the cause is
    // visible even when info-level logs are dropped. Only variant=status — no token.
    throw new Error(`GetIVR2Dir all variants failed [${summary.join(" ")}]`);
  }
  const fileName = pickLatestRecording(json);
  if (!fileName) throw new Error("no recording file found in folder");
  // DownloadFile uses the documented ivr2: file-path form.
  const fullPath = `ivr2:/${recordExt()}/${fileName}`;
  const buffer = await downloadFile(fullPath);
  return { buffer, fileName, path: fullPath };
}
