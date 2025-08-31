# Blueridge AI Agency — Frontend

This is a Vite + React + TypeScript scaffold prepared for the Blueridge AI Agency one-page site.

Next steps:

1. Install dependencies:

   npm install

2. Add required assets to `/public` using these exact filenames:

   - `website background.png`
   - `Bluerigde Logo 1.png`

3. Install Vanta and threejs:

   npm install vanta three
   npm install -D @types/three

4. Run the dev server:

   npm run dev

5. Open http://localhost:5173

Notes:
- The project includes a `useVantaFog` hook that uses dynamic import to avoid SSR/TS issues.
- Tailwind CSS is configured; edit `tailwind.config.cjs` and `src/index.css` as needed.
