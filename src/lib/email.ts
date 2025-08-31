import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export type BookingEmail = {
  to: string;
  subject: string;
  html: string;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.");
  }
  transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
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

  const from = process.env.BOOKINGS_FROM_EMAIL || "services@blueridge-ai.com";
  const mail: BookingEmail = { to: opts.to, subject: `Confirmed: ${opts.title}`, html };
  await getTransporter().sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html });
}
