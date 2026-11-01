# Style guide: Greek mythology inspired (for Stage 6 of both prompts)

Built from his 3 references (`refs.html`: Welcome to Greece, Minos elements, Museo) and 4 research loops on palette, motifs, myth meets money and motion. Preview: `style-guide-preview.html`.

## Feel
One ink on cream paper, like an engraved museum print. Calm, generous space, one big number per screen. Mythology lives in the drawings, never in the labels.

## Colour tokens (measured from his images, contrast on cream checked)
| Token | Hex | Use |
|---|---|---|
| ink | #1B33B2 | text, lines, icons, buttons (8.5:1 on paper) |
| ink-2 | #4055BB | secondary text, illustration fills (5.7:1) |
| aegean | #2E6694 | optional softer ink (5.3:1) |
| paper | #F3F0E4 | page background, with 3% paper noise |
| white | #FFFFFF | sheets and dialogs only, never stacked page cards |
| sand | #D0CBAD | section band (near-black text 10.4:1) |
| sage | #A2B3A1 | section band (7.7:1) |
| scroll | #E1C7B8 | forecast strip, import sheet |
| stone | #9D755B | rare accent, never text |
| text | #1C1C1A | body text |
| text-2 | #4A4A45 | notes, amounts in rows (7.8:1) |
| text-3 | #6B6A62 | small print, paid rows (4.8:1). Nothing lighter for text. |
| olive / ochre / terracotta | #3F7D4F / #A8700F / #A33B2A | limit bars under 75% / 75 to 100% / over (all at least 3:1 on paper). Never the bright orange #C78A16 (2.6:1). |
Dark mode: paper becomes #10163A (deep ink night), ink and text become #E9E4D2, cards #18204A; status hues lightened 15% and rechecked for 3:1. The preview shows light mode only; build dark mode from these tokens and screenshot both.

## Layout (what makes it feel like his references, not a template)
- Sections sit on full width colour bands (paper, sand, sage, scroll) with a torn paper top edge, like the Museo site. No stack of white bordered cards with rounded corners: that is the look of every AI made dashboard.
- Home screen: safe to spend is the hero, a Bodoni number about 96 px on paper, with one engraved temple bleeding off the right edge, like the Welcome to Greece poster. The engraving is a vertical line screen in ink: thin lines where light hits, thick lines in shadow. The preview draws it from code as a stand in; the build can use a Met Open Access photo turned into the same line screen at build time.
- Band order on the home screen: hero (paper) → spending limits (sand) → bills (paper) → tuition jars (sage) → forecast (scroll).
- Text on bands: on sand and scroll, body text #1C1C1A and text-2 are fine; on sage, small text must be #1C1C1A (ink is 4.4:1 there, so ink only for headings 24 px and up, icons and jar fills). Bar tracks on a band use the paper colour so the fill contrast stays as measured.

## Type
- Headings: Bodoni Moda (Google Fonts, OFL), 500 to 700.
- Body and all numbers: Inter, tabular numbers on.
- Labels: Inter 11 to 12 px uppercase, letter-spacing 0.14 to 0.16em, ink colour.
- Wordmark: a custom angular SVG "FINANCE" (straight strokes, C drawn as "<"), used once in the header. No paid Greek display font.
- Never: Cinzel, Trajan, Papyrus, Greek letters as fake Latin.

## Motifs (original single-ink SVG line art, 1.6 px strokes, round caps, slightly hand-imperfect, `currentColor`)
amphora (tuition jars), Ionic column (bills: filled = paid, outline = unpaid), olive branch and wreath (real wins only), owl coin (safe to spend), waves and the Fates' thread (forecast line), four-point star (highlights), arch window (empty states), pomegranate (groceries), Greek key meander (dividers and limit bar texture).
- Never trace the Minos pack (paid). Real ancient art only from the Met Open Access (CC0, check the Open Access icon), credited in CREDITS.md. Example: Panathenaic prize amphora https://www.metmuseum.org/art/collection/search/254862.
- One engraved photo at most (vertical line screen in ink, pre-rendered at build time), at most two torn paper edges per page.

## Myth meets money (plain labels always)
| Feature | Drawing | Optional one-line story (off after the first week) |
|---|---|---|
| Tuition jars | Panathenaic prize amphorae that fill with ink | "Winners at the Panathenaic games took home an amphora of olive oil." |
| Forecast | One spun thread, lowest point marked, future part dotted | "Lachesis measured the thread. This one measures your month." |
| Safe to spend | Owl coin holding the number | "Athenians called their coins owls." |
| Bills | Ionic columns | |
| Cover it | Two amphorae pouring | |
| Import review | A scroll that unrolls | |
| Real wins | Olive wreath drawn once | |

## Motion (Emil Kowalski rules)
transform and opacity only; 200 ms ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; press `scale(0.97)` 100 to 160 ms; nothing he triggers over 300 ms except sheets (up to 500 ms, `cubic-bezier(0.32, 0.72, 0, 1)`). Signature moments: ink draw-on once a day (max 3 to 5 short paths, iPhone performance), safe-to-spend count-up 400 ms, meander bar fill 300 ms, column fills when paid, amphora rises when saving 500 ms, olive wreath for real wins only, pour for Cover it, scroll unroll for import. Reduced motion: no movement, keep opacity fades under 200 ms and the filled states. Hover only under `@media (hover: hover)`.

## 21st.dev
B uses components directly (number ticker, bottom sheet, toast, text reveal), recoloured to these tokens; A rebuilds the same behaviours by hand. In both: no gradients, glow or glassmorphism left from the original components.

## Done when (look)
- Impeccable audit passes with no "AI made" flags; no screen is a stack of bordered white cards; a 390 px screenshot of each screen reads as one-ink print on paper next to the 3 references.
- Every text colour pair passes 4.5:1 (body) or 3:1 (large text, bars, icons).
- No emoji, no marble, no gold, no god names on buttons; CREDITS.md lists every image used.

## Sources (the research behind this guide)
- Ancient art and licence: Met Open Access image policy https://www.metmuseum.org/pt/policies/image-resources · Panathenaic prize amphora https://www.metmuseum.org/art/collection/search/254862 · second Met object used for motifs https://metmuseum.org/art/collection/search/373996
- Myth meets money: Panathenaic amphorae as prizes https://livescience.com/archaeology/panathenaic-prize-amphora-a-pot-brimming-with-olive-oil-awarded-at-the-ancient-greek-olympics · Athenian owl coins https://coinweek.com/ancient-coins/coin-profile-the-owl-of-athena-circa-449-413-bc-silver-tetradrachm/ · Greek myths text (public domain) https://www.gutenberg.org/ebooks/59946
- Type: clichés to avoid https://app.uxcel.com/lessons/selecting-typefaces-611/avoid-clichs-3961 · Didone alternatives (Bodoni Moda) https://fontalternatives.com/alternatives/didot/for/display/ · paid Greek display font not used https://pixelbuddha.net/fonts/9215-greek-odyssey-greek-style-display-font
- Engraved look: CSS blend modes for one ink images https://cloudfour.com/thinks/the-power-of-css-blend-modes/ · meander generator https://pypi.org/project/greek-meander/
- Motion: Emil Kowalski animation rules https://agent-skills.md/skills/pproenca/dot-skills/emilkowal-animations · reduced motion https://design.verdigris.co/categories/animation/reduced-motion · SVG stroke animation cost on iPhone https://gsap.com/community/forums/topic/8821-poor-performance-on-mobile-safari-both-ipad-and-iphone-when-animating-svg-paths-stroke-dashoffset/
- 21st.dev number ticker https://21st.dev/@21st/components/number-ticker
