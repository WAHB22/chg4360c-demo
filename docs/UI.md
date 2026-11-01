# UI contract (build A)

Read docs/SPEC.md first. This file fixes how the page is split so feature modules can be written in parallel.
The look is decided: follow docs/STYLE.md ("Ink on paper", Greek mythology inspired) for every colour, font, ornament, component and motion.
Phone first at 390 px wide, light and dark mode via prefers-color-scheme, tap targets at least 44 px, visible focus, no layout shift,
`prefers-reduced-motion: reduce` turns motion off. `ui/motifs.js` (owned by core) holds the SVG ornaments; feature modules import from it.

## Files and ownership
| file | owner | contents |
|---|---|---|
| index.html | core | shell only: meta, fonts, `<link>` to every ui/*.css, mount points, `<script type="module" src="ui/app.js">` |
| ui/app.js, ui/app.css | core | boot, sync, device key, existing sections, forms, sheet, undo bar, month nav, backup download/restore |
| ui/import.js/.css | import | Import button, drag and drop, file reading, review sheet |
| ui/history.js/.css | history | History screen |
| ui/safe.js/.css | safe | Safe to spend today |
| ui/cover.js/.css | cover | Cover it and raise suggestions |
| ui/forecast.js/.css | forecast | Chequing forecast chart |
| scripts/e2e.mjs | core | runner: starts dev server, runs every tests/e2e/*.e2e.mjs in name order |
| tests/e2e/<name>.e2e.mjs | each owner | `export default async function ({ page, base, shot, step, assert, freshPage }) {}` |

Feature modules export `export function mount(app) {}` and nothing touches files owned by others.
`ui/app.js` imports every feature module and calls `mount(app)` once after the first successful load (in this order: safe, forecast, cover, import, history). A feature module that throws in mount must not break the page (core wraps each mount in try/catch and logs it).

## Mount points in index.html (core creates them, features fill them)
- `<div id="safe"></div>` directly under the header and status line (Stage 3).
- `<section id="forecast" hidden></section>` after the stat cards (Stage 5). Forecast removes `hidden` when it renders.
- The floating buttons at the bottom right: `<div class="fabs"><span id="import-slot"></span><button class="fab" id="fab">+ Expense</button></div>`. Import puts its "Import" button in `#import-slot` (left of + Expense) and listens for drag and drop on the whole page.
- `<span id="history-slot"></span>` in the footer next to Download backup / Restore backup.
- In each budget bar row core renders `<div class="cover-slot" data-item="<itemId>"></div>` (empty, under the bar) for every item. Cover fills the slots that need it on every render.

## The app object (core passes it to mount)
```
app.state                      // getter: current state (v2). Read only: never mutate outside app.act.
app.today()                    // 'YYYY-MM-DD' (honours ?today= on localhost only)
app.month()                    // viewed month key 'YYYY-MM'
app.setMonth(key)
app.act(label, mutate, { undo = true } = {}) // runs mutate(draft), saves, re-renders, shows the undo bar "label · Undo" for 8 s. Returns the action.
app.restore(doc, label)        // replace everything with doc as one undoable action (undo bar shown)
app.render()                   // re-render everything (core sections, then every 'render' listener)
app.on(event, fn)              // events: 'render' (after each render, fn(app)), 'synced' (after a successful save, fn(savedAt))
app.api(path, init)            // fetch with the x-app-key header and JSON helpers: returns {ok, status, json}; never throws on HTTP errors; throws only offline
app.form({ title, fields, submit = 'Save', onSave, onDelete }) // the existing dialog form (fields like the original openDlg). onDelete has no confirm: it runs at once and the undo bar offers Undo
app.sheet({ title, body, onMount, actions, wide }) // bottom sheet on phone, centred panel on laptop. body: HTML string or Node. actions: [{label, primary, disabled, onClick}] in a sticky footer. Returns {el, close, setBody(html|Node), setActions(list)}
app.toast(text)                // the undo bar without Undo, 4 s
app.status(text)               // status line under the header
app.openExpense(tx?) app.openPay(pay?) app.openAccount(accountId) // open the core forms (used by safe and forecast prompts)
app.lib                        // { core, money, budget, forecast, merchants, csv, importer, labels, migrate } module namespaces
```
Everything a feature module shows that is computed (amounts, dates, percentages) comes from lib functions, never ad hoc math in UI code.

## Text and behaviour rules for every UI file
- No dashes in any UI text. Plain words, sentence case. Amounts with `fmtShort` or `fmt`, dates with `shortDate`.
- Every estimate shows the word "estimate" next to it.
- No confirm() or alert() anywhere. Every change is immediate and undoable.
- Rewards only for real progress: a bill ticked on or before its due date says "paid on time" in the undo bar text and the tick does a small check animation; money added to a jar animates the fill; past months show a small "held" mark on limits that ended the month under their limit. Nothing for plain taps.
- All user facing strings escaped with `esc` when put into HTML.
