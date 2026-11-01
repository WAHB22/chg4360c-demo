# Style guide: "Ink on paper", Greek mythology inspired

Chosen by Wahb from three references (kept outside the repo at
`/tmp/claude-0/-home-user-chg4360c-demo/93d5e1c3-a311-5d7d-a8fa-ade38631baab/scratchpad/refs/`, look at them before designing):
1. `1-cobalt-caryatid.jpg`: one cobalt ink on white, an engraved caryatid made of vertical hatch lines, Greek style capitals, a quiet sans for the rest.
2. `2-minos-motifs.jpg`: cream paper, hand drawn ultramarine Mediterranean motifs (Greek key, waves, olive branches, four point stars, amphorae, column capitals, tiles, pomegranates), a flared Roman display face with small wide caps under it.
3. `3-museo-parthenon.jpg`: a very large high contrast serif over the Parthenon, torn paper edges between sections, collage cut outs, muted sand, sage and peach.

The idea in one line: **a money ledger printed in one blue ink on cream paper, with a few hand drawn Greek ornaments**.
Satisfying, not overwhelming: ornaments are seasoning. Numbers and words come first.

## 1. Colour tokens (contrast checked; text pairs pass WCAG AA)
Define on `:root`, redefine for dark mode under `@media (prefers-color-scheme: dark)`.

| token | light | dark | use |
|---|---|---|---|
| --paper | #f3efe4 | #0c1330 | page background (cream paper / Aegean night) |
| --sheet | #fdfbf6 | #141d40 | raised paper sheets (hero, sheets, dialogs) |
| --ink | #141c3d | #f1ebdd | body text, numbers |
| --ultra | #1f3bcd | #9aabff | the one ink: headings, primary buttons, links, ornaments, focus ring |
| --cobalt | #1e5281 | #8db8e3 | second blue for chart areas, hatch fills, hover |
| --aegean | #0b7fa3 | #4fc6e6 | cyan accent for graphics (forecast estimate line, highlights) |
| --aegean-text | #086a88 | #4fc6e6 | cyan when used as text |
| --olive | #5a7a2e | #a8c770 | under 75% bars, paid on time, held limits |
| --olive-text | #4c6826 | #a8c770 | olive as text |
| --terra | #c9651c | #f2a05a | his orange: 75 to 100% bars, "soon" |
| --terra-text | #a24f12 | #f2a05a | orange as text |
| --pome | #b0302c | #f3867b | pomegranate red: over limit, late, below $0 |
| --stone | #5f5a4d | #a7a395 | secondary text, hints (replaces the old #a39d93 that failed contrast) |
| --rule | #d8d0bd | #27325a | hairlines, bar tracks |
| --sand | #e4dcc6 | #1b2547 | quiet fills (selected chip, table stripe) |

Rules: blue does almost everything. Olive, orange and red appear only as status. Never gradients, never glassmorphism, never coloured shadows. Shadows only on things that float (sheet, undo bar, floating buttons): `0 10px 30px rgba(20,28,61,.14)`.

## 2. Type
Google Fonts, `display=swap`, only these weights:
- **Bodoni Moda** (opsz, 400..700, italic 400): display and big numbers. Masthead "Finance", section titles, the Safe to spend number, the month name. This is the Museo voice: high contrast, large, confident. Use `font-optical-sizing: auto`.
- **Marcellus SC** (400): small Roman capitals for kickers and labels ("FIXED BILLS", "PAYDAY IN 6 DAYS", "ESTIMATE"), letter spacing .08em, 12 to 13 px. The Minos voice.
- **Instrument Sans** (400, 500, 600): everything else. Amounts use `font-variant-numeric: tabular-nums lining-nums` (check it renders tabular; if the font lacks tnum, set amounts in Bodoni Moda with lining figures instead).

Scale (390 px phone): 12 label, 14 small, 16 body, 20 row titles, 26 section titles, 34 masthead, 72 hero number (clamp(56px, 18vw, 88px)). Line height 1.45 body, 1.05 display.

## 3. Ornaments (inline SVG in `ui/motifs.js`, drawn with `currentColor`, stroke 1.5 to 2 px, slightly irregular to feel hand drawn)
`ui/motifs.js` exports functions that return SVG strings:
- `meander(width)`: Greek key band, 10 px tall, used as the rule under the masthead and between big groups. Also available as a CSS background (`.meander`).
- `waves()`: running wave scroll band, used once at the page foot and as the edge of the undo bar.
- `olive()`: small olive sprig, used in empty states and next to "paid on time".
- `star()`: four point star sparkle, used for real progress rewards only (bill paid on or before its due date, money added to a jar, a limit held to month end).
- `amphora(pct, id)`: the three tuition jars become amphorae that fill with ultramarine ink to pct, with a soft ink line at the fill level. Text in or under it stays readable in both modes.
- `column()`: engraved Ionic column drawn with vertical hatch lines (the caryatid engraving feel), placed bottom right of the hero, about 30% opacity, aria-hidden, never under text that it would make hard to read.
- `torn()`: torn paper edge (an SVG path used as the hero sheet's bottom edge, like the Museo sections).
Never use photos or third party artwork. Every ornament is aria-hidden.

## 4. Layout and components
- **Hero sheet** (top): white `--sheet` with a torn bottom edge over the cream page. Masthead "Finance" in Bodoni Moda at left, the month switcher at right (44 px arrows), status line under it in small stone text, a meander rule. Then Safe to spend: the number huge in Bodoni Moda ("$14"), then "today" in Bodoni italic, then a Marcellus SC line "PAYDAY IN 14 DAYS · ESTIMATE". The engraved column sits bottom right.
- **Month ledger** instead of four identical cards: a typographic block with hairline rules, label left in Marcellus SC, amount right in tabular figures: Earned, Bills, Spent, Bills paid. "Left this month" last and emphasised. A negative "left" is ink coloured with the word "short" rather than a red alarm at the start of the month.
- **Sections**: no boxed cards stacked forever. Each section is a title in Bodoni Moda 26 px with a Marcellus SC kicker above or a quiet hint, rows separated by hairlines (ledger lines). One meander rule between big areas, not under every title.
- **Bill rows**: a round seal style tick (44 px tap area, 24 px drawn), name, date in stone, amount right. "soon" and "late" as small Marcellus SC words in terra and pome, not pills. Ticking on or before the due date: the tick fills with ink, a star sparkles once (300 ms), the undo bar says "paid on time".
- **Limit bars**: 6 px tall rule with rounded ends; the fill uses the status colour with a faint vertical hatch (repeating-linear-gradient, 1 px lines) that echoes the engraving; "no limit" is a dotted stone line. Fill animates from 0 on first render only (600 ms, ease out).
- **Buttons**: primary = ultramarine fill, cream text, 12 px radius, 44 px min height; secondary = ink outline 1.5 px; quiet = text only in ultramarine. Press: scale .97 for 100 ms. Floating "+ Expense" is the primary button; "Import" is secondary on paper.
- **Sheets and dialogs**: `--sheet` paper, 20 px radius top corners on phone, a short meander strip as the drag handle, Bodoni title, sticky footer with the main action.
- **Undo bar**: an ink slab (`--ink` background, `--paper` text) 12 px radius, slides up 220 ms, wave band edge on top, "Deleted Costco $182.40 · Undo".
- **Forecast chart**: ink line on paper, the estimate part dashed in aegean, area under the line a light cobalt hatch, below $0 in pome with a pome zero line, dots as small ink circles with 44 px tap areas, today/payday/month end marked with small Marcellus SC labels.
- **Amphorae** for the tuition goals, three in a row, percent inside in Bodoni.
- **Not set up screen**: centred column ornament, "This device is not set up" in Bodoni, one plain line under it.
- **Empty states**: an olive sprig and one plain line.

## 5. Motion (Emil Kowalski style: fast, subtle, never in the way)
- Press: transform scale(.97), 100 ms ease out.
- Bars fill: width 600 ms cubic-bezier(.22,1,.36,1) on first render only.
- Numbers count up: the Safe to spend number and the month ledger animate from the previous value over 400 ms when they change (not on every render if unchanged).
- Undo bar and sheets slide up: 220 ms cubic-bezier(.32,.72,0,1); leave 160 ms.
- Star sparkle: scale and fade 300 ms, once.
- `prefers-reduced-motion: reduce`: all of the above off (instant).

## 6. Things that read as AI made (avoid; the Impeccable checklist)
- Rows of identical rounded cards with soft shadows; every section in a box.
- Purple or blue gradients, glass blur, glowing borders, emoji icons, sparkles used as decoration.
- A hint in every section header ("tap a line to edit"); say it once in an empty state or not at all.
- Pills for every status; tiny grey text that fails contrast; centred everything.
- Generic copy ("Your financial journey", "Let's get started!", "Oops!"). Plain words only. No dashes in UI text.
- Inter/Roboto plus a single accent colour with nothing else to say.

## 7. Accessibility
Text contrast AA in both modes (tokens above), visible focus ring 2 px ultramarine with 2 px offset, tap targets 44 px, the chart has a text summary, ornaments aria-hidden, sheets trap focus and return it.
