"""Sound for "inside my head": every cue comes from src/plan.json, the same timings the picture uses.
Foley is recorded (Kenney, CC0). The pulse, the drone and the warm chord are synthesized here.
No narration: this piece is carried by type, foley and one rising pulse. Writes public/mix.wav at -14 LUFS."""
import json, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter, sosfilt, resample_poly

SR = 48000
P = json.load(open("src/plan.json"))
C, TH, HOPS = P["cue"], P["thoughts"], P["hops"]
DUR = P["dur"]; N = int(SR * DUR)
rng = np.random.default_rng(3)

def put(buf, x, sec, gain=1.0):
    s = int(sec * SR); e = min(len(buf), s + len(x))
    if 0 <= s < len(buf): buf[s:e] += x[:e - s] * gain
def lp(x, hz): return sosfilt(butter(2, hz, btype="low", fs=SR, output="sos"), x)
def hp(x, hz): return sosfilt(butter(2, hz, btype="high", fs=SR, output="sos"), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), x)
def tone(f, d): return np.sin(2 * np.pi * f * np.arange(int(d * SR)) / SR)

_c = {}
def S(name, pitch=1.0):
    k = (name, round(pitch, 3))
    if k not in _c:
        x = sf.read(f"audio/sfx/{name}.wav")[0]
        if pitch != 1.0: x = resample_poly(x, 100, int(round(100 * pitch)))
        _c[k] = x / (np.max(np.abs(x)) + 1e-9)
    return _c[k]

music = np.zeros(N); sfx = np.zeros(N)
def hit(name, sec, gain, pitch=1.0): put(sfx, S(name, pitch), sec, gain)

# ---------- 0 to titleOut: a quiet room, a clock, the title, the dot dropping in as the full stop
for i, s in enumerate(np.arange(0.1, C["titleOut"], 0.5)):
    hit("tick1" if i % 2 == 0 else "tick2", s, 0.32)
for i in range(3): hit(["key1", "key2", "key3"][i], C["titleIn"] + i * 0.09 + 0.05, 0.16)
g, y0, yF, e = 5200, -80, P["layout"]["title"]["dot"]["y"], 0.4
T1 = np.sqrt(2 * (yF - y0) / g); v = g * T1; tb = C["dotDrop"] + T1
for k in range(3):
    hit("pluck2", tb, 0.42 * (0.55 ** k), pitch=1.0 + 0.12 * k); v *= e; tb += 2 * v / g

# whip: the title leaves, the first thought slaps down
n = int(0.32 * SR); kk = np.linspace(0, 1, n)
whoosh = bp(rng.standard_normal(n), 500, 3500) * np.sin(np.pi * kk) ** 2
put(sfx, whoosh / np.max(np.abs(whoosh)), C["titleOut"] - 0.12, 0.22)
hit("cloth1", C["titleOut"] - 0.08, 0.2)

# ---------- every thought lands with its own material sound
SOUND = {"ticket": ["paper1", "paper2", "paper3"], "card": ["flip1", "flip2", "flip3", "paper2"], "stamp": ["stamp"],
         "term": ["key1"], "word": ["soft1", "soft2"], "mail": ["drop1", "drop2"], "ring": ["glass"],
         "sketch": ["scratch1", "scratch2"], "jar": ["coins"]}
for th in TH:
    t0 = th["t"]; i = th["i"]
    crowd = np.clip((t0 - 10) / 9, 0, 1)                       # later thoughts are quieter each, but there are more
    gain = 0.5 * (1 - 0.55 * crowd)
    names = SOUND[th["kind"]]
    if th["kind"] == "term":
        chars = len("".join(th["lines"]))
        for j in range(min(chars, 14)):                         # typed lines: a burst of key clicks
            hit(["key1", "key2", "key3", "key4"][(i + j) % 4], t0 + j * 0.032, gain * 0.45)
    else:
        hit(names[i % len(names)], t0, gain, pitch=1.0 + 0.04 * ((i * 7) % 5 - 2))
    if th["kind"] == "stamp": hit("punch", t0 + 0.22, gain * 0.7)
    if th["kind"] == "mail": hit("error", t0 + 0.05, gain * 0.25)

# ---------- the dot answering each thought: a soft tap on landing, rising in pitch as it gets frantic
for j, h in enumerate(HOPS[1:], 1):
    if h["t"] >= C["freeze"]: break
    fr = (h["t"] - C["titleOut"]) / (C["freeze"] - C["titleOut"])
    gain = 0.2 if h["t"] < C["chaos"] else 0.09
    hit(["tap1", "tap2"][j % 2], h["t"], gain, pitch=0.9 + 0.5 * fr)

# ---------- music: a pulse like a heartbeat that speeds up with the thoughts, and a drone that opens up
t = C["titleOut"]
def beat(f0=58, d=0.22):
    tt = np.arange(int(d * SR)) / SR
    f = f0 + 70 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 14)
while t < C["freeze"]:
    k = (t - C["titleOut"]) / (C["freeze"] - C["titleOut"])
    bpm = 64 + 110 * k ** 1.6
    put(music, beat(), t, 0.55 + 0.25 * k)
    put(music, beat(52, 0.18), t + 0.16 * 60 / bpm * 1.6, 0.32 + 0.2 * k)   # lub, dub
    t += 60 / bpm

d0 = 7.0; dur = C["freeze"] - d0; n = int(dur * SR); kk = np.linspace(0, 1, n)
drone = np.zeros(n)
for f, gg in [(55, 0.5), (82.4, 0.35), (110, 0.3), (164.8, 0.2), (220 * 1.003, 0.12)]:
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.06 * kk ** 2) * np.ones(n)) / SR
    drone += gg * (2 * ((ph / (2 * np.pi)) % 1) - 1)
# the filter opens as the mess grows: crossfade a dark and a bright version (no zipper noise)
m = kk ** 2.2
out = lp(drone, 220) * (1 - m) + lp(drone, 3400) * m
noise = hp(rng.standard_normal(n), 2500) * kk ** 3 * 0.15        # air rising into the zoom out
x = (out / np.max(np.abs(out))) * kk ** 1.4 * 0.36 + noise
put(music, x, d0, 1.0)

# zoom out: a long swell under it
z0 = C["zoomOut"]; n = int((C["freeze"] - z0) * SR); kk = np.linspace(0, 1, n)
sweep = np.sin(2 * np.pi * np.cumsum(180 + 1400 * kk ** 2) / SR) * kk ** 2 * 0.12
put(music, sweep, z0, 1.0)
hit("cloth2", z0, 0.2); hit("glitch", C["freeze"] - 0.6, 0.12)

# ---------- freeze: hard cut to silence. The clock is still there.
music[int(C["freeze"] * SR):] = 0
sfx[int(C["freeze"] * SR):] = 0
hit("softH", C["freeze"], 0.45)
for i, s in enumerate(np.arange(C["freeze"] + 0.5, C["pushIn"], 1.0)):
    hit("tick1" if i % 2 == 0 else "tick2", s, 0.26)
hit("key2", C["line1"] + 0.05, 0.12); hit("key3", C["line2"] + 0.05, 0.12)

# warm chord on "and I still show up", through to the end
def pad(a, b, level, freqs=(130.81, 196.0, 261.63, 329.63, 392.0)):
    d = b - a; n = int(d * SR)
    x = sum(tone(f, d) + 0.3 * tone(f * 1.004, d) for f in freqs)
    env = np.minimum(1, np.arange(n) / (0.8 * SR)) * np.minimum(1, (n - np.arange(n)) / (0.9 * SR))
    put(music, lp(x, 1500) / len(freqs) * env, a, level)
pad(C["line2"] - 0.2, DUR, 0.35)

# the dive: rising rush, a deep thump when the orange fills the frame
n = int((C["wahb"] - C["pushIn"]) * SR); kk = np.linspace(0, 1, n)
rush = bp(rng.standard_normal(n), 300, 5000) * kk ** 2.5
put(sfx, rush / np.max(np.abs(rush)), C["pushIn"], 0.35)
hit("softH", C["wahb"] - 0.05, 0.55)
for i in range(4): hit(["key1", "key2", "key3", "key4"][i], C["wahb"] + 0.1 + i * 0.07, 0.12)
# the full stop lands: the service bell. 06:15, time to go.
hit("pluck1", C["land"], 0.4, pitch=1.1); hit("bell", C["land"] + 0.02, 0.5)

# ---------- mix, -14 LUFS, soft limit near -2 dBFS (headroom for AAC), fade at the very end
mixd = music * 0.5 + sfx * 0.85
fade_n = int((DUR - C["fade"]) * SR)
mixd[-fade_n:] *= np.linspace(1, 0, fade_n) ** 1.5
meter = pyln.Meter(SR)
st = np.stack([mixd, mixd], axis=1)
mixd *= 10 ** ((-14.0 - meter.integrated_loudness(st)) / 20)
over = np.abs(mixd) > 0.6
mixd[over] = np.sign(mixd[over]) * (0.6 + 0.19 * np.tanh((np.abs(mixd[over]) - 0.6) / 0.19))
final = meter.integrated_loudness(np.stack([mixd, mixd], axis=1))
sf.write("public/mix.wav", np.stack([mixd, mixd], axis=1).astype(np.float32), SR, subtype="PCM_24")
print(f"integrated {final:.2f} LUFS, peak {20 * np.log10(np.max(np.abs(mixd))):.2f} dBFS, {len(mixd) / SR:.2f} s")
