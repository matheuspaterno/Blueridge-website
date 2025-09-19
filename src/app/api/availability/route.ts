import { NextResponse } from 'next/server';
import { generateSlots } from '@/lib/calendar/calendarService';

const businessHours = {
  mon: ['09:00-17:00'],
  tue: ['09:00-17:00'],
  wed: ['09:00-17:00'],
  thu: ['09:00-17:00'],
  fri: ['09:00-17:00'],
  sat: [],
  sun: []
};

// Fabrication fallback: generate slots in the configured timezone (not server-local) to avoid UTC shifts in prod
function fabricateSlots({ from, durationMins, businessHours, maxDays }: { from: Date; durationMins: number; businessHours: any; maxDays: number; }) {
  const fabricated: Date[] = [];
  const tz = process.env.PRIMARY_TIMEZONE || 'America/New_York';
  const earliest = new Date(Date.now() + 45 * 60_000);
  // Start from the next 15-min boundary to align nicely
  const iterStart = new Date(from);
  const alignedMinutes = Math.ceil(iterStart.getMinutes() / 15) * 15;
  iterStart.setMinutes(alignedMinutes, 0, 0);

  // We iterate over time forward and admit slots that fall within business windows of their local (tz) day
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  const endBy = new Date(iterStart.getTime() + maxMs);
  for (let cursor = new Date(iterStart); cursor < endBy && fabricated.length < 6; cursor.setMinutes(cursor.getMinutes() + 15)) {
    if (cursor < earliest) continue;
    // Determine local DOW key and local HH:MM in target timezone using Intl
    const dowStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(cursor); // Mon, Tue, ...
    const key = dowStr.slice(0, 3).toLowerCase();
    const windows: string[] = (businessHours as any)[key] || [];
    if (!windows.length) continue;

    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(cursor); // HH:MM
    const [locHStr, locMStr] = hm.split(':');
    const locH = Number(locHStr);
    const locM = Number(locMStr);
    const minutesOfDay = locH * 60 + locM;

    for (const win of windows) {
      const [hStart, hEnd] = win.split('-');
      if (!hStart || !hEnd) continue;
      const [sH, sM] = hStart.split(':').map(Number);
      const [eH, eM] = hEnd.split(':').map(Number);
      const winStartMin = sH * 60 + sM;
      const winEndMin = eH * 60 + eM;
      if (minutesOfDay < winStartMin || minutesOfDay >= winEndMin) continue;
      // Align slot start to duration boundaries relative to window start (in minutes)
      const minutesFromWindowStart = minutesOfDay - winStartMin;
      if (minutesFromWindowStart % durationMins !== 0) continue;
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + durationMins * 60_000);
      // Ensure end still inside window in local timezone
      const endParts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(slotEnd).split(':');
      const endMinutesOfDay = Number(endParts[0]) * 60 + Number(endParts[1]);
      if (endMinutesOfDay > winEndMin) continue;
      // Accept slot
      fabricated.push(new Date(slotStart));
      break;
    }
  }
  // Dedupe and sort
  const dedup = Array.from(new Set(fabricated.map(d => d.toISOString()))).map(s => new Date(s));
  dedup.sort((a, b) => a.getTime() - b.getTime());
  return dedup.slice(0, 6);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const durationMins = Number(url.searchParams.get('durationMins') || 30);
    if (!fromStr || !toStr) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  let from = new Date(fromStr);
  let to = new Date(toStr);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
    }
    const now = Date.now();
    if (from.getTime() < now) from = new Date(now);
    let slots: Date[] = [];
    let phase: string[] = [];
    try {
      // First attempt
      slots = await generateSlots({ from, to, durationMins, businessHours, bufferMins: 10, leadTimeMins: 120 });
      phase.push('primary');
      // Retry with reduced lead time if none
      if (!slots.length) {
        slots = await generateSlots({ from, to, durationMins, businessHours, bufferMins: 10, leadTimeMins: 60 });
        phase.push('reducedLead');
      }
      // Final fallback: extend window by one business day if still none
      if (!slots.length) {
        const extTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);
        slots = await generateSlots({ from, to: extTo, durationMins, businessHours, bufferMins: 10, leadTimeMins: 60 });
        phase.push('extendedDay');
      }
    } catch (err: any) {
      phase.push('error:' + (err?.message || 'unknown'));
      // swallow and proceed to fabrication
    }
    if (!slots.length) {
      const fabricated: Date[] = fabricateSlots({ from, durationMins, businessHours, maxDays: 14 });
      slots = fabricated;
      phase.push('fabricated');
    }
    return NextResponse.json({ slots: slots.map(d => d.toISOString()), phases: phase });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/401|unauthorized|403/i.test(msg)) return NextResponse.json({ error: 'CalDAV auth failed' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}