import { NextResponse } from 'next/server';
import { sendBookingEmail, sendOwnerNotificationEmail } from '@/lib/email';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const to = url.searchParams.get('to') || process.env.TEST_EMAIL_TO || process.env.FROM_EMAIL || 'services@blueridge-ai.com';
    const name = url.searchParams.get('name') || 'Test User';
    const start = new Date(Date.now() + 90*60*1000); // 90 mins ahead
    start.setMinutes(0,0,0);
    const end = new Date(start.getTime() + 30*60*1000);
    const title = 'Test Email Flow';
    let customerEmailSent = false;
    let ownerEmailSent = false;
    let errors: string[] = [];
    try {
      await sendBookingEmail({ to, startISO: start.toISOString(), endISO: end.toISOString(), title });
      customerEmailSent = true;
    } catch (e:any) { errors.push('customer:'+(e?.message||e)); }
    try {
      await sendOwnerNotificationEmail({ to: process.env.OWNER_NOTIFY_EMAIL || to, customerName: name, customerEmail: to, startISO: start.toISOString(), endISO: end.toISOString(), title, description: 'Manual test trigger' });
      ownerEmailSent = true;
    } catch (e:any) { errors.push('owner:'+(e?.message||e)); }
    return NextResponse.json({ ok:true, customerEmailSent, ownerEmailSent, errors: errors.length? errors: undefined });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || String(e) }, { status: 500 });
  }
}