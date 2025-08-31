import { z } from "zod";

export const LeadSchema = z.object({ name: z.string().optional(), email: z.string().email(), phone: z.string().optional(), source: z.string().optional(), message: z.string().optional() });

export const ContactSchema = z.object({ name: z.string().optional(), email: z.string().email(), phone: z.string().optional(), owner_id: z.string().optional() });

export const CheckAvailabilitySchema = z.object({
	timeMinISO: z.string().refine((v: string) => !Number.isNaN(Date.parse(v)), { message: "timeMinISO must be an ISO timestamp" }),
	timeMaxISO: z.string().refine((v: string) => !Number.isNaN(Date.parse(v))),
	durationMins: z.number().int().positive(),
	calendarIds: z.array(z.string()).optional(),
	owner_id: z.string().optional(),
});

export const CreateEventSchema = z.object({
	startISO: z.string().refine((v: string) => !Number.isNaN(Date.parse(v))),
	endISO: z.string().refine((v: string) => !Number.isNaN(Date.parse(v))),
	title: z.string(),
	description: z.string().optional(),
	attendees: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
	calendarId: z.string().optional(),
	owner_id: z.string().optional(),
});

export const CancelEventSchema = z.object({ calendarId: z.string().optional(), eventId: z.string(), reason: z.string().optional(), owner_id: z.string().optional() });
