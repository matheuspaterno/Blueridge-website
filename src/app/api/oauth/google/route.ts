import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const owner = env.DEFAULT_OWNER_ID || undefined;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    return NextResponse.json({ error: "Google OAuth is not configured" }, { status: 503 });
  }
  const setupToken = reqUrl.searchParams.get("token");
  if (!env.GOOGLE_OAUTH_SETUP_TOKEN || setupToken !== env.GOOGLE_OAUTH_SETUP_TOKEN) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const oauth2Client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI);
  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ nonce, owner_id: owner })).toString("base64url");
  const url = oauth2Client.generateAuthUrl({ access_type: "offline", scope: scopes, prompt: "consent", state });
  const response = NextResponse.redirect(url);
  response.cookies.set("google_oauth_nonce", nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}
