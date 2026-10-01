"""The single source of truth for timing: every thought, every hop of the dot, every cue.
Writes src/plan.json, read by the video (src/) and by the mix (audio/mix.py)."""
import json, math, random

FPS = 30
DUR = 30.0
CUE = {
    "titleIn": 0.25,      # "inside my head" rises
    "dotDrop": 1.05,      # the dot drops in as the period
    "titleOut": 2.45,     # whip away, the first thought lands
    "chaos": 15.2,        # the dot can no longer keep up
    "zoomOut": 18.6,      # camera pulls back: it is bigger than the frame
    "freeze": 23.0,       # everything stops. silence.
    "line1": 23.45,       # "it's all happening at once."
    "line2": 24.95,       # "and I still show up at 06:15."
    "pushIn": 26.55,      # camera dives into the dot
    "wahb": 27.35,        # WAHB rises
    "land": 28.05,        # the dot lands as the period, the shift bell
    "fade": 29.55,
}

# Every thought is real: fall 2026 schedule, deadlines, projects and Claude sessions (wahbs-world seed data,
# the Spitch repo and the wahb-satisfaction memory). Today is Thursday 1 October 2026.
# kind: ticket | ring | stamp | term | card | word | mail | sketch | jar
THOUGHTS = [
    ("ticket", ["BOBINO BAGEL", "shift", "06:15 to 14:00"]),
    ("ring", ["GYM", "14:30"]),
    ("stamp", ["CHG 3127", "Midterm", "Oct 16", "25%"]),
    ("term", ["> read BRIEF.md fully", "Claude is thinking"]),
    ("card", ["CHG 4360", "Assignment 1", "due Oct 5"]),
    ("word", ["SPITCH."]),
    ("card", ["GNG 4120", "GA 1: business", "conceptualization, Oct 3"]),
    ("mail", ["Thank you for your application"]),
    ("card", ["Summer 2027", "internship", "priority one"]),
    ("sketch", ["SN1 or SN2?", "mol"]),
    ("card", ["CHG 3735", "Examen partiel", "23 oct"]),
    ("sketch", ["PID tuning", "pid"]),
    ("card", ["IRCC", "24 h a week", "off campus, max"]),
    ("jar", ["rent"]),
    ("word", ["DOTS?"]),
    ("term", ["> four agents:", "supporter, critic,", "improver, gatekeeper"]),
    ("card", ["LinkedIn", "rewrite the headline"]),
    ("word", ["résumé"]),
    ("card", ["WAHB'S WORLD", "Phase 3", "School, Work, Money"]),
    ("card", ["CHM 2120", "Midterm 1", "yesterday"]),
    ("word", ["no dashes."]),
    ("sketch", ["L{f(t)} = F(s)", "lap"]),
    ("card", ["CHG 3337", "Quiz 3", "Oct 7"]),
    ("ticket", ["BOBINO", "trailer pitch", "Aurélie and Alex?"]),
    ("word", ["sleep?"]),
    ("term", ["> Spitch, not speech", "> Wahb: one syllable"]),
    ("card", ["CHG 4250", "propose an", "industry project?"]),
    ("sketch", ["conversion X = ?", "rx"]),
    ("word", ["$5 coffee"]),
    ("card", ["Morocco", "5 h ahead"]),
    ("card", ["reading week", "Oct 25"]),
    ("term", ["$ npm run build", "$ git push"]),
    ("word", ["Space Grotesk or Inter?"]),
    ("card", ["PGWP", "check eligibility"]),
    ("card", ["10 target companies", "Summer 2027"]),
    ("word", ["Supabase keys"]),
    ("term", ["> make it not look AI"]),
    ("ticket", ["UGLY MONDAY", "café", "opening"]),
    ("card", ["CHG 4360", "Assignment 2", "Oct 19"]),
    ("word", ["groceries"]),
    ("card", ["PD A", "business modelling", "Oct 12"]),
    ("card", ["two minute", "project story"]),
    ("word", ["focus."]),
    ("term", ["vercel: 403"]),
    ("word", ["wait, what was I doing"]),
    ("card", ["GA 7", "final pitch deck", "Nov 28"]),
    ("word", ["Laplace"]),
    ("card", ["CHG 3337", "Midterm", "Oct 21"]),
]

SIZE = {"ticket": (300, 210), "ring": (230, 230), "stamp": (330, 220), "term": (470, 150), "card": (330, 190),
        "word": (0, 90), "mail": (430, 110), "sketch": (300, 230), "jar": (190, 250)}

rnd = random.Random(4)

# Type measurements with the real face (Liberation Serif Bold = Times New Roman Bold metrics).
from PIL import ImageFont
SERIF_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
def adv(text, size, tracking=-0.02):
    f = ImageFont.truetype(SERIF_BOLD, 1000)
    return f.getlength(text) * size / 1000 + tracking * size * len(text)
def period_after(text, x0, baseline, size, r):
    """Where the dot sits as the full stop after `text` set at x0 (start-anchored)."""
    return {"x": round(x0 + adv(text, size) + size * 0.035 + r, 1), "y": round(baseline - r - size * 0.005, 1), "r": r}
LAYOUT = {
    "title": {"text": "inside my head", "x": 210, "y": 610, "size": 168},
    "end": {"text": "WAHB", "x": 0, "y": 640, "size": 300},
}
LAYOUT["title"]["words"] = [{"text": w, "x": round(210 + adv(" ".join("inside my head".split()[:i]) + (" " if i else ""), 168), 1)} for i, w in enumerate("inside my head".split())]
LAYOUT["title"]["dot"] = period_after("inside my head", 210, 610, 168, 19)
endw = adv("WAHB", 300)
LAYOUT["end"]["x"] = round(960 - (endw + 300 * 0.035 + 2 * 33) / 2)
LAYOUT["end"]["dot"] = period_after("WAHB", LAYOUT["end"]["x"], 640, 300, 33)

# Arrival times: the gaps shrink geometrically, so the thoughts come faster and faster.
times, t, gap = [], 2.62, 0.72
while len(times) < len(THOUGHTS):
    times.append(round(t, 3)); t += gap; gap = max(0.12, gap * 0.9657)
assert times[-1] < CUE["zoomOut"] + 1.3, times[-1]

def wsize(kind, lines):
    w, h = SIZE[kind]
    if kind == "word":
        fs = 84 if len(lines[0]) <= 12 else 60
        w, h = adv(lines[0], fs) + 40, fs * 1.2
    return w, h

# Positions: the first ones spread out so each can be read, later ones land anywhere, on top of each other.
placed, thoughts = [], []
for i, ((kind, lines), ta) in enumerate(zip(THOUGHTS, times)):
    w, h = wsize(kind, lines)
    best, bd = None, -1
    tries = 60 if i < 16 else 4
    for _ in range(tries):
        x = rnd.uniform(110 + w / 2, 1810 - w / 2)
        y = rnd.uniform(110 + h / 2, 930 - h / 2)
        d = min([math.hypot(x - px, (y - py) * 1.5) for px, py in placed[-14:]] or [9999])
        if d > bd: best, bd = (x, y), d
    x, y = best
    placed.append((x, y))
    thoughts.append({"i": i, "kind": kind, "lines": lines, "t": ta, "x": round(x), "y": round(y),
                     "w": round(w), "h": round(h), "fs": (84 if len(lines[0]) <= 12 else 60) if kind == "word" else 0, "rot": round(rnd.uniform(-7, 7), 2)})

# Background field: revealed by the zoom out. Same real thoughts, small, far beyond the frame.
bg = []
for j in range(150):
    while True:
        x, y = rnd.uniform(-1700, 3600), rnd.uniform(-1050, 2150)
        if not (-60 < x < 1980 and -60 < y < 1140): break
    src = THOUGHTS[j % len(THOUGHTS)]
    dist = math.hypot(x - 960, (y - 540) * 1.6)
    ta = CUE["zoomOut"] - 0.6 + min(4.0, dist / 1100) + rnd.uniform(-0.25, 0.25)
    bg.append({"kind": "card" if src[0] not in ("word", "term") else src[0], "lines": src[1][:2], "t": round(ta, 3),
               "x": round(x), "y": round(y), "rot": round(rnd.uniform(-9, 9), 2), "s": round(rnd.uniform(0.8, 1.25), 2)})

# The dot's hops. Before "chaos" it answers every new thought; after, it ricochets everywhere it can.
hops = [{"t": CUE["titleOut"] - 0.05, "x": LAYOUT["title"]["dot"]["x"], "y": LAYOUT["title"]["dot"]["y"]}]
for th in thoughts:
    if th["t"] < CUE["chaos"]:
        hops.append({"t": round(th["t"] + 0.1, 3), "x": th["x"], "y": th["y"] - th["h"] * 0.18, "to": th["i"]})
tt = max(CUE["chaos"], hops[-1]["t"] + 0.1)
while tt < CUE["freeze"] - 0.05:
    pool = [th for th in thoughts if th["t"] < tt] + [b for b in bg if b["t"] < tt and tt > CUE["zoomOut"] + 0.8]
    tgt = rnd.choice(pool[-30:] if tt < CUE["zoomOut"] else pool)
    hops.append({"t": round(tt, 3), "x": tgt["x"], "y": tgt["y"]})
    tt += rnd.uniform(0.09, 0.15) if tt < CUE["zoomOut"] else rnd.uniform(0.07, 0.11)

json.dump({"fps": FPS, "dur": DUR, "cue": CUE, "layout": LAYOUT, "thoughts": thoughts, "bg": bg, "hops": hops},
          open("src/plan.json", "w"), indent=1, ensure_ascii=False)
print(len(thoughts), "thoughts, last at", thoughts[-1]["t"], "|", len(bg), "background |", len(hops), "hops")
