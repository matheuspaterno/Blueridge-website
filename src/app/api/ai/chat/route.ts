import { NextResponse } from "next/server";
import { openai, BOT_SYSTEM_PROMPT } from "@/lib/openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; tool_call_id?: string };

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getAvailability",
      description: "Get free appointment start times (CalDAV) between two ISO timestamps with a given duration (minutes).",
      parameters: {
        type: "object",
        properties: {
          timeMinISO: { type: "string", description: "ISO 8601 start time (inclusive)" },
          timeMaxISO: { type: "string", description: "ISO 8601 end time (exclusive)" },
          durationMins: { type: "integer", description: "Meeting length in minutes (default 30)" },
        },
        required: ["timeMinISO", "timeMaxISO"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createAppointment",
      description: "Create a CalDAV event and send confirmation emails.",
      parameters: {
        type: "object",
        properties: {
          startISO: { type: "string" },
          endISO: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          attendees: {
            type: "array",
            items: {
              type: "object",
              properties: { email: { type: "string" }, name: { type: "string" } },
              required: ["email"],
            },
          },
        },
        required: ["startISO", "endISO", "title"],
      },
    },
  },
  {
  type: "function",
    function: {
      name: "cancelAppointment",
      description: "Cancel a calendar event by ID.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string" },
          calendarId: { type: "string" },
          reason: { type: "string" },
          owner_id: { type: "string" },
        },
        required: ["eventId"],
      },
    },
  },
  {
  type: "function",
    function: {
      name: "flagNeedsHuman",
      description: "Flag the conversation for a human to follow up.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "showContactForm",
      description: "Ask the UI to render a contact form (name, email, phone) for the user to fill in a single step.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the form is needed (optional)" },
        },
      },
    },
  },
];

async function callInternalApi(path: string, payload: any) {
  const base = process.env.APP_BASE_URL || "http://localhost:5173";
  const url = new URL(path, base).toString();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) return { ok: false, error: json?.error || res.statusText };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: text || res.statusText };
  }
}

async function fetchAvailabilityGET(args: { timeMinISO: string; timeMaxISO: string; durationMins: number }) {
  const base = process.env.APP_BASE_URL || "http://localhost:5173";
  const u = new URL("/api/availability", base);
  u.searchParams.set("from", args.timeMinISO);
  u.searchParams.set("to", args.timeMaxISO);
  if (args.durationMins) u.searchParams.set("durationMins", String(args.durationMins));
  try {
    const r = await fetch(u.toString(), { method: "GET" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error || r.statusText };
    const starts: string[] = Array.isArray(j.slots) ? j.slots : [];
    return {
      ok: true,
      data: {
        slots: starts.map((s) => ({ start: s, end: new Date(new Date(s).getTime() + (args.durationMins || 30) * 60_000).toISOString() })),
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("your-")) {
      return NextResponse.json(
        { error: "Server not configured: set OPENAI_API_KEY in .env.local" },
        { status: 503 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const baseMsgs: Msg[] = Array.isArray(body.messages)
      ? body.messages.map((m: any) => ({ role: m.role, content: String(m.content || "") }))
      : [{ role: "user", content: String(body.message || "Hello") }];
    const ownerId = body.owner_id || process.env.DEFAULT_OWNER_ID || undefined;

    // Capture contact details if provided out-of-band by the UI
  const contact: { name?: string; email?: string; phone?: string } | undefined = body.contact && typeof body.contact === 'object'
      ? { name: body.contact.name, email: body.contact.email, phone: body.contact.phone }
      : undefined;
  const clientLastSlots: Array<{ start: string; end: string }> | undefined = Array.isArray(body.lastSlots) ? body.lastSlots : undefined;
  const clientSelectedStartISO: string | undefined = typeof body.selectedStartISO === 'string' ? body.selectedStartISO : undefined;

  const chatMessages: Msg[] = [{ role: "system", content: BOT_SYSTEM_PROMPT }, ...baseMsgs];
  const modelOnly = (process.env.AI_MODEL_ONLY || "").toLowerCase() === "true";

    // Provide the model with the actual current date in America/New_York to prevent date hallucinations
    const tz = "America/New_York";
    const now = new Date();
    const nowParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
    chatMessages.unshift({
      role: "system",
      content: `Current date (America/New_York): ${nowParts}. ${modelOnly ? "" : "Never guess dates—only state dates after checking availability via tools. If the user says a weekday without a date, interpret it as the next occurrence of that weekday (America/New_York)."}`.trim(),
    });

    // Lightweight weekday detection and next-week calculation for guidance
  const lastUserMsg = [...baseMsgs].reverse().find((m) => m.role === "user")?.content?.toLowerCase() || "";
    function detectSegment(text: string): "morning" | "afternoon" | "evening" | null {
      if (!text) return null;
      // If the user gave an explicit time (e.g., "12PM", "1:30 pm"), treat it as a selection, not a segment preference.
      if (/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(text)) return null;
      // Only infer segment from explicit words, not generic AM/PM tokens.
      if (/(\bmorning\b|before\s*noon|early\s*(day|morning)?)/i.test(text)) return "morning";
      if (/(\bafternoon\b|after\s*noon|mid\s*day|midday)/i.test(text)) return "afternoon";
      if (/(\bevening\b|after\s*work|late\s*(day|evening)?|\bnight\b)/i.test(text)) return "evening";
      return null;
    }
    const preferredSegment = detectSegment(lastUserMsg);
    const weekdayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const mentionedDay = Object.keys(weekdayMap).find((d) => new RegExp(`\\b${d}\\b`, "i").test(lastUserMsg));
  const isToday = /\btoday\b/i.test(lastUserMsg);
  const isTomorrow = /\btomorrow\b/i.test(lastUserMsg);
    function getEtDateParts(d: Date) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(d);
      const g: any = {};
      for (const p of parts) g[p.type] = p.value;
      return { y: Number(g.year), m: Number(g.month), d: Number(g.day), wd: String(g.weekday) };
    }
    function addDaysUtc(dateUtc: Date, days: number) {
      const du = new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate()));
      du.setUTCDate(du.getUTCDate() + days);
      return du;
    }
    // Construct a UTC date from ET calendar date (at 00:00 ET approximated via UTC date)
    function utcFromEtCalendarDate(y: number, m: number, d: number) {
      // Use UTC midnight of the same calendar date; for guidance text only
      return new Date(Date.UTC(y, m - 1, d));
    }
    let nextWeekdayText: string | null = null;
  if (!modelOnly && (isToday || isTomorrow)) {
      const base = isTomorrow ? addDaysUtc(utcFromEtCalendarDate(getEtDateParts(now).y, getEtDateParts(now).m, getEtDateParts(now).d), 1) : utcFromEtCalendarDate(getEtDateParts(now).y, getEtDateParts(now).m, getEtDateParts(now).d);
      const targetPretty = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(base);
      nextWeekdayText = targetPretty;
      chatMessages.unshift({ role: "system", content: `Guidance: The user said ${isTomorrow ? "tomorrow" : "today"}. Treat it as ${targetPretty} (America/New_York). Always call getAvailability for that date before proposing slots.` });
  } else if (!modelOnly && mentionedDay) {
      const targetDow = weekdayMap[mentionedDay];
      const et = getEtDateParts(now);
      // Compute the next occurrence (not skipping a full week)
      const currentDow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(et.wd);
      let daysUntil = (targetDow - currentDow + 7) % 7;
      if (daysUntil === 0) daysUntil = 7; // if same weekday, pick the following week
      const etBaseUtc = utcFromEtCalendarDate(et.y, et.m, et.d);
      const targetUtc = addDaysUtc(etBaseUtc, daysUntil);
      const targetPretty = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(targetUtc);
      nextWeekdayText = targetPretty;
      chatMessages.unshift({
        role: "system",
        content: `Guidance: The user mentioned ${mentionedDay}. Treat it as the next occurrence: ${targetPretty}. Always call getAvailability for that date before proposing slots, and only propose slots returned by the tool. ${preferredSegment ? `The user prefers ${preferredSegment}; try that first.` : ""}`,
      });
    }
    if (contact?.email || contact?.name || contact?.phone) {
      // Add a concise system note so the model knows contact info is already collected
      const parts = [
        contact.name ? `name=${contact.name}` : null,
        contact.email ? `email=${contact.email}` : null,
        contact.phone ? `phone=${contact.phone}` : null,
      ].filter(Boolean).join(", ");
      chatMessages.push({
        role: "system",
        content: `Contact details have been collected: ${parts}. Use these for email confirmation and do not ask for them again.`,
      });
    }

    // If the client already selected a slot and provided contact, we can create the event directly
  if (clientSelectedStartISO && contact?.email) {
      const startISO = clientSelectedStartISO;
      const endISO = new Date(new Date(startISO).getTime() + 30 * 60_000).toISOString();
      const title = "Blueridge Consultation";
  const description = `Requested via chat for ${contact.name || contact.email}.`;
      const create = await (async () => {
        try {
          const res = await fetch((process.env.APP_BASE_URL || "http://localhost:5173") + "/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: startISO, durationMins: 30, name: contact.name, email: contact.email, notes: description }) });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) return { ok: false, error: j?.error || res.statusText };
          return { ok: true, data: j };
        } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
      })();
      if (create.ok) {
        return NextResponse.json({ content: "You're all set. I’ll send a confirmation email and follow up with details." });
      }
      return NextResponse.json({ content: "I couldn’t complete the confirmation just now. Can I try again?" });
    }

    const maxSteps = 4;
    let finalText = "";

  let nudgedForAvailability = false;
  let nudgedForCreate = false;
  let lastSlots: Array<{ start: string; end: string }> | null = null;
  const responseMeta: any = {};
    for (let step = 0; step < maxSteps; step++) {
      let requestedContactForm = false;
      let resp: any;
      const models = ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"];
      let lastErr: any = null;
      for (let mi = 0; mi < models.length && !resp; mi++) {
        const model = models[mi];
        for (let attempt = 0; attempt < 2 && !resp; attempt++) {
          try {
            resp = await openai.chat.completions.create({
              model,
              messages: chatMessages as any,
              temperature: 0.2,
              tools,
              tool_choice: "auto",
            });
          } catch (err: any) {
            lastErr = err;
            // tiny backoff
            await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          }
        }
      }
      if (!resp) {
        console.error("openai.chat.completions failed after fallbacks:", lastErr?.message || lastErr);
        if (!modelOnly) {
        // Deterministic fallback: if user picked a time from known slots, proceed to contact or booking
        const lastUserRaw = [...baseMsgs].reverse().find((m) => m.role === "user")?.content || "";
        if (clientLastSlots?.length) {
          // Extract a time token like "2PM", "2 PM", or "2:00 PM" from the user's message
          const m = lastUserRaw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
          let selKey: string | null = null;
          if (m) {
            const h = String(Number(m[1]));
            const min = (m[2] ?? "00").padStart(2, "0");
            const ap = m[3].toLowerCase();
            selKey = `${h}:${min}${ap}`; // e.g., 2:00pm
          }
          const fmtKeys = (iso: string) => {
            const d12 = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
            // d12 like "2:00 PM" -> keys: 2:00pm, 2pm
            const [time, ampmRaw] = d12.split(" ");
            const ampm = (ampmRaw || "").toLowerCase();
            const [hh, mm] = time.split(":");
            const h = String(Number(hh));
            const min = (mm || "00").padStart(2, "0");
            return [`${h}:${min}${ampm}`, `${h}${ampm}`];
          };
          let matchIso: string | null = null;
          if (selKey) {
            for (const s of clientLastSlots) {
              const keys = fmtKeys(s.start);
              if (keys.includes(selKey)) { matchIso = s.start; break; }
            }
          }
          if (matchIso) {
            const iso = matchIso;
            if (!(contact?.email || contact?.name || contact?.phone)) {
              return NextResponse.json({ content: `Got it—I'll hold ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso))}. Please enter your contact details to finalize.`, ui: { type: "contact_form" }, meta: { selectedStartISO: iso } });
            }
            const endISO = new Date(new Date(iso).getTime() + 30 * 60_000).toISOString();
            const create = await callInternalApi("/api/calendar/create-event", { startISO: iso, endISO, title: "Blueridge Consultation", attendees: [{ email: contact.email!, name: contact.name || undefined }], owner_id: ownerId });
            if (create.ok) {
              return NextResponse.json({ content: "You're all set. I’ll send a confirmation email shortly." });
            }
            return NextResponse.json({ content: "I couldn’t finalize that just now. Want me to try again?" });
          }
        }
  // Deterministic scheduling fallback
        const lastUser = [...baseMsgs].reverse().find((m) => m.role === "user")?.content?.toLowerCase() || "";
        const weekdayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const mentionedDay = Object.keys(weekdayMap).find((d) => new RegExp(`\\b${d}\\b`, "i").test(lastUser));
        const tz = "America/New_York";
        const now = new Date();
        const isToday = /\btoday\b/i.test(lastUser);
        const isTomorrow = /\btomorrow\b/i.test(lastUser);
        let targetAnchor = now;
        if (isToday || isTomorrow) {
          const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
          const y = Number(todayParts.find(p => p.type === 'year')?.value);
          const m = Number(todayParts.find(p => p.type === 'month')?.value);
          const d = Number(todayParts.find(p => p.type === 'day')?.value);
          const baseUtc = new Date(Date.UTC(y, m - 1, d));
          targetAnchor = isTomorrow ? new Date(baseUtc.getTime() + 24 * 60 * 60 * 1000) : baseUtc;
        } else if (mentionedDay) {
          const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).formatToParts(now);
          const wdShort = parts.find(p => p.type === 'weekday')?.value || "";
          const currentDow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(wdShort);
          const targetDow = weekdayMap[mentionedDay];
          let daysUntil = (targetDow - currentDow + 7) % 7;
          if (daysUntil === 0) daysUntil = 7; // next occurrence
          targetAnchor = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
        } else {
          return NextResponse.json({ content: "Which day works best? I can check Monday–Friday and share a couple of windows." });
        }
  // Wide UTC window bracketing the ET day to avoid DST/offset issues
  const timeMinISO = new Date(targetAnchor.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const timeMaxISO = new Date(targetAnchor.getTime() + 36 * 60 * 60 * 1000).toISOString();
  const avail = await fetchAvailabilityGET({ timeMinISO, timeMaxISO, durationMins: 30 });
  if (!avail.ok || !Array.isArray(avail.data?.slots) || avail.data.slots.length === 0) {
          return NextResponse.json({ content: `I didn’t see open windows for next ${mentionedDay}. Want me to check the following ${mentionedDay} instead?` });
        }
  const arr = (avail.data.slots as Array<{ start: string; end: string }>);
  // Filter to the exact ET calendar date
  const targetEtDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(targetAnchor); // YYYY-MM-DD
  const onlyThatDay = arr.filter(s => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.start)) === targetEtDate);
  const pool = onlyThatDay.length ? onlyThatDay : arr;
        const seen = new Set<string>();
        const dedup: Array<{ start: string; end: string }> = [];
  for (const s of pool) {
          if (!s?.start || seen.has(s.start)) continue;
          seen.add(s.start);
          dedup.push(s);
          if (dedup.length >= 6) break;
        }
        const ranges: Array<{ a: string; b: string }> = [];
        for (let i = 0; i < dedup.length; ) {
          let j = i;
          while (j + 1 < dedup.length && dedup[j].end === dedup[j + 1].start) j++;
          ranges.push({ a: dedup[i].start, b: dedup[j].end });
          i = j + 1;
        }
        const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
        const pretty = ranges.slice(0, 3).map(r => `${fmt(r.a)}–${fmt(r.b)}`);
  const dayPretty = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(targetAnchor);
  return NextResponse.json({ content: `For ${dayPretty}, I can do ${pretty.join(", ")}. Which works best?`, meta: { slots: dedup } });
  }
  // Model-only: just return a friendly retry without deterministic logic
  return NextResponse.json({ content: "I had trouble reaching tools for a moment. Let me try again." });
      }

  const choice = resp.choices?.[0];
      const msg = choice?.message as any;
      const toolCalls = msg?.tool_calls || [];

      // If the model returned tool calls, execute them and continue the loop
  if (toolCalls.length) {
        // Include the assistant message that contains the tool_calls
        chatMessages.push({ role: "assistant", content: msg?.content || "", tool_calls: toolCalls } as any);

        for (const tc of toolCalls) {
          const name = tc.function?.name as string;
          const argsStr = tc.function?.arguments || "{}";
          let args: any = {};
          try { args = JSON.parse(argsStr); } catch { args = {}; }

          let toolResult: any = null;
      if (name === "getAvailability") {
            if (!args.durationMins) args.durationMins = 30;
            toolResult = await fetchAvailabilityGET({ timeMinISO: args.timeMinISO, timeMaxISO: args.timeMaxISO, durationMins: args.durationMins || 30 });
            if (toolResult?.ok && toolResult.data?.slots) {
            let arr = Array.isArray(toolResult.data.slots) ? toolResult.data.slots : [];
            // If the user specified a weekday, force slots to that exact ET calendar date.
            let forcedEtYmd: string | null = null;
            if (isToday || isTomorrow) {
              const etParts = getEtDateParts(now);
              const baseUtc = utcFromEtCalendarDate(etParts.y, etParts.m, etParts.d);
              const targetUtc = isTomorrow ? addDaysUtc(baseUtc, 1) : baseUtc;
              forcedEtYmd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(targetUtc);
              const arrDay = arr.filter((s: { start: string; end: string }) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.start)) === forcedEtYmd);
              if (arrDay.length) {
                arr = arrDay;
              } else {
                const [yy, mm, dd] = forcedEtYmd.split("-").map(Number);
                const etMidUtc = new Date(Date.UTC(yy, (mm as number) - 1, dd as number));
                const timeMinISO = new Date(etMidUtc.getTime() - 12 * 60 * 60 * 1000).toISOString();
                const timeMaxISO = new Date(etMidUtc.getTime() + 36 * 60 * 60 * 1000).toISOString();
                const widened = await fetchAvailabilityGET({ timeMinISO, timeMaxISO, durationMins: args?.durationMins || 30 });
                if (widened?.ok && Array.isArray(widened.data?.slots)) {
                  const slots = widened.data.slots as Array<{ start: string; end: string }>;
                  const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
                  const onlyThatDay = slots.filter(s => tzFmt.format(new Date(s.start)) === forcedEtYmd);
                  arr = onlyThatDay;
                } else {
                  arr = [];
                }
              }
            } else if (mentionedDay) {
              const wdIndex: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
              const wdShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
              const currentDow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(wdShort);
              const targetDow = wdIndex[mentionedDay];
              let daysUntil = (targetDow - currentDow + 7) % 7; if (daysUntil === 0) daysUntil = 7;
              const targetAnchor = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
              forcedEtYmd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(targetAnchor);
              const arrDay = arr.filter((s: { start: string; end: string }) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.start)) === forcedEtYmd);
              if (arrDay.length) {
                arr = arrDay;
              } else {
                // If the tool call didn’t cover the intended day, refetch using a wide window bracketing that ET date.
                const [yy, mm, dd] = forcedEtYmd.split("-").map(Number);
                const etMidUtc = new Date(Date.UTC(yy, (mm as number) - 1, dd as number));
                const timeMinISO = new Date(etMidUtc.getTime() - 12 * 60 * 60 * 1000).toISOString();
                const timeMaxISO = new Date(etMidUtc.getTime() + 36 * 60 * 60 * 1000).toISOString();
                const widened = await fetchAvailabilityGET({ timeMinISO, timeMaxISO, durationMins: args?.durationMins || 30 });
                if (widened?.ok && Array.isArray(widened.data?.slots)) {
                  const slots = widened.data.slots as Array<{ start: string; end: string }>;
                  const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
                  const onlyThatDay = slots.filter(s => tzFmt.format(new Date(s.start)) === forcedEtYmd);
                  arr = onlyThatDay;
                } else {
                  arr = [];
                }
              }
            }
            // Optional filter by time-of-day segment (ET)
            const seg = preferredSegment;
            const hourET = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(iso)));
            function withinSegment(h: number, s: "morning"|"afternoon"|"evening") {
              if (s === "morning") return h >= 9 && h < 12;
              if (s === "afternoon") return h >= 12 && h < 17;
              return h >= 17 && h < 20; // evening
            }
            let segFiltered = arr;
            if (seg) segFiltered = arr.filter((s: { start: string; end: string }) => withinSegment(hourET(s.start), seg));
            const used = seg && segFiltered.length ? segFiltered : arr; // fall back to all if none in segment
              // Dedupe by start ISO and keep first few
              const seen = new Set<string>();
              const dedup = [] as Array<{ start: string; end: string }>;
            for (const s of used) {
                if (!s?.start) continue;
                if (seen.has(s.start)) continue;
                seen.add(s.start);
                dedup.push(s);
                if (dedup.length >= 6) break; // cap to 6 to give the model room to pick 2–3
              }
              (toolResult as any).data.slots = dedup;
              lastSlots = dedup;
        responseMeta.slots = dedup;
              // Provide a human-friendly summary of contiguous ranges (ET) and instruct the model to present ranges
              const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
              const ranges: Array<{ a: string; b: string }> = [];
              for (let i = 0; i < dedup.length; ) {
                let j = i;
                while (j + 1 < dedup.length && dedup[j].end === dedup[j + 1].start) j++;
                ranges.push({ a: dedup[i].start, b: dedup[j].end });
                i = j + 1;
              }
              let pretty = ranges.map(r => `${fmt(r.a)}–${fmt(r.b)}`).slice(0, 3);
              if (pretty.length === 0 && dedup.length > 0) {
                // Fallback: show up to 3 individual slot windows
                pretty = dedup.slice(0, 3).map(s => `${fmt(s.start)}–${fmt(s.end)}`);
              }
              const dayPrettyBase = dedup.length
                ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(dedup[0].start))
                : (nextWeekdayText || "that day");
              if (seg && segFiltered.length === 0) {
                // If the model requested a narrow morning/segment window and found nothing, broaden to the entire day
                // so we can offer later same-day windows instead of incorrectly claiming the whole day is unavailable.
                let broadened: Array<{ start: string; end: string }> = [];
                try {
                  const tzFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
                  // Trust the filtered day from our own computation (dedup or forcedEtYmd), not the model arguments.
                  let targetEtYmd: string | null = forcedEtYmd || (dedup[0]?.start ? tzFmt.format(new Date(dedup[0].start)) : null);
                  if (targetEtYmd) {
                    // Build a wide UTC window around the ET calendar date to capture the full day's slots
                    const [yy, mm, dd] = targetEtYmd.split("-").map(Number);
                    const etMidUtc = new Date(Date.UTC(yy, (mm as number) - 1, dd as number));
                    const timeMinISO = new Date(etMidUtc.getTime() - 12 * 60 * 60 * 1000).toISOString();
                    const timeMaxISO = new Date(etMidUtc.getTime() + 36 * 60 * 60 * 1000).toISOString();
                    const widened = await fetchAvailabilityGET({ timeMinISO, timeMaxISO, durationMins: args?.durationMins || 30 });
                    if (widened?.ok && Array.isArray(widened.data?.slots)) {
                      const slots = (widened.data.slots as Array<{ start: string; end: string }>);
                      // Keep only slots on the exact ET calendar date
                      const onlyThatDay = slots.filter(s => tzFmt.format(new Date(s.start)) === targetEtYmd);
                      // If user asked for morning and none found, prefer later-day windows (>= 12:00). For afternoon, prefer >= 17:00.
                      const hourET = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(iso)));
                      let later = onlyThatDay;
                      if (seg === "morning") later = onlyThatDay.filter(s => hourET(s.start) >= 12);
                      else if (seg === "afternoon") later = onlyThatDay.filter(s => hourET(s.start) >= 17);
                      // Dedupe and cap
                      const seen2 = new Set<string>();
                      for (const s of later) {
                        if (!s?.start || seen2.has(s.start)) continue;
                        seen2.add(s.start);
                        broadened.push(s);
                        if (broadened.length >= 6) break;
                      }
                    }
                  }
                } catch {}
                if (dedup.length === 0 && broadened.length === 0) {
                  return NextResponse.json({
                    content: `We’re fully booked on ${dayPrettyBase}. Would you like me to check another day?`,
                  });
                }
                const useList = broadened.length ? broadened : dedup;
                const fmt2 = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
                const ranges2: Array<{ a: string; b: string }> = [];
                for (let i = 0; i < useList.length; ) {
                  let j = i;
                  while (j + 1 < useList.length && useList[j].end === useList[j + 1].start) j++;
                  ranges2.push({ a: useList[i].start, b: useList[j].end });
                  i = j + 1;
                }
                let pretty2 = ranges2.map(r => `${fmt2(r.a)}–${fmt2(r.b)}`).slice(0, 3);
                if (pretty2.length === 0 && useList.length > 0) {
                  pretty2 = useList.slice(0, 3).map(s => `${fmt2(s.start)}–${fmt2(s.end)}`);
                }
                return NextResponse.json({
                  content: `We’re booked in the ${seg} on ${dayPrettyBase}, but I do have ${pretty2.join(", ")}. Which works?`,
                  meta: { slots: useList },
                });
              } else if (seg && segFiltered.length > 0) {
                return NextResponse.json({
                  content: `For ${dayPrettyBase} ${seg}, I can do ${pretty.join(", ")}. Which works best?`,
                  meta: { slots: dedup },
                });
              } else {
                if (dedup.length === 0) {
                  return NextResponse.json({ content: `I’m not seeing availability on ${dayPrettyBase}. Want me to check another day?` });
                }
                chatMessages.push({ role: "system", content: `Present availability as concise ranges (not every 30 min). Use up to 3 options: ${pretty.join(", ")}.` });
              }
            }
          } else if (name === "createAppointment") {
            const hasAvailability = chatMessages.some((m: any) => m.role === "tool" && m.name === "getAvailability");
            if (!hasAvailability) {
              toolResult = { ok: false, error: "Please call getAvailability to present 2–3 slots and get a user-confirmed time before creating an appointment." };
            } else {
              // If contact was provided but attendees are missing, inject attendee based on contact
              if ((!args.attendees || !Array.isArray(args.attendees) || args.attendees.length === 0) && contact?.email) {
                args.attendees = [{ email: contact.email, name: contact.name || undefined }];
              }
              // Map createAppointment call to /api/book
              try {
                const duration = Math.max(1, Math.round((new Date(args.endISO).getTime() - new Date(args.startISO).getTime()) / 60000)) || 30;
                const attendee = Array.isArray(args.attendees) && args.attendees[0];
                const payload: any = { start: args.startISO, durationMins: duration, name: attendee?.name, email: attendee?.email, notes: args.description };
                const r = await fetch((process.env.APP_BASE_URL || "http://localhost:5173") + "/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const j = await r.json().catch(() => ({}));
                toolResult = r.ok ? { ok: true, data: j } : { ok: false, error: j?.error || r.statusText };
              } catch (e: any) {
                toolResult = { ok: false, error: e?.message || String(e) };
              }
            }
          } else if (name === "cancelAppointment") {
            toolResult = await callInternalApi("/api/calendar/cancel-event", { ...args, owner_id: args.owner_id || ownerId });
          } else if (name === "flagNeedsHuman") {
            toolResult = { ok: true, data: { flagged: true } };
          } else if (name === "showContactForm") {
            requestedContactForm = true;
            toolResult = { ok: true };
          } else {
            toolResult = { ok: false, error: `Unknown tool: ${name}` };
          }

          chatMessages.push({ role: "tool", tool_call_id: tc.id, name, content: JSON.stringify(toolResult) } as any);
        }
        // If UI contact form was requested, return immediately with UI hint
        if (requestedContactForm) {
          const text = msg?.content || "Please provide your contact details to continue.";
          return NextResponse.json({ content: text, ui: { type: "contact_form" }, meta: Object.keys(responseMeta).length ? responseMeta : undefined });
        }
        // Otherwise continue to next iteration so the model can use tool outputs
        continue;
      }

      // No tool calls: we have an assistant message
      finalText = msg?.content || "";
      // If the user selected one of the previously offered slots, instruct the model to book it
  if (!nudgedForCreate && (lastSlots?.length || clientLastSlots?.length)) {
        const lastUser = [...baseMsgs].reverse().find((m) => m.role === "user")?.content || "";
        const m = lastUser.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
        let selKey: string | null = null;
        if (m) {
          const h = String(Number(m[1]));
          const min = (m[2] ?? "00").padStart(2, "0");
          const ap = m[3].toLowerCase();
          selKey = `${h}:${min}${ap}`;
        }
        const fmtKeys = (iso: string) => {
          const d12 = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
          const [time, ampmRaw] = d12.split(" ");
          const ampm = (ampmRaw || "").toLowerCase();
          const [hh, mm] = time.split(":");
          const h = String(Number(hh));
          const min = (mm || "00").padStart(2, "0");
          return [`${h}:${min}${ampm}`, `${h}${ampm}`];
        };
        let matchIso: string | null = null;
        if (selKey) {
          for (const s of (lastSlots || clientLastSlots || [])) {
            const keys = fmtKeys(s.start);
            if (keys.includes(selKey)) { matchIso = s.start; break; }
          }
        }
        if (matchIso) {
          const iso = matchIso;
          // If contact is missing, trigger the contact form immediately and carry the selected ISO back to client
          if (!(contact?.email || contact?.name || contact?.phone)) {
            return NextResponse.json({ content: `Great—I'll hold ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso))}. Please enter your contact details to confirm.`, ui: { type: "contact_form" }, meta: { selectedStartISO: iso } });
          }
          chatMessages.push({ role: "system", content: `User confirmed slot startISO=${iso}. Proceed to call createAppointment with duration 30 unless otherwise stated.` });
          nudgedForCreate = true;
          continue; // allow model to act on the instruction
        }
      }
      // If assistant is proposing times without having called getAvailability, nudge it to call the tool
      const hasAvailability = (chatMessages as any[]).some((m) => m.role === "tool" && (m as any).name === "getAvailability");
      const looksLikeSlots = /(\b\d{1,2}:\d{2}\s?(AM|PM)\b)|\btime slots?\b|\bavailable times?\b/i.test(finalText || "");
      const schedulingIntent = /(book|schedule|appointment|reschedul(e|ing)|next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test((lastUserMsg || "") + " " + (finalText || ""));
  if (!modelOnly && !hasAvailability && schedulingIntent && (looksLikeSlots || mentionedDay) && !nudgedForAvailability) {
        nudgedForAvailability = true;
        chatMessages.push({
          role: "system",
          content: `You must call getAvailability BEFORE proposing times. Use America/New_York timezone and 30-minute slots by default. ${nextWeekdayText ? `For the requested day, use ${nextWeekdayText}.` : "If a weekday was mentioned without a date, interpret it as the next occurrence."}`,
        });
        continue; // loop again to let the model call the tool
      }

      // Hard guard: if the assistant still proposed times without using the tool, compute availability server-side and respond deterministically
  if (!modelOnly && !hasAvailability && (looksLikeSlots || mentionedDay)) {
        try {
          const tz = "America/New_York";
          // Determine target day: prefer mentionedDay from user, else default to next business day
          const weekdayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
          const userText = [...baseMsgs].reverse().find((m) => m.role === "user")?.content?.toLowerCase() || "";
          const dayKey = Object.keys(weekdayMap).find((d) => new RegExp(`\\b${d}\\b`, "i").test(userText)) || null;
          if (!dayKey) {
            return NextResponse.json({ content: "Let me check availability first—one moment…" });
          }
          const now = new Date();
          const wdShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
          const currentDow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(wdShort);
          const targetDow = weekdayMap[dayKey];
          let daysUntil = (targetDow - currentDow + 7) % 7;
          if (daysUntil === 0) daysUntil = 7;
          const todayEtParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
          const y = Number(todayEtParts.find(p => p.type === 'year')?.value);
          const m = Number(todayEtParts.find(p => p.type === 'month')?.value);
          const d = Number(todayEtParts.find(p => p.type === 'day')?.value);
          const baseUtc = new Date(Date.UTC(y, m - 1, d));
          const targetUtc = new Date(baseUtc.getTime() + daysUntil * 24 * 60 * 60 * 1000);
          const timeMinISO = new Date(Date.UTC(targetUtc.getUTCFullYear(), targetUtc.getUTCMonth(), targetUtc.getUTCDate(), 0, 0)).toISOString();
          const timeMaxISO = new Date(Date.UTC(targetUtc.getUTCFullYear(), targetUtc.getUTCMonth(), targetUtc.getUTCDate() + 1, 0, 0)).toISOString();
          const avail = await fetchAvailabilityGET({ timeMinISO, timeMaxISO, durationMins: 30 });
          if (!avail.ok || !Array.isArray(avail.data?.slots) || avail.data.slots.length === 0) {
            const dp = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(targetUtc);
            return NextResponse.json({ content: `I didn’t see open windows for ${dp}. Want me to check the following week instead?` });
          }
          const arr = avail.data.slots as Array<{ start: string; end: string }>;
          const seen = new Set<string>();
          const dedup: Array<{ start: string; end: string }> = [];
          for (const s of arr) { if (!s?.start || seen.has(s.start)) continue; seen.add(s.start); dedup.push(s); if (dedup.length >= 6) break; }
          const ranges: Array<{ a: string; b: string }> = [];
          for (let i = 0; i < dedup.length; ) { let j = i; while (j + 1 < dedup.length && dedup[j].end === dedup[j + 1].start) j++; ranges.push({ a: dedup[i].start, b: dedup[j].end }); i = j + 1; }
          const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
          const pretty = ranges.slice(0, 3).map(r => `${fmt(r.a)}–${fmt(r.b)}`);
          const dayPretty = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(targetUtc);
          return NextResponse.json({ content: `For ${dayPretty}, I can do ${pretty.join(", ")}. Which works best?`, meta: { slots: dedup } });
        } catch (e) {
          // Fall back to a friendly message if anything goes wrong
          return NextResponse.json({ content: "Let me double-check availability and get right back to you." });
        }
      }
      // Heuristic: if the assistant asks for contact details but forgot to call showContactForm, still trigger the UI form
      const needsContact = /contact (details|info)|name and email|email and phone|fill out (this|the) form|provide (your )?contact/i.test(finalText);
      if (needsContact && !(contact?.email || contact?.name || contact?.phone)) {
        return NextResponse.json({ content: finalText, ui: { type: "contact_form" } });
      }
      break;
    }

  return NextResponse.json({ content: finalText || "", meta: Object.keys(responseMeta).length ? responseMeta : undefined });
  } catch (err: any) {
    console.error("/api/ai/chat error:", err?.message || err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
