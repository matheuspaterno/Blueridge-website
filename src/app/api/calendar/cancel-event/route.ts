import { NextResponse } from "next/server";
import { CancelEventSchema } from "@/lib/validations";
import { getOAuthClient } from "@/lib/tokens";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CancelEventSchema.parse(body);
  let client;
  try {
    client = await getOAuthClient(parsed.owner_id);
  } catch (err: any) {
    if (err?.message === "needs_reauth") return NextResponse.json({ error: "needs_reauth" }, { status: 401 });
    throw err;
  }
    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.delete({ calendarId: parsed.calendarId || "primary", eventId: parsed.eventId });
    // update meeting row if present
    if (parsed.eventId) {
      await supabaseAdmin.from("meetings").update({ title: null }).eq("calendar_event_id", parsed.eventId);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
