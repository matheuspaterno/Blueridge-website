# Rick — Chat & Booking (Blueridge)

Setup

1. Copy `.env.local.sample` to `.env.local` and fill the keys for OpenAI, Google OAuth, and Supabase.

2. Install and run:

```
npm install
npm run dev
```

3. Open the site and click "Chat with Rick".

Testing API routes

Use the new endpoints under `/api/calendar`, `/api/leads`, `/api/contacts`, and `/api/ai/chat`.

Behavior

- Rick answers concisely (1–3 sentences), asks one item at a time, and offers 2–3 slots when booking.
All external API calls are proxied server-side; no secrets on the client.
- Fill .env.local before testing.

Notes

- This is an MVP integration. Add logging, authentication, and more robust validation in production.
