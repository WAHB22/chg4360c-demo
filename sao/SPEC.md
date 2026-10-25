# SAO build spec (v1, from the SAO World Bible)

A calm, painted valley world where Wahb's real life is quietly taken care of. Frieren's painted look, a Sword Art Online style floating interface with Frieren's warm materials, a found family of 7 core bots, gentle growth tracking. Everything original: no characters, named places, logos or scenes from any show. Decisions: option A on all 27 bible questions (real buildings painted in the soft anime style, the Rideau Canal with its slim white footbridge as the river between the two halves, uOttawa's red lamp posts on campus).

## Hard rules
* Static site, no build step, no frameworks, no CDN at runtime. Plain ES modules in `public/js`, CSS in `public/css`. Must work by opening the Vercel deployment and by `node server.mjs` locally.
* No personal data in the repo or the deployment: `public/demo/state.json` holds invented, generic demo content only. Live data comes only from the local engine on Wahb's machine.
* Typeface: Times New Roman, then Georgia, then serif. No web fonts.
* No red anywhere, no pure black, no neon. No emojis. No dashes in visible text (no em dash, no en dash, no spaced hyphen). Canadian spelling, 24 h times ("14:05"), dates like "Mon Nov 2", digits for numbers.
* Must not look AI made: no generic glowing cards on gradients, no purple or blue AI gradients, no evenly eased motion everywhere, no three equal feature cards, no eyebrow labels on everything. Painterly, hand made, deliberate.
* `prefers-reduced-motion`: every effect becomes a 200 ms fade or a static state. Keyboard reach for every control, visible 2 px gold focus ring, tap targets at least 44 px, text at least 4.5:1 on its real backing. Color is never the only signal.
* No horizontal scroll at any width. Phone gutter 16 px.

## Files and owners
| File | Owner | Purpose |
|---|---|---|
| `public/js/places.js`, `public/js/bots.js` | shared, do not change shapes | place and bot data |
| `public/js/clock.js` | scene | real Toronto clock, period, season, quiet hours, weather |
| `public/js/scene.js` | scene | painted placeholder for each place as SVG |
| `public/js/vista.js` | scene | the vista: image or placeholder, parallax, grade, weather, lights |
| `public/js/characters.js` | characters | ICON and bot sprites (SVG), walking crowd on the vista |
| `public/js/map.js` | map | parchment map (SVG), travel, bot dots, trailer wagon |
| `public/js/data.js` | engine | state loading (local engine, same origin, demo), actions |
| `public/js/ui/*.js`, `public/js/main.js`, `public/index.html`, `public/css/*.css` | ui | the whole interface and the wiring |
| `server.mjs`, `package.json`, `vercel.json`, `README.md`, `public/demo/state.json`, `public/assets/**/README.md` | engine | local engine, deploy config, demo data |

## Module contracts (exact)
```js
// clock.js
export function now()                       // Date in real time (supports ?at=ISO override)
export function period(date?)               // 'morning' (5:00 to 9:00) | 'day' (9:00 to 17:00) | 'sunset' (17:00 to 20:00) | 'night'; ?time= override
export function season(date?)               // 'spring' | 'summer' | 'autumn' | 'winter' (Toronto; Dec to Feb winter); ?season= override
export function isQuiet(date?, shifts?)     // true 22:00 to 7:00 Toronto, or during a shift [{day:'Wed',start:'06:30',end:'14:00'}]
export function fmtTime(date?)              // '22:40' (Toronto)
export function fmtDate(date?)              // 'Sat Oct 24'
export async function weather()             // {kind:'clear'|'clouds'|'rain'|'snow'|'fog', tempC, label:'Light rain'} | null; Open-Meteo for Ottawa, cached 20 min in localStorage; ?weather= override; never throws
export function onTick(cb)                  // calls cb() each minute

// scene.js
export function paintPlace(placeId, {time, season, weather, width:1600, height:900}) // returns an SVG string, painted placeholder

// vista.js
export function mountVista(el, {onPlaceTap})           // el is the vista container
export function showPlace(placeId, {instant})          // travel transition (1.3 s, reduced motion 200 ms fade)
export function setAmbience({time, season, weather, quiet}) // updates grade, particles, lights
export function crowdLayer()                           // returns the DOM element where characters.js draws bots
export function subjectRect()                          // pixel rect of the current place subject (for hit testing)

// characters.js
export function spriteSVG(id, {state, size})           // id 'icon' or a core bot id; returns an SVG string
export function mountCrowd(layerEl, {onBotTap})        // bots walk along PLACE[id].path (percent coords)
export function setScene(placeId, bots, {quiet, reduced}) // bots: state.bots filtered to this place; ICON stands in town

// map.js
export function mountMap(el, {onTravel, onBotTap})
export function updateMap(state, {current})            // places status lanterns, bot dots, trailer wagon position

// data.js
export async function loadState()                      // {state, source:'engine'|'demo', error?}
export async function sendOrder({place, text})         // {ok, saved:'engine'|'local'}
export async function answerQuestion(id, answer)
export async function approve(id)
export function pingActivity()                         // fire and forget
export function onState(cb)                            // polling every 30 s when source is engine
```

## State shape (`/api/state` and `public/demo/state.json`)
```json
{
  "mode": "demo",
  "generatedAt": "2026-10-24T22:40:00-04:00",
  "owner": { "name": "Wahb", "phase": "Autumn term" },
  "quiet": { "nightStart": "22:00", "nightEnd": "07:00", "shifts": [ { "day": "Wed", "start": "06:30", "end": "14:00" } ] },
  "weekMeter": { "percent": 72, "missing": [], "fills": [ "Shifts 24 h", "Classes 9 h", "Study 12 h" ] },
  "places": { "campus": { "status": "active", "note": "", "drafts": [ { "id": "d1", "title": "", "time": "", "kind": "study" } ], "progress": [ { "label": "", "value": "" } ] } },
  "bots": [ { "id": "b1", "core": "scholar", "name": "Scholar", "state": "working", "place": "campus", "task": "", "model": "Claude", "startedAt": "14:05", "lastResult": "" } ],
  "questions": [ { "id": "q1", "from": "scholar", "place": "campus", "text": "", "options": [ "Tuesday", "Thursday" ], "guess": 0, "askedAt": "" } ],
  "report": { "at": "Sat Oct 24 22:40", "done": [ { "text": "", "bot": "scout", "model": "Claude" } ], "needsMe": [ { "text": "", "link": "q1" } ], "nextPaths": [ "" ], "notChecked": [ "" ] },
  "brief": { "date": "Sat Oct 24", "today": [ "" ], "due": [ { "item": "", "date": "Mon Nov 2", "daysLeft": 9 } ], "news": [ { "text": "", "project": "trailer" } ] },
  "floors": { "term": [ { "n": 1, "title": "Term started", "date": "Sep 3", "status": "cleared", "boss": false } ], "internship": [], "trailer": [] },
  "memoryTree": [ { "title": "", "date": "" } ],
  "growth": { "gym": { "done": 2, "target": 3 }, "classes": { "done": 4, "target": 6 }, "meals": { "done": 1, "target": 2 }, "sprouts": 1 },
  "trailer": { "stage": "pitch", "at": "bobino" },
  "rules": [ "No sending without your approval", "Money stays local", "No inventing facts", "No dashes", "Quiet hours 22:00 to 7:00 and during shifts", "Max 3 questions at once" ]
}
```
Everything may be missing: the UI shows the bible's empty states (Part 9.19), never crashes.

## Layout
* Laptop (over 1024 px): vista 60 percent height on top, parchment map 40 percent below. Status block top left, time and weather tag top right, round icon menu column on the right edge, caption card bottom left of the vista, place panel slides in from the right (400 px).
* Tablet (600 to 1024 px): same, menu as a row top right, panels 360 px.
* Phone (under 600 px): vista full screen, three round buttons at the bottom (Map, Menu, ICON), map as a full screen bottom sheet, panels as bottom sheets (60 percent, drag to full).

## Design tokens (UI)
glass `#1B2230` at 85 percent with 12 px backdrop blur; glass strong `#141A26` at 92 percent; edge `#E8C88E` at 60 percent, 1 px; text `#F3EFE6`; text soft `#B9C2CF`; gold `#E8C88E`; meter low `#9CC47E`, mid `#E8C88E`, high `#E9A86B`, unknown `#9AA3AF`. Type 13, 15, 18, 22, 28 px; line height 1.5 body, 1.2 titles; bold only for report section names. Spacing 4, 8, 12, 16, 24, 32, 48. Radius 10 panels, 8 cards, 999 pills. Shadows soft only: 0 8px 24px at 30 percent navy.

## Motion (Part 9.14)
Panel open 260 ms ease out (slide 24 px plus fade), close 200 ms; menu icons 180 ms each, 40 ms stagger; system message 200 ms in, 3 s hold, 400 ms out, max 1 at a time; question answered 220 ms; floor cleared 900 ms; bot walk 15 to 25 s with a slight bob; idle loops every 4 to 8 s; clouds 40 to 70 s per pass; lamp glow pulse 3 to 5 s (sunset and night only); time of day change 2 to 3 s; status block fades to 40 percent after 5 s idle.

## Quiet hours
22:00 to 7:00 and during shifts: no questions, no system messages, no sound; bots at half speed, finished bots nap; lights dim, windows go dark one by one; a small moon tag "Quiet hours until 7:00".

## Images
`public/assets/places/<place>-<time>.webp` (for example `bobino-sunset.webp`), 16:9, at least 2400 px wide. When a file exists it replaces the code placeholder; otherwise the placeholder shows with a small tag "Painting coming". Logos go in `public/assets/logos/<place>.png` and appear on the sign plate; until then an empty plate with a faint label.
