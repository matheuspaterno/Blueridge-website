import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export type BookingEmail = {
  to: string;
  subject: string;
  html: string;
};

type EmailMessage = BookingEmail & {
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    contentBase64: string;
    contentType?: string;
  }>;
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

function smtpAttachments(message: EmailMessage) {
  return message.attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.from(attachment.contentBase64, "base64"),
    contentType: attachment.contentType,
  }));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function calendarArtifacts(opts: { startISO: string; endISO: string; title: string; location?: string }) {
  const googleDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const location = opts.location || "Online";
  const details = "Your appointment with Blueridge AI Agency is confirmed.";
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${googleDate(opts.startISO)}/${googleDate(opts.endISO)}`,
    details,
    location,
  });
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Blueridge AI//Booking Confirmation//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@blueridge-ai.com`,
    `DTSTAMP:${googleDate(new Date().toISOString())}`,
    `DTSTART:${googleDate(opts.startISO)}`, `DTEND:${googleDate(opts.endISO)}`,
    `SUMMARY:${escapeIcs(opts.title)}`, `DESCRIPTION:${escapeIcs(details)}`,
    `LOCATION:${escapeIcs(location)}`, "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  return {
    googleCalendarUrl: `https://calendar.google.com/calendar/render?${query.toString()}`,
    attachment: {
      filename: "blueridge-appointment.ics",
      contentBase64: Buffer.from(ics, "utf8").toString("base64"),
      contentType: "text/calendar; charset=utf-8; method=PUBLISH",
    },
  };
}

async function sendWithResend(message: EmailMessage) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Resend is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      reply_to: message.replyTo || process.env.RESEND_REPLY_TO || undefined,
      attachments: message.attachments?.map((attachment) => ({ filename: attachment.filename, content: attachment.contentBase64 })),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.message || result?.error || response.statusText;
    throw new Error(`Resend ${response.status}: ${detail}`);
  }
  return { provider: "resend", messageId: result?.id };
}

async function sendEmail(message: EmailMessage) {
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  if (resendConfigured) {
    try {
      return await sendWithResend(message);
    } catch (resendError: any) {
      console.error("[email] Resend failed; attempting SMTP fallback:", resendError?.message || resendError);
      try {
        const smtpFrom = process.env.BOOKINGS_FROM_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_FROM || "services@blueridge-ai.com";
        const info = await getTransporter().sendMail({
          from: smtpFrom,
          to: message.to,
          subject: message.subject,
          html: message.html,
          replyTo: message.replyTo || process.env.RESEND_REPLY_TO || undefined,
          attachments: smtpAttachments(message),
        });
        return { provider: "smtp", messageId: info?.messageId };
      } catch (smtpError: any) {
        throw new Error(`Resend failed: ${resendError?.message || resendError}; SMTP fallback failed: ${smtpError?.message || smtpError}`);
      }
    }
  }

  const smtpFrom = process.env.BOOKINGS_FROM_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_FROM || "services@blueridge-ai.com";
  const info = await getTransporter().sendMail({
    from: smtpFrom,
    to: message.to,
    subject: message.subject,
    html: message.html,
    replyTo: message.replyTo || undefined,
    attachments: smtpAttachments(message),
  });
  return { provider: "smtp", messageId: info?.messageId };
}

export async function sendBookingEmail(opts: { to: string; startISO: string; endISO: string; title: string; location?: string }) {
  const tz = "America/New_York";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  const { googleCalendarUrl, attachment } = calendarArtifacts(opts);
  const safeTitle = escapeHtml(opts.title);
  const safeLocation = opts.location ? escapeHtml(opts.location) : undefined;
  const safeCalendarUrl = escapeHtml(googleCalendarUrl);
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
    <p>Hi there,</p>
    <p>Your appointment with Blueridge AI Agency is confirmed.</p>
    <ul>
      <li><strong>Topic:</strong> ${safeTitle}</li>
      <li><strong>When:</strong> ${fmt(opts.startISO)} – ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(opts.endISO))} (ET)</li>
      ${safeLocation ? `<li><strong>Location:</strong> ${safeLocation}</li>` : ""}
    </ul>
    <p><a href="${safeCalendarUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Add to Google Calendar</a></p>
    <p style="color:#555;font-size:14px">You can also use the attached calendar file with Apple Calendar, Outlook, or another calendar app.</p>
    <p>Need to reschedule? Reply to this email and we’ll help.</p>
    <p>— Blueridge AI Agency</p>
  </div>`;

  const mail: BookingEmail = { to: opts.to, subject: `Confirmed: ${opts.title}`, html };
  const info = await sendEmail({ ...mail, replyTo: process.env.RESEND_REPLY_TO, attachments: [attachment] });
  if ((process.env.SMTP_DEBUG || '').toLowerCase() === 'true') {
    // eslint-disable-next-line no-console
    console.log('[email] booking provider', info?.provider, 'messageId', info?.messageId);
  }
}

export async function sendOwnerNotificationEmail(opts: { to: string; customerName: string; customerEmail: string; startISO: string; endISO: string; title: string; description?: string }) {
  const tz = "America/New_York";
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  const subject = `New appointment request: ${opts.title}`;
  const safeCustomerName = escapeHtml(opts.customerName);
  const safeCustomerEmail = escapeHtml(opts.customerEmail);
  const safeTitle = escapeHtml(opts.title);
  const safeDescription = opts.description ? escapeHtml(opts.description) : undefined;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
    <p>You have a new appointment request captured by the chatbot.</p>
    <ul>
      <li><strong>Customer:</strong> ${safeCustomerName} (${safeCustomerEmail})</li>
      <li><strong>When:</strong> ${fmt(opts.startISO)} – ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(opts.endISO))} (ET)</li>
      <li><strong>Title:</strong> ${safeTitle}</li>
      ${safeDescription ? `<li><strong>Notes:</strong> ${safeDescription}</li>` : ""}
    </ul>
    <p>The appointment was added to the Blueridge booking calendar. Reply to the customer if coordination is needed.</p>
  </div>`;
  const info = await sendEmail({ to: opts.to, subject, html, replyTo: process.env.RESEND_REPLY_TO });
  if ((process.env.SMTP_DEBUG || '').toLowerCase() === 'true') {
    // eslint-disable-next-line no-console
    console.log('[email] owner notify provider', info?.provider, 'messageId', info?.messageId);
  }
}
