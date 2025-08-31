import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  DEFAULT_OWNER_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  BOOKINGS_FROM_EMAIL: z.string().email().optional(),
  AI_MODEL_ONLY: z.string().optional(),
});

export const env = schema.parse(process.env);

// Note: Env type intentionally omitted to avoid build-time dependency on zod types.
