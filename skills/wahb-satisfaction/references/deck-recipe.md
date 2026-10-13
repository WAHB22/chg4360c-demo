# Recipe: pitch decks and client presentations

Learned on a long client pitch deck (a food-trailer proposal for a local brand's owners). The client stays confidential: do not name them in any repo.

## What he wants to receive

- **Three formats from one source:** an editable HTML deck (the master), a PowerPoint he can import into Canva, and a PDF. Plus a plain-text version he can paste into another chat.
- **One generator, not hand-edited files.** Keep a Python script that holds the slides as data and renders all three outputs. Every change goes through it, so the formats never drift apart.
- **The HTML is a tool, not a picture:**
  - edit mode (E), speaker notes (N), fullscreen (F), print;
  - a sommaire (S or click the page number) and clickable jumps;
  - « Exporter HTML » that keeps every edit, photo and crop, even on another computer.
- **Photo frames work like Canva.** Click or drop any photo; it fills the frame whatever its size, without stretching. Drag to reframe, wheel to zoom, double-click to show the whole photo, move and resize the frame, add new frames.
- **Clickable links everywhere they make sense:** Instagram accounts, reels, QR codes. They must work in the HTML, the PowerPoint and the PDF.

## How the story must flow

- Pages are numbered (« 07 / 17 ») and grouped into a few named chapters, with an agenda page near the start that shows the road and the page range of each chapter.
- Each page footer shows where you are (chapter pills), what comes next (« ensuite : … ») and the page number.
- Annexes are numbered (A1, A2…). Link each one from the page that mentions it, with a « ‹ retour » that goes back to where you were.
- Speaker notes end with the sentence that carries you to the next page.
- Main slides tell a confident story; detail and sources go to the annex.

## Tone and content rules he gave

- Write in the language he asks for, in its local variety (here: Québec French). No em or en dashes anywhere.
- Every idea, number and partner is presented as a suggestion to decide together, yet the tone stays confident. No placeholders, no « imaginé », no « à compléter » in a finished deck.
- Use the client's brand system exactly (fonts, colors, mascots, tags). A mascot's signature shape is branding: when he asks to remove a detail, remove only that detail and keep the shape.
- **No AI-style icons** (money bag, camera, flag). Use the brand's own drawings, characters and scenes instead.
- No invented photos of real things (equipment, people). Use his real photos, the brand's own art, or ask. Drawn scenes from the brand's world are welcome.
- Photos must be well framed: make dedicated crops instead of letting a random center crop cut faces or subjects.

## Process that worked

- **« Save as next adjustment, don't render »** means: write the change list to a file (for example `ajustements-a-venir.md`) and touch nothing else until he says go.
- Back up the generator before every big version (v3, v4, v5), and apply each version as a scripted patch.
- **Verify like a viewer:**
  - screenshot every slide and look at contact sheets;
  - flag text taller than its box and anything colliding with the footer;
  - test at laptop sizes too (1440×810, 1280×720), not only 1920×1080. The deck once rendered shifted and cut off on every laptop because of grid centering;
  - script the interactions in Playwright (drop a file, pan, zoom, fit, move, resize, add, reload, export, jumps, back);
  - convert the PowerPoint to PDF with LibreOffice and compare with the HTML PDF;
  - check the PDF links with PyMuPDF.
- Check glyphs against the font: an arrow like ↩ is missing from Poppins and shows as a box in PowerPoint and Canva.
- Keep confidential client work out of git (`.git/info/exclude`) and out of public artifacts. Send the files directly.
