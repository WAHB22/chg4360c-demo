# Inside my head (30 s)

A 30-second piece about everything going on in Wahb's head at once. There are no people in it. One orange dot stands for his attention: it jumps to each new thought, then the thoughts come faster than it can keep up. At 23 s everything freezes, and the dot carries you into the close, "WAHB."

Built in Remotion with the WAHB SATISFACTION kit (`kit.tsx` and `dot.tsx` are adapted from the skill's assets).

## The content is real

Every thought on screen comes from his own material, as of Thursday 1 October 2026:

- **School:** fall 2026 courses and deadlines from the WAHB'S WORLD seed, for example CHG 3127 midterm Oct 16 (25%), CHG 4360 Assignment 1 Oct 5, GNG 4120 GA 1 Oct 3, CHG 3735 examen partiel 23 oct, and CHM 2120 Midterm 1 "yesterday".
- **Work and life:** Bobino shifts (06:15 to 14:00 on Thursdays), gym at 14:30, IRCC's 24 h limit, PGWP.
- **Projects:** Spitch, DOTS, the Bobino trailer pitch, WAHB'S WORLD phase 3, CHG 4250.
- **Claude sessions:** "read BRIEF.md fully", the four-agent debate, "Spitch, not speech", "make it not look AI", "no dashes", vercel 403.

The times are in `tools/plan.py`. Edit the `THOUGHTS` list there to change what appears.

## How it's built

| File | What it does |
|---|---|
| `tools/plan.py` | The single source of timing. It sets every thought's arrival (the gaps shrink geometrically), position, the dot's hops and every cue, and measures type with the real face for the full stops. It writes `src/plan.json`. |
| `src/Mind.tsx` | The piece: the title, the thoughts, the thread, the camera, the freeze, the dive and the end card. |
| `src/cards.tsx` | Thought objects: order ticket, exam card with stamp, terminal, mail, gym ring, rent jar, sketches (SN2, PID loop, reactor, Laplace) and display words. |
| `audio/mix.py` | Places recorded foley on the same cues, plus a synthesized pulse that speeds up, a drone, and a warm chord. It cuts to silence at the freeze and normalizes to -14 LUFS. |
| `tools/textures.py` | Film grain frames. |
| `scripts/stills.mjs`, `tools/sheet.py` | QA stills and contact sheets. |

## Rebuild

```bash
npm install
pip install numpy scipy soundfile pyloudnorm pillow
python3 tools/textures.py      # grain
python3 tools/plan.py          # timing
python3 audio/mix.py           # sound (needs audio/sfx/*.wav, included)
npm run render                 # out/inside-my-head-master.mp4
FF=node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg
$FF -i out/inside-my-head-master.mp4 -t 29.97 -c copy out/master-30.mp4    # exactly 30.00 s
$FF -i out/master-30.mp4 -c:v libx264 -preset slow -b:v 3300k -maxrate 4200k -bufsize 8000k -c:a aac -b:a 192k -movflags +faststart inside-my-head.mp4
```

## Credits

- Sound effects: Kenney Interface Sounds, Impact Sounds, RPG Audio and UI Audio (CC0), https://kenney.nl
- Fonts: Space Grotesk and Inter via Fontsource (OFL), and Liberation Serif and Mono.
- Remotion has its own license: free for individuals and companies of up to 3 people.
