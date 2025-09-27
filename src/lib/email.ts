import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export type BookingEmail = {
  to: string;
  subject: string;
  html: string;
};

let transporter: nodemailer.Transporter | null = null;

function sanitizeHost(raw: string): string {
  // Some earlier .env content incorrectly combined multiple vars on one line.
  // If we detect commas/spaces, take the first token that looks like a hostname.
  const first = raw.split(/[ ,]/).filter(Boolean)[0];
  return first || raw.trim();
}

function getTransporter() {
  if (transporter) return transporter;
  const rawHost = process.env.SMTP_HOST;
  const host = rawHost ? sanitizeHost(rawHost) : undefined;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secureEnv = (process.env.SMTP_SECURE || "").toLowerCase();
  const secure = secureEnv ? secureEnv === "true" : port === 465; // explicit override else infer
  const debug = (process.env.SMTP_DEBUG || "").toLowerCase() === "true";
  if (!host || !user || !pass) {
    // Provide a dev-mode fallback so flows can be tested without real SMTP.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[email] SMTP not fully configured (missing host/user/pass). Using nodemailer jsonTransport fallback (dev only).');
      transporter = nodemailer.createTransport({ jsonTransport: true });
      return transporter;
    }
    throw new Error("SMTP not configured. Ensure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS are set (no dev fallback in production).");
  }
  if (rawHost && rawHost !== host && /,|\s/.test(rawHost)) {
    console.warn(`[email] Sanitized SMTP_HOST from '${rawHost}' to '${host}'. Please fix your .env to avoid combined variable lines.`);
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(debug ? { logger: true, debug: true } : {}),
  });
  return transporter;
}

export async function sendBookingEmail(opts: { to: string; startISO: string; endISO: string; title: string; location?: string }) {
  const tz = "America/New_York";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
    <p>Hi there,</p>
    <p>Your appointment with Blueridge AI Agency is confirmed.</p>
    <ul>
      <li><strong>Topic:</strong> ${opts.title}</li>
      <li><strong>When:</strong> ${fmt(opts.startISO)} – ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(opts.endISO))} (ET)</li>
      ${opts.location ? `<li><strong>Location:</strong> ${opts.location}</li>` : ""}
    </ul>
    <p>Need to reschedule? Reply to this email and we’ll help.</p>
    <p>— Blueridge AI Agency</p>
  </div>`;

  const from = process.env.BOOKINGS_FROM_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_FROM || "services@blueridge-ai.com";
  const mail: BookingEmail = { to: opts.to, subject: `Confirmed: ${opts.title}`, html };
  const info = await getTransporter().sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html });
  if ((process.env.SMTP_DEBUG || '').toLowerCase() === 'true') {
    // eslint-disable-next-line no-console
    console.log('[email] booking messageId', info?.messageId, 'accepted', info?.accepted, 'rejected', info?.rejected);
  }
}

export async function sendOwnerNotificationEmail(opts: { to: string; customerName: string; customerEmail: string; startISO: string; endISO: string; title: string; description?: string }) {
  const tz = "America/New_York";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  const from = process.env.BOOKINGS_FROM_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_FROM || "services@blueridge-ai.com";
  const subject = `New appointment request: ${opts.title}`;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
    <p>You have a new appointment request captured by the chatbot.</p>
    <ul>
      <li><strong>Customer:</strong> ${opts.customerName} (${opts.customerEmail})</li>
      <li><strong>When:</strong> ${fmt(opts.startISO)} – ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(opts.endISO))} (ET)</li>
      <li><strong>Title:</strong> ${opts.title}</li>
      ${opts.description ? `<li><strong>Notes:</strong> ${opts.description}</li>` : ""}
    </ul>
    <p>Action: Manually add to your service@blueridge-ai.com calendar or reply to the customer to coordinate.</p>
  </div>`;
  const info = await getTransporter().sendMail({ from, to: opts.to, subject, html });
  if ((process.env.SMTP_DEBUG || '').toLowerCase() === 'true') {
    // eslint-disable-next-line no-console
    console.log('[email] owner notify messageId', info?.messageId, 'accepted', info?.accepted, 'rejected', info?.rejected);
  }
}
