import { NextResponse } from 'next/server';
import { isBusyRange, createEvent } from '@/lib/calendar/calendarService';
import { sendBookingEmail, sendOwnerNotificationEmail } from '@/lib/email';

// If STRICT_BOOKING=true we fail hard on calendar or email errors; otherwise we degrade gracefully.
const STRICT = (process.env.STRICT_BOOKING || '').toLowerCase() === 'true';
const DEBUG = (process.env.DEBUG_BOOKING || '').toLowerCase() === 'true';

export async function POST(req: Request) {
  try {
    const body = await req.json();
  if (DEBUG) console.log('[booking] incoming payload', JSON.stringify(body));
    const startStr: string = body.start;
    const durationMins: number = Number(body.durationMins || 30);
    if (!startStr) return NextResponse.json({ error: 'start required' }, { status: 400 });
    const start = new Date(startStr);
    if (Number.isNaN(start.getTime())) return NextResponse.json({ error: 'invalid start' }, { status: 400 });
    const end = new Date(start.getTime() + durationMins * 60_000);
    if (start < new Date()) return NextResponse.json({ error: 'start in past' }, { status: 400 });
    let busy = false;
    try {
      busy = await isBusyRange({ start, end });
    } catch (calErr: any) {
      const msg = calErr?.message || String(calErr);
      if (DEBUG) console.warn('[booking] isBusyRange failed', msg);
      // Do not hard fail unless STRICT; treat as free to allow degraded booking
      if (STRICT) return NextResponse.json({ error: 'calendar availability check failed: ' + msg }, { status: 500 });
    }
    if (busy) return NextResponse.json({ error: 'slot taken' }, { status: 409 });
    const name: string | undefined = body.name;
    const email: string | undefined = body.email;
    const notes: string | undefined = body.notes;
    const title = `Consultation with ${name || 'Client'}`;
    const description = [`Source: Brokersite/Widget`, email ? `Client Email: ${email}` : '', notes ? `Notes: ${notes}` : ''].filter(Boolean).join('\n');
    let uid: string | null = null;
    let eventCreated = false;
    let calendarError: string | null = null;
    try {
      const created = await createEvent({ start, end, title, description, attendees: email ? [{ name, email }] : undefined, location: 'Online' });
      uid = created.uid;
      eventCreated = true;
      if (DEBUG) console.log('[booking] calendar event created', uid);
    } catch (ce: any) {
      calendarError = ce?.message || String(ce);
      if (DEBUG) console.warn('[booking] calendar create failed', calendarError);
      if (STRICT) return NextResponse.json({ error: calendarError || 'calendar create failed' }, { status: 500 });
    }

    let customerEmailSent = false;
    let ownerEmailSent = false;
    let emailErrors: string[] = [];
    if (process.env.SMTP_HOST && email) {
      try {
  await sendBookingEmail({ to: email, startISO: start.toISOString(), endISO: end.toISOString(), title });
  if (DEBUG) console.log('[booking] customer email queued');
        customerEmailSent = true;
      } catch (e: any) {
        const msg = e?.message || String(e);
        emailErrors.push('customer:' + msg);
        if (DEBUG) console.warn('sendBookingEmail failed', msg);
        if (STRICT) return NextResponse.json({ error: 'email send failed: ' + msg }, { status: 500 });
      }
      try {
  await sendOwnerNotificationEmail({ to: process.env.FROM_EMAIL || process.env.BOOKINGS_FROM_EMAIL || email, customerName: name || email, customerEmail: email, startISO: start.toISOString(), endISO: end.toISOString(), title, description });
  if (DEBUG) console.log('[booking] owner email queued');
        ownerEmailSent = true;
      } catch (e: any) {
        const msg = e?.message || String(e);
        emailErrors.push('owner:' + msg);
        if (DEBUG) console.warn('sendOwnerNotificationEmail failed', msg);
        if (STRICT) return NextResponse.json({ error: 'owner email failed: ' + msg }, { status: 500 });
      }
      // Always send a copy to OWNER_NOTIFY_EMAIL (or default Proton address)
      const notifyTo = process.env.OWNER_NOTIFY_EMAIL || 'matheuspaterno@proton.me';
      if (notifyTo) {
        try {
          await sendOwnerNotificationEmail({ to: notifyTo, customerName: name || (email || 'Client'), customerEmail: email || 'n/a', startISO: start.toISOString(), endISO: end.toISOString(), title, description });
          if (DEBUG) console.log('[booking] owner notify email queued to', notifyTo);
        } catch (e: any) {
          const msg = e?.message || String(e);
          emailErrors.push('ownerNotify:' + msg);
          if (DEBUG) console.warn('[booking] owner notify failed', msg);
          if (STRICT) return NextResponse.json({ error: 'owner notify failed: ' + msg }, { status: 500 });
        }
      }
    }
  const responsePayload = { ok: true, uid, eventCreated, customerEmailSent, ownerEmailSent, calendarError, emailErrors: emailErrors.length ? emailErrors : undefined };
  if (DEBUG) console.log('[booking] response', responsePayload);
  return NextResponse.json(responsePayload);
  } catch (e: any) {
    const msg = e?.message || String(e);
  if (DEBUG) console.error('[booking] fatal error', msg);
    if (/401|unauthorized|403/i.test(msg)) return NextResponse.json({ error: 'CalDAV auth failed' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}