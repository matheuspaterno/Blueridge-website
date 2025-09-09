import { NextResponse } from "next/server";
import { CheckAvailabilitySchema } from "@/lib/validations";
import { getOAuthClient } from "@/lib/tokens";
import { google } from "googleapis";

function slotStartIterator(start: Date, end: Date, stepMins: number) {
  const res: Date[] = [];
  const current = new Date(start);
  while (current.getTime() + stepMins * 60_000 <= end.getTime()) {
    res.push(new Date(current));
    current.setMinutes(Math.ceil(current.getMinutes() / 30) * 30);
    // move in step increments
    current.setTime(current.getTime() + stepMins * 60_000);
  }
  return res;
}

function ceilTo30(dt: Date) {
  const m = dt.getMinutes();
  if (m === 0 || m === 30) return dt;
  const newDt = new Date(dt);
  if (m < 30) newDt.setMinutes(30, 0, 0);
  else newDt.setHours(newDt.getHours() + 1, 0, 0, 0);
  return newDt;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CheckAvailabilitySchema.parse(body);
    const owner = parsed.owner_id;
    const defaultCalendarIds = ["services@blueridge-ai.com"]; // target calendar email
    let client;
    try {
      client = await getOAuthClient(owner);
    } catch (err: any) {
      if (err?.message === "needs_reauth") {
        return NextResponse.json({ error: "needs_reauth" }, { status: 401 });
      }
      throw err;
    }
    const calendar = google.calendar({ version: "v3", auth: client });
    const items = (parsed.calendarIds && parsed.calendarIds.length)
      ? parsed.calendarIds.map((id: string) => ({ id }))
      : defaultCalendarIds.map((id: string) => ({ id }));
    let fbRes;
    try {
      fbRes = await calendar.freebusy.query({ requestBody: { timeMin: parsed.timeMinISO, timeMax: parsed.timeMaxISO, items } });
    } catch (e: any) {
      // Fallback: if calendar not shared or not found, try primary
      try {
        fbRes = await calendar.freebusy.query({ requestBody: { timeMin: parsed.timeMinISO, timeMax: parsed.timeMaxISO, items: [{ id: "primary" }] } });
      } catch (e2: any) {
        return NextResponse.json({ error: e2?.message || String(e2) }, { status: 400 });
      }
    }
    // collect busy intervals across calendars
    const busy: Array<{ start: Date; end: Date }> = [];
    const calendars = fbRes.data.calendars || {};
    for (const k of Object.keys(calendars)) {
      const b = (calendars as any)[k].busy || [];
      for (const interval of b) busy.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }

    // generate candidate slots at 30-min boundaries within ET business hours (default 9:00–17:00)
    const min = ceilTo30(new Date(parsed.timeMinISO));
    const max = new Date(parsed.timeMaxISO);
    const step = 30; // granularity minutes
    const duration = parsed.durationMins;
    const slots: Array<{ start: string; end: string }> = [];
    const tz = "America/New_York";
    const BUSINESS_START = 9; // 9 AM
    const BUSINESS_END = 17; // 5 PM
    for (let t = new Date(min); t.getTime() + duration * 60_000 <= max.getTime(); t.setMinutes(t.getMinutes() + 30)) {
      const start = new Date(t);
      const end = new Date(start.getTime() + duration * 60_000);
      // filter by ET business hours for the slot start
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).formatToParts(start);
      const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
      const hour = Number(hourStr);
      if (Number.isFinite(hour)) {
        if (hour < BUSINESS_START || hour >= BUSINESS_END) continue;
      }
      let ok = true;
      for (const b of busy) {
        if (overlaps(start, end, b.start, b.end)) { ok = false; break; }
      }
      if (ok) slots.push({ start: start.toISOString(), end: end.toISOString() });
      if (slots.length >= 50) break; // safety cap
    }

    return NextResponse.json({ slots });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
