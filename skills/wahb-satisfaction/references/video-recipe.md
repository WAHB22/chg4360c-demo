# Video recipe (Remotion), what produced v4

## Setup
- Remotion 4 project (React + TS). Let Remotion download its own headless shell; /opt/pw-browsers chromium fails ("Old Headless mode removed").
- ffmpeg: `node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg` (no ebur128; measure loudness with pyloudnorm). It has libx264.
- Python: numpy, scipy, soundfile, pyloudnorm, kokoro-onnx (TTS), faster-whisper (word timestamps).
- Code to reuse is in `assets/`:
  - `remotion/kit.tsx`: palette, easing curves, `p()` / `lerp()` / `pop()`, a Camera with drift and shake, SVG filters (line boil, cut-paper shadow, stamp grunge), film grain, paper background, `talkAt()`.
  - `remotion/dot.tsx`: the Dot with squash and velocity smear, bounce physics, a point-along-polyline helper, and MaskLine (type rising out of a baseline mask).
  - `remotion/Captions.tsx`: creator-style, word-by-word captions.
  - `remotion/props.tsx`: wordmark with Times Bold advance widths, pitch card, mail card, cup, bulb, coin.
  - `remotion/stills.mjs` and `sheet.py`: render chosen seconds, then build a contact sheet.
  - `audio/fit_my_voice.py`: aligns the script to a Whisper transcript, cuts long pauses inside silence with 40 ms crossfades, applies a high-pass filter and gentle compression, and writes the voice file plus `timeline.json`.
  - `audio/fx_voices.py`: swaps chosen lines for an announcer or robot TTS inside the same time slot.
  - `audio/mix_v4.py`: music, recorded sound effects on cues, voice mix, loudness normalization of the stereo array to -14 LUFS, soft limit to -1 dBFS.
  - The graphics use hard-coded coordinates (1920x1080 composition). Fonts load from `public/fonts/` (space-grotesk.woff2, inter.woff2), and `paper.jpg` and `grain0-5.png` go in `public/` (generate them as in kit comments).

## Process
1. **Voice first. Timings drive everything.**
   - Use his recording. Transcribe it with `faster-whisper small.en` and `word_timestamps=True`.
   - Align the transcript to the exact script with difflib. Whisper mishears words ("Pictures" for "Pitchers"), so captions use the script text with Whisper's timings.
   - Only shorten pauses longer than about 0.75 s, and keep dramatic ones. Start the voice at 1.0 s, after the intro card.
2. **Choose one concept** (for example the dot) and write a scene table: every scene start and end, and every motion cue, as `W(lineId, wordIndex)`. Never hard-code seconds.
3. **Build the scenes.** Draw on twos (`t2`) and move the camera on ones. Keep content in the top two-thirds, because captions sit at the bottom.
4. **QA stills** at 15 to 30 timestamps, then a contact sheet. Look for:
   - overlaps and elements running off the frame;
   - the same colour on top of itself (orange on orange);
   - things hidden too early;
   - text colliding with captions;
   - smears that are too long.
   
   Fix them and re-check.
5. **Audio.**
   - Music is synthesized and sits 13 to 14 dB under the voice. It cuts on the final word, with a riser before the reveal.
   - Sound effects are real samples, placed on the same cue times as the visuals: taps, slides, whooshes, stamps, dings, coins.
   - Pitch ticks upward for climbs.
   - Measure effect levels against the voice so they stay under it.
6. **Render:**
   - `npx remotion render src/index.ts <Comp> out/x.mp4 --codec h264 --crf 18 --audio-bitrate 320k --concurrency=4`, which takes about 5 to 6 minutes for 60 s with filters.
   - Trim to exactly 60.00 s with `-t 59.97 -c copy`, because AAC padding otherwise gives 60.05 s.
   - Make a share copy: `-c:v libx264 -preset slow -b:v 3300k -maxrate 4200k -bufsize 8000k -c:a aac -b:a 192k -movflags +faststart`, about 25 MB.
7. **Check the final file**: pull frames from the MP4 itself with ffmpeg, and ffprobe the duration and streams. Then send it.

## Craft rules that made it look human
- One protagonist with physics: anticipation before a jump, squash on impact, stretch along velocity, overshoot only after momentum.
- Type is revealed by masks from the baseline, not fades. Use tight negative tracking at display sizes and set it off-centre.
- Texture everywhere, quietly:
  - grain overlay at about 0.16;
  - vignette;
  - paper texture;
  - hard offset shadows (cut paper);
  - a subtle line boil (feTurbulence with a new seed every 3 frames).
- Handheld camera drift plus shake on impacts. Whip pans with blur between scenes.
- Callbacks: earlier objects return (the grey dot, the rejection mail, the ROUGH stamp) when he says "I live this problem".
- Product truth: the phone and cards copy the real site's cards, fonts and colours.
- Deterministic randomness (`rnd(i)`) so renders are stable.
