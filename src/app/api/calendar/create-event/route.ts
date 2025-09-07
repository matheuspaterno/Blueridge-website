import { NextResponse } from "next/server";
import { CreateEventSchema } from "@/lib/validations";
import { getOAuthClient } from "@/lib/tokens";
import { google } from "googleapis";
import { createMeetingRow } from "@/lib/supabase";
import { sendBookingEmail } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateEventSchema.parse(body);
  let client;
  try {
    client = await getOAuthClient(parsed.owner_id);
  } catch (err: any) {
    if (err?.message === "needs_reauth") return NextResponse.json({ error: "needs_reauth" }, { status: 401 });
    throw err;
  }
    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.insert({ calendarId: parsed.calendarId || "primary", requestBody: { summary: parsed.title, description: parsed.description, start: { dateTime: parsed.startISO }, end: { dateTime: parsed.endISO }, attendees: parsed.attendees }, sendUpdates: "all" });
    // console smoke test
    const ev = res.data as any;
    console.log("Created calendar event", ev.id, ev.htmlLink);
    const row = await createMeetingRow({ calendar_event_id: ev.id, start_ts: parsed.startISO, end_ts: parsed.endISO, title: parsed.title, notes: parsed.description });
    // Send confirmation email to the first attendee (if any)
    const attendeeEmail: string | undefined = Array.isArray(parsed.attendees) && parsed.attendees[0]?.email ? parsed.attendees[0].email : undefined;
    if (attendeeEmail) {
      try {
        await sendBookingEmail({ to: attendeeEmail, startISO: parsed.startISO, endISO: parsed.endISO, title: parsed.title });
      } catch (e) {
        console.warn("sendBookingEmail failed:", (e as any)?.message || e);
      }
    }
    return NextResponse.json({ ok: true, event: ev, meeting: row });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
