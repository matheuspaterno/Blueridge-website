import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_OAUTH_SETUP_TOKEN: z.string().min(24).optional(),
  GOOGLE_CALENDAR_ID: z.string().min(1).optional(),
  GOOGLE_SEND_INVITES: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1).optional(),
  CALENDAR_PROVIDER: z.enum(["caldav", "google"]).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  DEFAULT_OWNER_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_DEBUG: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  BOOKINGS_FROM_EMAIL: z.string().email().optional(),
  OWNER_NOTIFY_EMAIL: z.string().email().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  RESEND_REPLY_TO: z.string().email().optional(),
  AI_MODEL_ONLY: z.string().optional(),
});

export const env = schema.parse(process.env);

// Note: Env type intentionally omitted to avoid build-time dependency on zod types.
