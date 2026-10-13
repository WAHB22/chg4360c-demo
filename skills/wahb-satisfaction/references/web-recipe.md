# Web recipe, what produced the approved sites

## Spitch waitlist (spitch.vercel.app)
- **Stack:** Vite 8, React 19, TypeScript, Tailwind 4, shadcn/ui (Radix base, `npx shadcn@latest init -t vite -b radix -p nova`; MCP set up with `npx shadcn@latest mcp init --client claude`), Phosphor icons, react-router-dom, Supabase.
- **Architecture he liked:**
  - All copy lives in `src/content.ts`, and components never hold copy.
  - The brand name lives only in `src/config.ts` (BRAND). A small Vite plugin fills %TOKENS% in index.html meta tags from config.
  - Env accepts both `VITE_` and `NEXT_PUBLIC_` (`envPrefix: ['VITE_','NEXT_PUBLIC_']`, with a fallback chain in config).
- **Waitlist form:**
  - Checks: validation, CASL consent, and a honeypot that fakes success.
  - Storage: a Supabase insert-only table with row-level security, where anon can insert rows that have consent and nothing else, plus a unique lowercased email.
  - A duplicate email (23505) shows "You're already on the list."
  - Mock mode when no keys are set, and `supabase/schema.sql` in the repo.
  - supabase-js is loaded lazily, only on submit.
- **Content:** draft /privacy and /terms pages with a DRAFT banner, a 404 page, and `vercel.json` rewrites so routes survive a refresh.
- **Design:** alternating ink and paper sections, one orange accent, darker orange (#B8400F) for text on light, ink text on orange buttons, and self-hosted fonts with size-matched fallbacks.
- **Motion:** the hero rises in, the phone card nudges once, and sections fade up once. All of it turns off under reduced motion.
- **Verification before delivery:**
  - `npm run build` and `lint` pass.
  - Playwright at 360, 768 and 1280 px widths.
  - Form tests using exact role locators.
  - Route checks.
  - An audit of every brief item.
- **README:** where things live, how to run it, how to connect Supabase, how to deploy on Vercel, a TODO-before-launch checklist, the assumptions, and credits.
- `.vercelignore` excludes heavy folders (`video`).

## WAHB'S WORLD (wahbs-worlds.vercel.app)
- A Next.js personal life app in the "Chrome Carte" style. It has worlds (Today, School, Work, Money, Projects, Career, Knowledge, Training, Life), a real glass-cabinet landing in 3D, café-menu styling, design tokens in `design/tokens.json`, and a password gate through the ACCESS_PASSWORD env variable (never hard-coded).
- Private data stays private: the money seed is in the gitignored `seed/private.json`, bank statements are never committed, and the device passcode stays local.

## How he wants web work run
- A brief comes in → state a one-line design read → build every section in one pass → verify (build, lint, three viewports, tests, a screenshot look) → commit with his requested message → push → give him numbered next steps for anything only he can do: Supabase keys, a Vercel import, a domain.
- If a connector fails (a Vercel 403), give the manual steps rather than stopping.
- For "check again" on a deployment, re-test the live URL or the real backend (for example, insert a row through RLS and confirm the result).
