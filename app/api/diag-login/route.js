// TEMPORARY diagnostic route — validates YEMOT_API_TOKEN by calling Yemot's
// Login API from the Production runtime. Returns ONLY responseStatus + a general
// error code. Never returns or logs the token / system number / password.
//
// Protected by YEMOT_IVR_TOKEN (and a one-off DIAG_LOGIN_KEY, since the IVR
// token is "sensitive" and not readable outside production). This file is
// removed immediately after the one-time check.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function redact(s, ...secrets) {
  let out = String(s || "");
  for (const sec of secrets) if (sec) out = out.split(sec).join("***");
  return out.slice(0, 120);
}

export async function GET(request) {
  const provided = new URL(request.url).searchParams.get("key") || "";
  const allowed = [process.env.YEMOT_IVR_TOKEN, process.env.DIAG_LOGIN_KEY].filter(Boolean);
  if (!allowed.length || !provided || !allowed.includes(provided)) {
    return json({ error: "unauthorized" }, 401);
  }

  const tok = process.env.YEMOT_API_TOKEN || "";
  if (!tok) return json({ error: "YEMOT_API_TOKEN not set" }, 500);

  const i = tok.indexOf(":");
  if (i < 1) return json({ login: "token_format_invalid (no system:password)" });

  const username = tok.slice(0, i);
  const password = tok.slice(i + 1);

  try {
    const usp = new URLSearchParams({ username, password });
    const r = await fetch("https://www.call2all.co.il/ym/api/Login?" + usp.toString(), {
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    return json({
      http: r.status,
      responseStatus: j?.responseStatus ?? null,
      code: j?.code ?? j?.responseStatusType ?? null,
      message: redact(j?.message || j?.responseMessage || "", username, password),
      token_valid: j?.responseStatus === "OK",
    });
  } catch {
    return json({ error: "login_request_failed" });
  }
}
