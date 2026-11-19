import { supabase } from "@/lib/supabaseClient";

const BUCKET = "documents";

// Supabase Storage rejects object keys with non-ASCII characters
// ("Invalid key"), so Hebrew file names can't go into the path. Keep only
// ASCII letters/digits from the name plus the extension; callers add a
// timestamp to keep keys unique.
export function storageSafeName(name) {
  const str = String(name || "");
  const dot = str.lastIndexOf(".");
  const base = dot > 0 ? str.slice(0, dot) : str;
  const ext = dot > 0 ? str.slice(dot + 1) : "";
  const safeBase = base
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const safeExt = ext.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 10).toLowerCase();
  return (safeBase || "file") + (safeExt ? "." + safeExt : "");
}

export function describeError(err, label) {
  if (!err) return "";
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.error) parts.push(err.error);
  if (err.statusCode) parts.push(`status ${err.statusCode}`);
  if (err.code) parts.push(`code ${err.code}`);
  if (err.details) parts.push(err.details);
  if (err.hint) parts.push(`hint: ${err.hint}`);
  const text = parts.length ? parts.join(" — ") : JSON.stringify(err);
  return `${label}: ${text}`;
}

// Uploads several files for one patient. Each file gets its own Storage
// object and its own patient_documents row (sharing doc_type / notes).
// A failure on one file doesn't stop the rest; failed files are returned so
// the caller can let the user retry just those.
//
// Returns { fatal } when the session/authorization check fails (nothing was
// uploaded), otherwise { uploaded, failures: [{ file, message }] }.
export async function uploadPatientDocuments({
  patientId,
  files,
  docType,
  notes,
  onProgress,
}) {
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessionData?.session) {
    return {
      fatal: "אין סשן פעיל. " + describeError(sessErr, "שגיאה"),
    };
  }
  const userEmail = sessionData.session.user?.email;

  const { data: isAuth, error: authErr } = await supabase.rpc("is_authorized");
  if (authErr) {
    return {
      fatal:
        "הקריאה ל-is_authorized נכשלה. " + describeError(authErr, "שגיאה"),
    };
  }
  if (!isAuth) {
    return {
      fatal: `המשתמש ${userEmail} אינו מורשה (is_authorized=false). ודאי שהוא ברשימה authorized_users עם is_active=true.`,
    };
  }

  let uploaded = 0;
  const failures = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file);

    const path = `patient-docs/${patientId}/${Date.now()}_${i}_${storageSafeName(file.name)}`;
    const { data: up, error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false });
    if (upErr) {
      console.error("[upload] storage error:", file.name, upErr);
      failures.push({
        file,
        message: describeError(upErr, "שגיאה מ-Supabase Storage"),
      });
      continue;
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(up.path);
    const { error: insErr } = await supabase.from("patient_documents").insert([
      {
        patient_id: patientId,
        doc_type: docType || null,
        // The Hebrew file name no longer survives in the storage path, so
        // when no note was typed keep the original name to tell files apart.
        notes: notes || file.name || null,
        file_url: pub?.publicUrl,
      },
    ]);
    if (insErr) {
      console.error("[upload] db insert error:", file.name, insErr);
      // Don't leave an orphaned object in Storage with no row pointing at it.
      await supabase.storage.from(BUCKET).remove([up.path]);
      failures.push({ file, message: describeError(insErr, "שגיאה מ-DB") });
      continue;
    }
    uploaded++;
  }

  return { uploaded, failures };
}
