import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
  try {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secureEnv = (process.env.SMTP_SECURE || '').toLowerCase();
    const secure = secureEnv ? secureEnv === 'true' : port === 465;
    if (!host || !user || !pass) {
      return NextResponse.json({ ok: false, error: 'missing smtp env vars', host, user: !!user, pass: !!pass }, { status: 500 });
    }
    const start = Date.now();
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } , logger: true, debug: true});
    let verified = false;
    try {
      verified = await transporter.verify();
    } catch (e: any) {
      return NextResponse.json({ ok: false, stage: 'verify', error: e?.message || String(e) }, { status: 500 });
    }
    const elapsedMs = Date.now() - start;
    return NextResponse.json({ ok: true, verified, host, port, secure, elapsedMs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
