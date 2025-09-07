import { google } from "googleapis";
import { env } from "./env";
import { getOAuthTokensRow, saveOAuthTokensRow } from "./supabase";

export async function getOAuthClient(ownerId?: string) {
  const oAuth2Client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI);
  const stored = await getOAuthTokensRow("google", ownerId || env.DEFAULT_OWNER_ID || null);
  if (stored) {
    oAuth2Client.setCredentials({ access_token: stored.access_token, refresh_token: stored.refresh_token || undefined, expiry_date: stored.expiry ? new Date(stored.expiry).getTime() : undefined });
  }

  // If token is expired or near expiry, refresh
  const expiry = oAuth2Client.credentials.expiry_date;
  const now = Date.now();
  if (!oAuth2Client.credentials.access_token || (expiry && expiry - now < 60_000)) {
    try {
      // Prefer refreshAccessToken if available (legacy), else use refreshToken
      // @ts-ignore
      if (typeof oAuth2Client.refreshAccessToken === "function") {
        // legacy
        // @ts-ignore
        const r = await oAuth2Client.refreshAccessToken();
        const tokens = r.credentials || r.tokens || {};
        oAuth2Client.setCredentials(tokens);
        await saveOAuthTokensRow({ provider: "google", owner_id: ownerId || env.DEFAULT_OWNER_ID || null, access_token: tokens.access_token, refresh_token: tokens.refresh_token || null, expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, scope: tokens.scope || null });
      } else if (oAuth2Client.credentials.refresh_token) {
        const r = await oAuth2Client.refreshToken(oAuth2Client.credentials.refresh_token as string);
        const tokens = r.credentials || r.tokens || {};
        oAuth2Client.setCredentials(tokens);
        await saveOAuthTokensRow({ provider: "google", owner_id: ownerId || env.DEFAULT_OWNER_ID || null, access_token: tokens.access_token, refresh_token: tokens.refresh_token || null, expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, scope: tokens.scope || null });
      }
    } catch (err: any) {
      // If Google reports the refresh token is invalid or revoked, surface a special error
      // so callers can ask the user to re-authorize.
      console.warn("token refresh failed", err);
      const errMsg = err?.response?.data?.error || err?.message || String(err);
      if (typeof errMsg === "string" && errMsg.includes("invalid_grant")) {
        // caller should handle this and trigger re-auth flow
        throw new Error("needs_reauth");
      }
      // leave client as-is for non-refresh failures
    }
  }
  return oAuth2Client;
}

// keep old name for backward compatibility
export { getOAuthClient as ensureFreshOAuthClient };
