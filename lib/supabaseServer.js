// Server-side Supabase client for route handlers (NOT imported by client code).
//
// Used by the telephone (Yemot) IVR endpoint. RLS in this project is open for
// the anon role (see schema.sql), so the anon key is sufficient — we never use
// the service_role key. Keys come from environment variables only and are
// never sent to the browser (this module runs only on the server).

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseServerReady = Boolean(url && key);

export function getServerSupabase() {
  if (!supabaseServerReady) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
