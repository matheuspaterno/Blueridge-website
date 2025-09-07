import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env variables");
}

export const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function saveOAuthTokensRow(p: { provider: string; owner_id?: string | null; access_token: string; refresh_token?: string | null; expiry?: string | null; scope?: string | null }) {
  // Use upsert so we don't create duplicate rows for the same provider + owner_id.
  // This ensures the most recent refresh_token/access_token overwrite previous values.
  const { data, error } = await supabaseAdmin
    .from("oauth_tokens")
    .upsert({ provider: p.provider, owner_id: p.owner_id || null, access_token: p.access_token, refresh_token: p.refresh_token || null, expiry: p.expiry || null, scope: p.scope || null }, { onConflict: ["provider", "owner_id"] })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getOAuthTokensRow(provider: string, ownerId?: string | null) {
  const owner = ownerId || env.DEFAULT_OWNER_ID || null;
  const { data, error } = await supabaseAdmin.from("oauth_tokens").select("*").eq("provider", provider).eq("owner_id", owner).limit(1).single();
  if (error) return null;
  return data;
}

export async function createMeetingRow(p: { calendar_event_id?: string; contact_id?: string; start_ts?: string; end_ts?: string; title?: string; notes?: string }) {
  const { data, error } = await supabaseAdmin.from("meetings").insert(p).select().single();
  if (error) throw error;
  return data;
}
