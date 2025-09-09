import { NextResponse } from "next/server";
import { CreateEventSchema } from "@/lib/validations";
// Lazy-load Supabase inside handler to avoid hard failure if env not set
import { sendBookingEmail, sendOwnerNotificationEmail } from "@/lib/email";
// Google Calendar integration disabled; this route is email-only

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateEventSchema.parse(body);
    // Email-only flow: confirm to customer and notify owner; no calendar insertion.
    const attendeeEmail: string | undefined = Array.isArray(parsed.attendees) && parsed.attendees[0]?.email ? parsed.attendees[0].email : undefined;
    const attendeeName: string | undefined = Array.isArray(parsed.attendees) && parsed.attendees[0]?.name ? parsed.attendees[0].name : undefined;
    // Create a meeting record for tracking (no calendar_event_id) – optional
    let row: any = null;
    try {
      const supa = await import("@/lib/supabase");
      if (supa?.createMeetingRow) {
        row = await supa.createMeetingRow({ start_ts: parsed.startISO, end_ts: parsed.endISO, title: parsed.title, notes: parsed.description });
      }
    } catch (e) {
      console.warn("Skipping meeting persistence:", (e as any)?.message || e);
    }
    if (attendeeEmail) {
      try {
        await sendBookingEmail({ to: attendeeEmail, startISO: parsed.startISO, endISO: parsed.endISO, title: parsed.title });
      } catch (e) {
        console.warn("sendBookingEmail failed:", (e as any)?.message || e);
      }
      try {
        await sendOwnerNotificationEmail({
          to: process.env.OWNER_NOTIFICATIONS_TO || process.env.FROM_EMAIL || process.env.BOOKINGS_FROM_EMAIL || "services@blueridge-ai.com",
          customerName: attendeeName || attendeeEmail,
          customerEmail: attendeeEmail,
          startISO: parsed.startISO,
          endISO: parsed.endISO,
          title: parsed.title,
          description: parsed.description || undefined,
        });
      } catch (e) {
        console.warn("sendOwnerNotificationEmail failed:", (e as any)?.message || e);
      }
    }
  return NextResponse.json({ ok: true, meeting: row });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
