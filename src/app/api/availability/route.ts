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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const durationMins = Number(url.searchParams.get('durationMins') || 30);
    if (!fromStr || !toStr) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
    }
    if (from.getTime() < Date.now() - 5 * 60_000) {
      return NextResponse.json({ error: 'from must be in the future' }, { status: 400 });
    }
    const slots = await generateSlots({ from, to, durationMins, businessHours, bufferMins: 10, leadTimeMins: 120 });
    return NextResponse.json({ slots: slots.map(d => d.toISOString()) });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/401|unauthorized|403/i.test(msg)) return NextResponse.json({ error: 'CalDAV auth failed' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}