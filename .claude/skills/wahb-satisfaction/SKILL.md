---
name: wahb-satisfaction
description: WAHB SATISFACTION. Wahb's (Mohamed Wahb Berguia) standards for anything built for him: what he approved, what he rejected, and the exact process that got approval. Load it before any website, landing page, app UI, pitch video, animation, or brand work for Wahb, and whenever he asks for "the same level" as Spitch v4 or the Spitch / WAHB'S WORLD sites.
---

# WAHB SATISFACTION

The bar is set by three pieces he approved as "an okay level of satisfaction for what I expect every time":

1. **Spitch pitch video v4.** A 60-second pitch with no people. The protagonist is one orange dot (the idea, and the period in "SPITCH."), with editorial type and his own voice. Built in Remotion.
2. **The Spitch waitlist site** (spitch.vercel.app). Vite, React, Tailwind 4, shadcn, Supabase insert-only.
3. **WAHB'S WORLD** (wahbs-worlds.vercel.app). His personal "Chrome Carte" life app, a Next.js project.

Treat these as the floor, not the ceiling. Every new build should be at least this good on the first delivery.

Read `references/likes-and-dislikes.md` first: it is the memory of what pleased and displeased him. Then the recipe for the job:
- Video or animation: `references/video-recipe.md`, with the code in `assets/`.
- Website or app: `references/web-recipe.md`.

## The ten rules

1. **Finish it in one pass.** He writes long, exact briefs and expects the whole thing built, verified and delivered, not a plan or a partial. Only ask when truly blocked, and never ask several questions at once.
2. **The brief is law.** Follow exact scripts, timings, colours, fonts, section lists and names word for word. When the brief and taste conflict, the brief wins. When something in it is impossible, do the closest thing and say so in one line.
3. **No AI look.** This is his most repeated complaint. See the dislikes list. Motion and craft must look made by a person: one strong concept, physical motion, texture, deliberate type.
4. **One idea carries the piece.** v4 worked because a single element (the dot) told the whole story. Find the equivalent before building anything.
5. **Real over synthetic** wherever it counts:
   - his own voice (he recorded it when asked);
   - real recorded sound effects (Kenney CC0 packs);
   - the site's real fonts and components inside the video;
   - real screenshots of his product.
6. **Verify with your own eyes before saying it's done.**
   - Render stills and contact sheets and look at them.
   - Run builds, lints and tests.
   - Measure the numbers: duration exactly 60.00 s, -14 LUFS, file size.
   - Fix what you see, then re-check.
7. **Deliver so he can open it.**
   - The send tool has a 30 MB limit, so send a share copy of about 25 MB (x264 at around 3.3 Mb/s).
   - Keep the full-quality master in the project folder for upload.
   - Put deliverables in the primary working directory.
8. **Report honestly and briefly.**
   - What it is and where it is.
   - What you checked.
   - What is unverified, such as the "48,000 students" figure.
   - What you did not do.
   - Mention anything you could not experience yourself, such as audio you can't hear.
9. **Protect his data.**
   - Never commit secrets: no service-role keys, no CRON_SECRET, no password in code.
   - Only public, anon, or NEXT_PUBLIC values reach the browser.
   - Bank statements and personal money data never go to GitHub.
   - His own voice and face are personal: ask before pushing them. Keep the repo clean with `.git/info/exclude`.
   - Never disable TLS verification.
   - "Bypass everything" means creative freedom, not bypassing safety.
10. **Keep going until it's actually good.**
    - When he says "I don't like the visuals", rebuild the concept; don't tweak.
    - When he says "retry", continue the unfinished work.

## Palette and type that won (Spitch brand)

- Ink `#0E0F12`, ink-2 `#16171C`, ink-3 `#22242B`.
- Paper `#F6F4EF`, orange accent `#FF5A1F` (use `#B8400F` for orange text on light backgrounds), muted `#A3A3AB` on dark and `#6B6B72` on light.
- In the video only, AI and chat things use green `#10A37F`.
- Video type: Times New Roman Bold (Liberation Serif on Linux) for display and captions, with tight tracking at large sizes.
- UI inside the video uses the site's own Space Grotesk and Inter.
- Site: Space Grotesk headings and Inter body, self-hosted through @fontsource. Icons are Phosphor, one family only.

For new brands, pick a palette with the same discipline: dark and light neutrals plus one accent, locked everywhere.
