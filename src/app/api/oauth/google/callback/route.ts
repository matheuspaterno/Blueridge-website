import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/env";
import { saveOAuthTokensRow } from "@/lib/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  let owner = url.searchParams.get("owner_id") || env.DEFAULT_OWNER_ID || undefined;
  if (state) {
    try {
      const parsed = JSON.parse(state);
      if (parsed?.owner_id) owner = parsed.owner_id;
    } catch {}
  }
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });
  try {
    const oauth2Client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);
    await saveOAuthTokensRow({
      provider: "google",
      owner_id: owner || null,
      access_token: tokens.access_token || "",
      refresh_token: tokens.refresh_token || null,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scope: tokens.scope || null,
    });
    console.log("OAuth callback: tokens saved for owner", owner || env.DEFAULT_OWNER_ID);
    return NextResponse.redirect(`${env.APP_BASE_URL}/?oauth=success`);
  } catch (e: any) {
    console.error("OAuth callback error:", e?.message || e);
    const reason = encodeURIComponent(e?.message || "save_failed");
    return NextResponse.redirect(`${env.APP_BASE_URL}/?oauth=error&reason=${reason}`);
  }
}
