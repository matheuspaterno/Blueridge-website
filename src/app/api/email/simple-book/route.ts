import { NextResponse } from 'next/server';
import { sendBookingEmail, sendOwnerNotificationEmail } from '@/lib/email';

// Lightweight email-only booking/notification endpoint (no calendar integration)
// Body: { startISO?: string, durationMins?: number, name: string, email: string, phone?: string, notes?: string }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(()=>({}));
    const name: string | undefined = body.name;
    const email: string | undefined = body.email;
    const phone: string | undefined = body.phone;
    const notes: string | undefined = body.notes;
    const duration = Number(body.durationMins || 30);
    if (!name || !email) return NextResponse.json({ ok:false, error: 'name and email required' }, { status: 400 });
    // Use provided start or default to two hours from now (rounded to next hour) in ET.
    let start: Date;
    if (body.startISO) {
      start = new Date(body.startISO);
      if (Number.isNaN(start.getTime())) start = new Date();
    } else {
      const now = new Date();
      const twoH = new Date(now.getTime() + 2*60*60*1000);
      twoH.setMinutes(0,0,0);
      start = twoH;
    }
    const end = new Date(start.getTime() + duration*60*1000);
    const title = `Consultation with ${name}`;
    const descriptionLines = [
      'Source: Voice AI',
      `Client Name: ${name}`,
      `Client Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      notes ? `Notes: ${notes}` : ''
    ].filter(Boolean);
    let customerEmailSent = false;
    let ownerEmailSent = false;
    const errors: string[] = [];
    try {
      await sendBookingEmail({ to: email, startISO: start.toISOString(), endISO: end.toISOString(), title });
      customerEmailSent = true;
    } catch (e:any) {
      errors.push('customer:'+ (e?.message||String(e)));
    }
    try {
      await sendOwnerNotificationEmail({
        to: process.env.OWNER_NOTIFY_EMAIL || process.env.FROM_EMAIL || process.env.BOOKINGS_FROM_EMAIL || 'services@blueridge-ai.com',
        customerName: name,
        customerEmail: email,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        title,
        description: descriptionLines.join('\n')
      });
      ownerEmailSent = true;
    } catch (e:any) {
      errors.push('owner:'+ (e?.message||String(e)));
    }
    return NextResponse.json({ ok: true, customerEmailSent, ownerEmailSent, errors: errors.length? errors: undefined });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || String(e) }, { status: 500 });
  }
}
