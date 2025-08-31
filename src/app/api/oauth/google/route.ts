import { NextResponse } from "next/server";
import { google } from "googleapis";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const owner = reqUrl.searchParams.get("owner_id") || env.DEFAULT_OWNER_ID || undefined;
  const oauth2Client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI);
  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];
  const state = owner ? JSON.stringify({ owner_id: owner }) : undefined;
  const url = oauth2Client.generateAuthUrl({ access_type: "offline", scope: scopes, prompt: "consent", state });
  return NextResponse.redirect(url);
}
