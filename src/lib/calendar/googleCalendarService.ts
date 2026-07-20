import { google } from "googleapis";
import { getOAuthClient } from "@/lib/tokens";

export type GoogleCalendarEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary?: string;
  transparency?: string;
  status?: string;
};

type CreateGoogleEventOpts = {
  start: Date;
  end: Date;
  title: string;
  description?: string;
  attendees?: Array<{ name?: string; email: string }>;
  location?: string;
};

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

async function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (email && privateKey) {
    return new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });
  }
  return getOAuthClient();
}

export async function getGoogleEventsInRange({ start, end }: { start: Date; end: Date }): Promise<GoogleCalendarEvent[]> {
  const auth = await getGoogleAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const response = await calendar.events.list({
    calendarId: calendarId(),
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  return (response.data.items || []).flatMap((event: any) => {
    const startValue = event.start?.dateTime || event.start?.date;
    const endValue = event.end?.dateTime || event.end?.date;
    if (!startValue || !endValue) return [];
    const eventStart = new Date(startValue);
    const eventEnd = new Date(endValue);
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return [];
    return [{
      uid: event.id || event.iCalUID || crypto.randomUUID(),
      start: eventStart,
      end: eventEnd,
      summary: event.summary || undefined,
      transparency: event.transparency || undefined,
      status: event.status || undefined,
    }];
  });
}

export async function createGoogleEvent({ start, end, title, description, attendees, location }: CreateGoogleEventOpts) {
  const auth = await getGoogleAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const sendInvites = (process.env.GOOGLE_SEND_INVITES || "").toLowerCase() === "true";
  const response = await calendar.events.insert({
    calendarId: calendarId(),
    sendUpdates: sendInvites ? "all" : "none",
    requestBody: {
      summary: title,
      description,
      location,
      start: { dateTime: start.toISOString(), timeZone: process.env.PRIMARY_TIMEZONE || "America/New_York" },
      end: { dateTime: end.toISOString(), timeZone: process.env.PRIMARY_TIMEZONE || "America/New_York" },
      attendees: sendInvites ? attendees?.map((attendee) => ({ email: attendee.email, displayName: attendee.name })) : undefined,
    },
  });

  if (!response.data.id) throw new Error("Google Calendar did not return an event ID");
  return { uid: response.data.id, htmlLink: response.data.htmlLink || undefined };
}
