// Central Keep-Alive for all Supabase projects.
//
// Runs OUTSIDE Supabase via Vercel Cron (see vercel.json), twice a week.
// For each configured project it performs a single, read-only GET to the
// Supabase REST API root to keep the free project from being paused for
// inactivity. It never reads, writes, or touches any data, never uses the
// service_role key, and never logs or returns secrets.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_TIMEOUT_MS = 15_000;

// Keep only a short, non-sensitive summary of an error.
function sanitizeError(err) {
  if (!err) return "unknown error";
  if (err.name === "AbortError") return "timeout";
  const message = typeof err.message === "string" ? err.message : String(err);
  // Trim to avoid leaking long internal details / accidental payloads.
  return message.slice(0, 200);
}

function isValidHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Parse and validate SUPABASE_KEEPALIVE_PROJECTS. Throws an Error with a
// generic, non-sensitive message on any problem.
function loadProjects() {
  const raw = process.env.SUPABASE_KEEPALIVE_PROJECTS;
  if (!raw || raw.trim().length === 0) {
    throw new Error("SUPABASE_KEEPALIVE_PROJECTS is missing");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SUPABASE_KEEPALIVE_PROJECTS is not valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("SUPABASE_KEEPALIVE_PROJECTS must be a JSON array");
  }
  if (parsed.length === 0) {
    throw new Error("SUPABASE_KEEPALIVE_PROJECTS is empty");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Project at index ${index} is invalid`);
    }
    const { name, url, anonKey } = entry;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`Project at index ${index} is missing "name"`);
    }
    if (!isValidHttpUrl(url)) {
      throw new Error(`Project "${name}" has an invalid "url"`);
    }
    if (typeof anonKey !== "string" || anonKey.trim().length === 0) {
      throw new Error(`Project "${name}" is missing "anonKey"`);
    }
    return { name, url, anonKey };
  });
}

// Perform one read-only GET against {project.url}/rest/v1/.
async function checkProject(project) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROJECT_TIMEOUT_MS);
  const start = Date.now();

  try {
    const endpoint = new URL("/rest/v1/", project.url).toString();
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: project.anonKey,
        Authorization: `Bearer ${project.anonKey}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const durationMs = Date.now() - start;
    // Supabase REST root returns 200 for a valid anon key. Treat any 2xx/3xx
    // as reachable; 4xx/5xx counts as a failure for visibility.
    const success = res.status >= 200 && res.status < 400;

    const result = {
      name: project.name,
      success,
      status: res.status,
      durationMs,
    };
    if (!success) {
      result.error = `unexpected HTTP status ${res.status}`;
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      name: project.name,
      success: false,
      status: 0,
      durationMs,
      error: sanitizeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  // --- Auth: require a correct CRON_SECRET ---
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Misconfiguration: fail closed without leaking which part is missing.
    console.error("[supabase-keepalive] CRON_SECRET is not configured");
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  // --- Load configuration ---
  let projects;
  try {
    projects = loadProjects();
  } catch (err) {
    const message = sanitizeError(err);
    console.error(`[supabase-keepalive] configuration error: ${message}`);
    return Response.json({ success: false, error: message }, { status: 500 });
  }

  // --- Check every project; one failure must not stop the others ---
  const settled = await Promise.allSettled(projects.map((p) => checkProject(p)));

  const results = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    // checkProject is written not to throw, but guard anyway.
    return {
      name: projects[index]?.name ?? `project-${index}`,
      success: false,
      status: 0,
      durationMs: 0,
      error: sanitizeError(outcome.reason),
    };
  });

  // --- Log a safe, single-line summary per project (no secrets) ---
  for (const r of results) {
    console.log(
      `[supabase-keepalive] project="${r.name}" success=${r.success} status=${r.status} durationMs=${r.durationMs}${
        r.error ? ` error="${r.error}"` : ""
      }`,
    );
  }

  const allSucceeded = results.every((r) => r.success);

  return Response.json(
    {
      success: allSucceeded,
      checkedAt: new Date().toISOString(),
      projects: results,
    },
    { status: allSucceeded ? 200 : 207 },
  );
}
