# SAO

SAO is a calm, painted valley world where Wahb's real work is quietly taken care of.
ICON, his digital twin, runs the town at the bridge; seven small bots work in the places around it.
The look is a painted anime landscape with a floating game interface in navy glass and warm gold.
Every place stands for a real part of his life: campus, the café, the internship tower, home and more.
It runs on his own laptop, on his own Claude Code login, with no paid services and no outside AI.

## Run it locally

```
cd sao
npm start
```

Then open http://127.0.0.1:3210. There is nothing to install: the engine is one Node file (Node 20 or newer) with no dependencies. Set `SAO_PORT` to use another port. Add `?demo=1` to the address to see the demo world instead of live data.

## Deploy on Vercel

1. In Vercel, import the GitHub repository `WAHB22/chg4360c-demo`.
2. Root Directory: `sao`. Framework Preset: Other. Build Command: empty. Output Directory: `public`. `vercel.json` already sets all of this.
3. Deploy. The site is static: only the `public` folder is served, and there are no server functions.
4. On the laptop, start the engine with the deployment address allowed, so the deployed page can show live data when it is opened on this machine:

```
SAO_ORIGINS=https://your-deployment.vercel.app npm start
```

Several addresses can be listed, separated by commas. Anywhere else the deployment cannot reach the laptop and shows the demo world.

A deploy only happens when Wahb says go.

## Privacy

No personal data is ever deployed. The deployment holds only the code and `public/demo/state.json`, which is invented demo content. Live data stays on the laptop: the engine binds to 127.0.0.1 only, answers only requests addressed to this machine, answers other sites only when they are listed in `SAO_ORIGINS`, and refuses changes from any other origin. `memory.md` is shown only to pages served from this laptop. The engine never logs file contents.

## Adding paintings

Place paintings go in `public/assets/places/` as `<place>-<time>.webp`, for example `bobino-sunset.webp`. Places: `town`, `campus`, `bobino`, `tower`, `home`, `kitchen`, `gym`, `market`, `vault`, `fields`, `lighthouse`. Times: `morning`, `day`, `sunset`, `night`. Each painting is 16:9 and at least 2400 px wide. Until a painting exists, the world paints its own placeholder and shows a small tag, Painting coming.

Logos go in `public/assets/logos/<place>.png`; character art notes are in `public/assets/characters/README.md`.

## Files ICON writes

The engine reads these from the repository root, one level above `sao/`. All of them are gitignored and never leave the laptop.

| File | What it holds |
|---|---|
| `world.json` | The world state ICON writes after each loop, in the shape of `public/demo/state.json`. It is the base of `/api/state`. |
| `orders.json` | The queue: `questions` (shown as question cards, at most 3 at once), `approvals` and `orders`. The world adds orders, answers and approvals here. |
| `drafts/*.md` | DRAFT results. The title comes from the first heading, the time from the file date, the place from a `place:` line or from words in the file name. |
| `last-activity.json` | Written by the world whenever Wahb is active, so ICON knows the AFK loop has ended. |

## Engine API

| Request | Body | Does |
|---|---|---|
| `GET /api/state` | | The world state, mode `live` |
| `GET /api/memory` | | `memory.md` as text, this laptop only |
| `POST /api/order` | `{ "place": "campus", "text": "..." }` | Adds a queued order |
| `POST /api/answer` | `{ "id": "q1", "answer": "Thursday" }` | Records an answer |
| `POST /api/approve` | `{ "id": "file:2026-10-24-scholar-notes" }` | Records an approval |
| `POST /api/activity` | `{}` | Marks Wahb as active |

JSON bodies only, at most 64 KB. A missing file starts empty; a file that cannot be read is left untouched and the request is refused.
