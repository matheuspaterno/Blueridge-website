import { NextResponse } from "next/server";
import { realtimeBookingTools } from "@/lib/realtimeBookingTools";

function etDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * POST /api/realtime
 * Creates an ephemeral OpenAI Realtime session key by forwarding a request to
 * OpenAI's /v1/realtime/client_secrets endpoint. Never expose the primary OPENAI_API_KEY
 * to the client; the client will receive only the ephemeral session JSON.
 *
 * Environment variables:
 *  - OPENAI_API_KEY (server secret)
 *  - NEXT_PUBLIC_OPENAI_REALTIME_MODEL (optional, default: gpt-realtime-1.5)
 *  - NEXT_PUBLIC_OPENAI_VOICE (optional, default: verse)
 *
 * Request JSON body (all optional):
 *  {
 *    voice?: string;          // Override default voice token
 *    textOnly?: boolean;      // true disables audio input/output for typed simulation
 *    instructions?: string;   // System instructions for the session
 *  }
 */
export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Server misconfigured: OPENAI_API_KEY not set" }, { status: 500 });
  }

  const defaultModel = process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL || "gpt-realtime-1.5";
  const defaultVoice = process.env.NEXT_PUBLIC_OPENAI_VOICE || "verse";

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch (_) {
    // ignore – body stays empty
  }

  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : defaultVoice;
  const textOnly = body.textOnly === true;
  // If caller didn't provide custom instructions, build a voice-optimized Rick system prompt
  const instructions = (() => {
    const override = typeof body.instructions === "string" ? body.instructions.trim() : "";
    const base = override || process.env.RICK_BASE_PROMPT || `You are Rick, the Blueridge AI Agency assistant (voice mode).\n`;
    const currentEtDate = etDateString();
    const shared = `Tone: professional, concise, responsible, approachable. Keep spoken replies short (<= ~15s).\n` +
      `Never repeat your initial greeting after first turn. Mention "Blueridge AI Agency" once early if not yet mentioned.\n` +
      `CURRENT_DATE_ET=${currentEtDate}. All scheduling dates and times use America/New_York.\n` +
      `BOOKING TOOLS: For any scheduling request, resolve today, tomorrow, or a bare weekday against CURRENT_DATE_ET; a bare weekday means its next occurrence. ALWAYS call check_availability before stating or offering any time. Never invent availability. Restate the weekday and calendar date, then offer 2-3 concise choices using only timestamps returned by the tool. If the requested part of day is full, say so and offer returned same-day alternatives.\n` +
      `After the user chooses one returned time, collect their name and email (and phone if they want to provide it), then call book_appointment with that exact returned startISO. Never say an appointment is booked before the tool reports eventCreated=true. If it was booked but the confirmation email failed, clearly say the appointment is booked and the email could not be sent; do not book a duplicate.\n` +
      `Follow booking rules: interpret bare weekday as NEXT occurrence (America/New_York). If user says today/tomorrow resolve to ET date. Before proposing times, restate the weekday + calendar date. Offer 2–3 grouped time windows based only on availability tool results.\n` +
  `Collect name + spelled email + phone together when asked. Instruct the USER to spell the email letter-by-letter the FIRST time; do NOT you (the assistant) spell the email back unless the user explicitly asks you to repeat it. Never ask for a yes/no confirmation after user spelling—just proceed once you have it. If the user later provides a different email, briefly acknowledge the update and continue.\n` +
      `Out-of-scope topics (politics, sports, news, entertainment) -> briefly decline and redirect to services & booking.\n` +
      `If unable to resolve in 2 tries, politely say a teammate will follow up and stop.\n` +
      `Keep answers 1–3 concise sentences unless clarifying schedule details. Avoid filler words.\n` +
  `VOICE SPECIFIC: Do not autonomously spell emails or ask for confirmation; rely on user spelling. When confirming a chosen time, state it once clearly.\n` +
  `STRUCTURED EMAIL CAPTURE: As soon as you are at least 90% confident you have the user's email (from their spelled letters or spoken address), append a single line AFTER your spoken reply of the exact form: EMAIL_JSON:{"email":"their_email@example.com"}. Do NOT ask for confirmation, do NOT include extra fields, do NOT include backticks. Only output one EMAIL_JSON line per correction/update. If user gives a new email later, output another EMAIL_JSON line with the new value. Never hallucinate an email you are not confident about—if unsure, ask them to continue spelling instead. The spoken portion should remain concise and natural; the EMAIL_JSON line is for machine parsing and should not be read verbatim.\n`;
    return base + shared;
  })();

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: defaultModel,
          instructions,
          ...(textOnly
            ? { output_modalities: ["text"] }
            : { audio: { output: { voice } } }),
          tools: realtimeBookingTools,
          tool_choice: "auto",
        },
      }),
    });

    const text = await upstream.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!upstream.ok) {
      return NextResponse.json({ error: json?.error?.message || upstream.statusText || "Upstream realtime session error" }, { status: upstream.status });
    }

    // Return the ephemeral session object directly. It should contain `client_secret.value` or similar per OpenAI docs.
    return NextResponse.json({ ...json, model: json?.session?.model || defaultModel });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create realtime session" }, { status: 500 });
  }
}
