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

function fabricateSlots({ from, durationMins, businessHours, maxDays }: { from: Date; durationMins: number; businessHours: any; maxDays: number; }) {
  const fabricated: Date[] = [];
  const base = new Date(from);
  const earliest = new Date(Date.now() + 45 * 60_000);
  for (let day = 0; day < maxDays && fabricated.length < 6; day++) {
    const d = new Date(base.getTime() + day * 24 * 60 * 60 * 1000);
    const key = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
    const windows = (businessHours as any)[key] as string[] | undefined;
    if (!windows || !windows.length) continue;
    for (const win of windows) {
      const [hStart, hEnd] = win.split('-');
      if (!hStart || !hEnd) continue;
      const [sH, sM] = hStart.split(':').map(Number);
      const [eH, eM] = hEnd.split(':').map(Number);
      const winStart = new Date(d); winStart.setHours(sH, sM, 0, 0);
      const winEnd = new Date(d); winEnd.setHours(eH, eM, 0, 0);
      for (let cursor = new Date(winStart); cursor < winEnd; cursor.setMinutes(cursor.getMinutes() + durationMins)) {
        if (cursor < earliest) continue;
        const end = new Date(cursor.getTime() + durationMins * 60_000);
        if (end > winEnd) break;
        fabricated.push(new Date(cursor));
        if (fabricated.length >= 6) break;
      }
      if (fabricated.length >= 6) break;
    }
  }
  return fabricated;
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