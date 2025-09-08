import { NextResponse } from 'next/server';
import { isBusyRange, createEvent } from '@/lib/calendar/calendarService';
import { sendBookingEmail, sendOwnerNotificationEmail } from '@/lib/email';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const startStr: string = body.start;
    const durationMins: number = Number(body.durationMins || 30);
    if (!startStr) return NextResponse.json({ error: 'start required' }, { status: 400 });
    const start = new Date(startStr);
    if (Number.isNaN(start.getTime())) return NextResponse.json({ error: 'invalid start' }, { status: 400 });
    const end = new Date(start.getTime() + durationMins * 60_000);
    if (start < new Date()) return NextResponse.json({ error: 'start in past' }, { status: 400 });
    const busy = await isBusyRange({ start, end });
    if (busy) return NextResponse.json({ error: 'slot taken' }, { status: 409 });
    const name: string | undefined = body.name;
    const email: string | undefined = body.email;
    const notes: string | undefined = body.notes;
    const title = `Consultation with ${name || 'Client'}`;
    const description = [`Source: Brokersite/Widget`, email ? `Client Email: ${email}` : '', notes ? `Notes: ${notes}` : ''].filter(Boolean).join('\n');
    const { uid } = await createEvent({ start, end, title, description, attendees: email ? [{ name, email }] : undefined, location: 'Online' });

    // Optional emails
    if (process.env.SMTP_HOST && email) {
      try {
        await sendBookingEmail({ to: email, startISO: start.toISOString(), endISO: end.toISOString(), title });
      } catch (e) {
        console.warn('sendBookingEmail failed', (e as any)?.message || e);
      }
      try {
        await sendOwnerNotificationEmail({ to: process.env.FROM_EMAIL || process.env.BOOKINGS_FROM_EMAIL || email, customerName: name || email, customerEmail: email, startISO: start.toISOString(), endISO: end.toISOString(), title, description });
      } catch (e) {
        console.warn('sendOwnerNotificationEmail failed', (e as any)?.message || e);
      }
    }
    return NextResponse.json({ ok: true, uid });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/401|unauthorized|403/i.test(msg)) return NextResponse.json({ error: 'CalDAV auth failed' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}