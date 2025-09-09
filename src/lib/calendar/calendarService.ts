import { createDAVClient } from 'tsdav';
import { v4 as uuidv4 } from 'uuid';

// Basic types
export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary?: string;
  transparency?: string;
  status?: string;
}

type BusinessHours = Record<string, string[]>; // mon: ['09:00-17:00'] etc.

interface SlotGenOpts {
  from: Date;
  to: Date;
  durationMins: number;
  businessHours: BusinessHours;
  bufferMins: number;
  leadTimeMins: number;
}

interface CreateEventOpts {
  start: Date;
  end: Date;
  title: string;
  description?: string;
  attendees?: Array<{ name?: string; email: string }>;
  location?: string;
}

let cachedClient: any = null;
let cachedCalendar: any = null;

// Lightweight ICS parser (extracts VEVENT blocks with DTSTART, DTEND, SUMMARY, UID, STATUS, TRANSP)
function simpleParseICS(raw: string) {
  const events: Record<string, any> = {};
  if (!raw) return events;
  // Normalize CRLF -> LF and unfold continued lines (those starting with space)
  const unfolded = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n[ ]/g, '');
  const parts = unfolded.split(/BEGIN:VEVENT/).slice(1); // discard preamble
  parts.forEach((chunk, idx) => {
    const body = chunk.split(/END:VEVENT/)[0];
    const lines = body.split(/\n/).map(l => l.trim()).filter(Boolean);
    const ve: any = { type: 'VEVENT' };
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9-]+)(;[^:]*)?:(.+)$/i);
      if (!m) continue;
      const prop = m[1].toUpperCase();
      const value = m[3];
      switch (prop) {
        case 'DTSTART':
          ve.start = parseICSDate(value);
          break;
        case 'DTEND':
          ve.end = parseICSDate(value);
          break;
        case 'SUMMARY':
          ve.summary = value;
          break;
        case 'UID':
          ve.uid = value;
          break;
        case 'STATUS':
          ve.status = value;
          break;
        case 'TRANSP':
          ve.transp = value;
          break;
        default:
          break;
      }
    }
    events[`VEVENT-${idx}`] = ve;
  });
  return events;
}

function parseICSDate(v: string) {
  // Handles forms like 20250908, 20250908T143000Z, 20250908T143000, 20250908T143000-0500
  if (!v) return v;
  // If date only (YYYYMMDD) treat as 00:00 UTC
  if (/^\d{8}$/.test(v)) {
    const year = +v.slice(0,4); const mon = +v.slice(4,6) - 1; const day = +v.slice(6,8);
    return new Date(Date.UTC(year, mon, day));
  }
  // If Z suffixed treat as UTC
  if (/Z$/.test(v)) {
    // Insert colon in timezone if needed before Date can parse (not necessary for Z)
    return new Date(v.replace(/Z$/, 'Z'));
  }
  // If has explicit offset like -0500 or +0130 convert to ISO
  const offsetMatch = v.match(/([+-]\d{4})$/);
  if (offsetMatch) {
    const off = offsetMatch[1];
    const core = v.slice(0, v.length - 5);
    const iso = core.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6') + off.slice(0,3) + ':' + off.slice(3);
    return new Date(iso);
  }
  // Naive fallback: try to expand basic format 20250908T143000
  const basic = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (basic) {
    const iso = `${basic[1]}-${basic[2]}-${basic[3]}T${basic[4]}:${basic[5]}:${basic[6]}`;
    return new Date(iso);
  }
  // Else let Date parse (may treat as local)
  return new Date(v);
}

function envOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

async function getClient() {
  if (cachedClient) return cachedClient;
  const baseUrl = envOrThrow('CALDAV_BASE_URL');
  const username = envOrThrow('CALDAV_USERNAME');
  const password = envOrThrow('CALDAV_APP_PASSWORD');
  cachedClient = await createDAVClient({
    serverUrl: baseUrl,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  });
  return cachedClient;
}

export async function discoverPrimaryCalendar() {
  if (cachedCalendar) return cachedCalendar;
  const client = await getClient();
  const cals = await client.fetchCalendars();
  if (!Array.isArray(cals) || !cals.length) {
    console.warn('[CalDAV] No calendars returned');
    throw new Error('No CalDAV calendars found');
  }
  // pick first writable (if property present) else first
  cachedCalendar = cals.find((c: any) => c?.components?.includes('VEVENT')) || cals[0];
  console.warn('[CalDAV] Using calendar', cachedCalendar?.displayName || cachedCalendar?.url || 'unknown');
  return cachedCalendar;
}

export async function getEventsInRange({ start, end }: { start: Date; end: Date; }): Promise<CalendarEvent[]> {
  const cal = await discoverPrimaryCalendar();
  const client = await getClient();
  const objects = await client.fetchCalendarObjects({ calendar: cal });
  const events: CalendarEvent[] = [];
  for (const obj of objects) {
    if (!obj?.data) continue;
    try {
  const parsed = simpleParseICS(obj.data);
      for (const key of Object.keys(parsed)) {
        const ve: any = (parsed as any)[key];
        if (!ve || ve.type !== 'VEVENT') continue;
        const dtStart = ve.start || ve.dtstart || ve['DTSTART'];
        const dtEnd = ve.end || ve.dtend || ve['DTEND'];
        if (!dtStart || !dtEnd) continue;
        const s = new Date(dtStart.value || dtStart);
        const e = new Date(dtEnd.value || dtEnd);
        if (e <= start || s >= end) continue; // outside range
        events.push({
          uid: ve.uid?.value || ve.uid || uuidv4(),
          start: s,
          end: e,
          summary: ve.summary?.value || ve.summary,
          transparency: ve.transp?.value || ve.transp,
          status: ve.status?.value || ve.status
        });
      }
    } catch (_) {
      /* ignore bad ICS */
    }
  }
  return events;
}

export async function isBusyRange({ start, end }: { start: Date; end: Date; }) {
  const events = await getEventsInRange({ start: new Date(start.getTime() - 12*60*60*1000), end: new Date(end.getTime() + 12*60*60*1000) });
  return events.some(ev => isEventBlocking(ev) && rangesOverlap(start, end, ev.start, ev.end));
}

function isEventBlocking(ev: CalendarEvent) {
  const status = (ev.status || '').toUpperCase();
  const transp = (ev.transparency || ev.transparency || '').toUpperCase();
  if (status === 'CANCELLED') return false;
  if (transp === 'TRANSPARENT') return false;
  return true;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export async function generateSlots(opts: SlotGenOpts) {
  const { from, to, durationMins, businessHours, bufferMins, leadTimeMins } = opts;
  const now = new Date();
  const earliest = new Date(now.getTime() + leadTimeMins * 60_000);
  const busyEvents = await getEventsInRange({ start: from, end: to });
  const slots: Date[] = [];
  // Start iteration on aligned boundary: round up to nearest duration multiple (relative to hour)
  const iterStart = new Date(from);
  const alignedMinutes = Math.ceil(iterStart.getMinutes() / 15) * 15; // coarse 15-min alignment first
  iterStart.setMinutes(alignedMinutes, 0, 0);
  for (let cursor = new Date(iterStart); cursor < to; cursor.setMinutes(cursor.getMinutes() + 15)) { // 15-min granularity
    if (cursor < earliest) continue;
    const dow = cursor.getDay(); // 0 Sun .. 6 Sat
    const key = ['sun','mon','tue','wed','thu','fri','sat'][dow];
    const windows = businessHours[key] || [];
    if (!windows.length) continue;
    for (const win of windows) {
      const [hStart, hEnd] = win.split('-');
      if (!hStart || !hEnd) continue;
      const [sH, sM] = hStart.split(':').map(Number);
      const [eH, eM] = hEnd.split(':').map(Number);
      const winStart = new Date(cursor); winStart.setHours(sH, sM, 0, 0);
      const winEnd = new Date(cursor); winEnd.setHours(eH, eM, 0, 0);
      if (cursor < winStart || cursor >= winEnd) continue;
      // Align slot start to duration boundaries: require that minutes offset from window start is multiple of duration
      const minutesFromWindowStart = Math.floor((cursor.getTime() - winStart.getTime()) / 60000);
      if (minutesFromWindowStart % durationMins !== 0) continue;
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + durationMins * 60_000);
      if (slotEnd > winEnd) continue;
      // buffer: ensure buffer before & after relative to blocking events
      const blocked = busyEvents.some(ev => {
        if (!isEventBlocking(ev)) return false;
        const evStart = new Date(ev.start.getTime() - bufferMins * 60_000);
        const evEnd = new Date(ev.end.getTime() + bufferMins * 60_000);
        return rangesOverlap(slotStart, slotEnd, evStart, evEnd);
      });
      if (blocked) continue;
      // prevent overlap with earlier chosen slots
      if (slots.some(s => rangesOverlap(s, new Date(s.getTime() + durationMins * 60_000), slotStart, slotEnd))) continue;
      slots.push(slotStart);
    }
  }
  // Filter to exact alignment (every durationMins on the 0 or 30 minute boundaries preferred)
  const dedup = Array.from(new Set(slots.map(d => d.toISOString()))).map(s => new Date(s));
  dedup.sort((a,b) => a.getTime() - b.getTime());
  return dedup;
}

export async function createEvent({ start, end, title, description, attendees, location }: CreateEventOpts) {
  const cal = await discoverPrimaryCalendar();
  const client = await getClient();
  const uid = uuidv4();
  const tz = process.env.PRIMARY_TIMEZONE || 'UTC';
  // Basic ICS (no RRULE). Using UTC times for reliability; TZID hint included.
  function fmt(dt: Date) {
    return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blueridge AI//CalDAV//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escapeText(title)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : '',
    `ORGANIZER:mailto:${process.env.FROM_EMAIL || process.env.CALDAV_USERNAME}`,
    location ? `LOCATION:${escapeText(location)}` : '',
  ];
  if (attendees && attendees.length) {
    for (const at of attendees) {
      lines.push(`ATTENDEE;CN=${escapeText(at.name || at.email)}:mailto:${at.email}`);
    }
  }
  lines.push('END:VEVENT','END:VCALENDAR');
  const ics = lines.filter(Boolean).join('\r\n');
  await client.createCalendarObject({ calendar: cal, filename: `${uid}.ics`, iCalString: ics });
  return { uid };
}

function escapeText(s: string) {
  return s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

// Example usage comments (not executed)
// generateSlots({ from: new Date(), to: new Date(Date.now()+7*86400000), durationMins:30, businessHours: { mon:['09:00-17:00'], tue:['09:00-17:00'], wed:['09:00-17:00'], thu:['09:00-17:00'], fri:['09:00-17:00'], sat:[], sun:[] }, bufferMins:10, leadTimeMins:120 });
