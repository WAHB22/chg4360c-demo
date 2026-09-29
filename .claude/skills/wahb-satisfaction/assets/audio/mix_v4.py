"""Synthesizes the music and sound effects on the script's word timings, mixes them under the voice,
and normalizes the result to -14 LUFS. Everything here is generated, so there is nothing to license."""
import json, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter, sosfilt

SR = 48000; N = SR * 60
T = json.load(open("audio/timeline.json"))
W = {s["id"]: s["words"] for s in T["segments"]}
at = lambda sid, i: W[sid][i]["start"]
rng = np.random.default_rng(7)
t_all = np.arange(N) / SR

def env_adsr(n, a=0.01, r=0.1):
    e = np.ones(n); A = int(a*SR); R = int(r*SR)
    if A: e[:A] = np.linspace(0, 1, A)
    if R: e[-R:] *= np.linspace(1, 0, R)
    return e
def put(buf, x, sec, gain=1.0):
    s = int(sec*SR); e = min(len(buf), s+len(x))
    if s < len(buf): buf[s:e] += x[:e-s]*gain
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), x)
def lp(x, hz): return sosfilt(butter(2, hz, btype="low", fs=SR, output="sos"), x)
def hp(x, hz): return sosfilt(butter(2, hz, btype="high", fs=SR, output="sos"), x)
def tone(freq, dur, kind="sine"):
    tt = np.arange(int(dur*SR))/SR
    if kind == "saw": return 2*((tt*freq) % 1) - 1
    return np.sin(2*np.pi*freq*tt)

music = np.zeros(N); sfx = np.zeros(N)

# --- ambient pad: A minor add9, soft, slow-moving
def pad(start, end, level):
    dur = end - start
    x = np.zeros(int(dur*SR))
    for fr, g in [(110, .5), (164.81, .35), (220, .35), (261.63, .25), (329.63, .2), (493.88, .12)]:
        x += g*(tone(fr, dur) + 0.3*tone(fr*1.003, dur))
    x = lp(x, 1400) * env_adsr(len(x), a=min(1.2, dur/3), r=0.06)
    put(music, x/np.max(np.abs(x)), start, level)

died = at("l3", 2)
pad(0.0, died + 0.02, 0.10)                       # soft ambient from the start, out on "died"
pad(at("l4", 0), at("l7a", 0) + 0.2, 0.06)        # comes back quietly for the sincere line

# --- riser under "Introducing", beat drops on "Spitch"
rs, drop = at("l7a", 0) - 0.1, at("l7b", 0)
n = int((drop - rs)*SR); k = np.linspace(0, 1, n)
riser = hp(rng.standard_normal(n), 400) * k**2 * 0.35
sweep = np.sin(2*np.pi*np.cumsum(200 + 900*k**2)/SR) * k**2 * 0.25
put(music, riser + sweep, rs)

# --- upbeat groove, 112 bpm, from "Spitch" until "I'm a fourth-year..."
BPM = 112; beat = 60/BPM
groove_end = at("l12", 0)
def kick():
    d = 0.35; tt = np.arange(int(d*SR))/SR
    f0 = 45 + 110*np.exp(-tt*28)
    return np.sin(2*np.pi*np.cumsum(f0)/SR) * np.exp(-tt*9)
def clap():
    x = bp(rng.standard_normal(int(0.2*SR)), 900, 4000); return x*np.exp(-np.arange(len(x))/SR*22)*0.6
def hat():
    x = hp(rng.standard_normal(int(0.06*SR)), 7000); return x*np.exp(-np.arange(len(x))/SR*70)*0.35
chords = [(220, 261.63, 329.63), (174.61, 220, 261.63), (130.81, 196, 261.63), (196, 246.94, 293.66)]  # Am F C G
b = drop; i = 0
while b < groove_end:
    put(music, kick(), b, 0.55)
    if i % 2 == 1: put(music, clap(), b, 0.35)
    put(music, hat(), b + beat/2, 0.3)
    if i % 4 == 0:
        ch = chords[(i//4) % 4]; d = beat*4
        x = sum(tone(fr, d, "saw") for fr in ch); x = lp(x, 1800)*env_adsr(len(x), 0.02, 0.3)
        put(music, x/np.max(np.abs(x)), b, 0.07)
        bass = lp(tone(ch[0]/2, d, "saw"), 300)*env_adsr(int(d*SR), 0.01, 0.1)
        put(music, bass, b, 0.2)
    b += beat; i += 1

# --- dip for "I live this problem", warm pad through the invitation, swell, clean cut on "right"
pad(at("l12", 0), at("l13", 0), 0.045)
cut = at("l14", 2)
pad(at("l13", 0), cut, 0.08)
sw0 = at("l14", 0) - 0.4; nn = int((cut - sw0)*SR)
swell = lp(sum(tone(fr, cut - sw0, "saw") for fr in (220, 329.63, 440)), 2400)*np.linspace(0.2, 1, nn)**2
put(music, swell/np.max(np.abs(swell)), sw0, 0.12)
music[int(cut*SR):] = 0                            # clean cut on "right"

# --- outro: one soft final note that fades out by 1:00
note = (tone(440, 2.3) + 0.4*tone(880, 2.3)) * np.exp(-np.arange(int(2.3*SR))/SR*1.6)
put(music, note/np.max(np.abs(note)), cut + 0.45, 0.12)

# --- sound effects for v4 (no people: the dot). Real foley: Kenney (CC0) and remotion.media.
from scipy.signal import resample_poly
_cache = {}
def S(name, pitch=1.0):
    key = (name, pitch)
    if key not in _cache:
        x = sf.read(f"audio/sfx/{name}.wav")[0]
        if pitch != 1.0:
            up, down = 100, int(round(100*pitch))
            x = resample_poly(x, up, down)
        _cache[key] = x
    return _cache[key]
def hit(name, sec, gain, pitch=1.0):
    put(sfx, S(name, pitch), sec, gain)
def click(): x = bp(rng.standard_normal(int(0.03*SR)), 1500, 6000); return x*np.exp(-np.arange(len(x))/SR*160)
taps = ["tap1", "tap2", "tap3", "tap4"]
EIO = lambda x: 4*x**3 if x < 0.5 else 1 - (-2*x + 2)**3/2     # close to the video's in-out curve

# intro: letters rise, the dot drops in and bounces
for i in range(6): hit(taps[i % 4], 0.04 + i*0.05 + 0.1, 0.16)
T1 = np.sqrt(2*(541 + 120)/5200); v = 5200*T1; tb = 0.26 + T1
for k in range(3):
    hit("pluck2", tb, 0.34*(0.42**k)**0.6, pitch=1.0 + 0.1*k); v *= 0.38; tb += 2*v/5200
hit("whoosh", 1.0, 0.16); hit("whoosh", 1.35, 0.1)
# the idea
idea = at("l1", 6); hit("pluck1", idea, 0.4); hit("glass1", idea + 0.02, 0.28); hit("slide5", idea + 0.02, 0.16)
pathT = at("l2", 0); freedom = at("l2", 4)
hit("whoosh", pathT, 0.12)
c0, c1 = pathT + 0.4, freedom
for k in range(9):                                  # the climb: ticks rising in pitch
    u = (k + 1)/10
    tt = c0 + (c1 - c0)*u
    hit("select2", tt, 0.12, pitch=0.85 + 0.09*k)
hit("confirm3", freedom, 0.3)
# ...then it died: the scratch, a falling whistle, the whip into the chat
hit("scratch", died - 0.05, 0.5)
n = int(0.55*SR); k_ = np.linspace(0, 1, n)
whistle = np.sin(2*np.pi*np.cumsum(1400 - 1150*k_**0.7)/SR)*np.sin(np.pi*k_)**0.5
put(sfx, whistle, died + 0.02, 0.08)
hit("whip", died + 0.42, 0.42)
chat0 = died + 0.52; sent = chat0 + 0.12
hit("click2", sent, 0.35); hit("drop1", sent + 0.02, 0.25)
for j in range(3): put(sfx, click(), sent + 0.36 + j*0.08, 0.12)
hit("pluck1", sent + 0.6, 0.2); hit("scroll", sent + 0.64, 0.28)
# uphill: an effort at every push, a slip after each, then the long roll back
s4 = at("l4", 0); fail = at("l4", 9) + 0.02
tt = s4
while tt < fail:
    hit("softM", tt + 0.02, 0.16); hit(taps[int(tt*10) % 4], tt + 0.38, 0.1); tt += 0.55
n = int(0.9*SR); rum = lp(rng.standard_normal(n), 180)*np.linspace(1, 0, n)**1.5
put(sfx, rum/np.max(np.abs(rum)), fail, 0.18)
hit("woodL", fail, 0.3); hit("switchOff", at("l4", 13) + 0.3, 0.4)
# the resume (same scene as v3)
r0 = at("l5a", 0); rough = at("l5b", 0) + 0.05
hit("pageTurn", r0, 0.45); hit("whoosh", at("l5a", 3), 0.12); hit("whoosh", at("l5c", 0) - 0.1, 0.1)
hit("punchH", rough, 0.55); hit("woodH", rough, 0.25)
hit("packOpen", rough + 1.05, 0.45); hit("whoosh", rough + 1.31, 0.28)
# buried under emails (centre cards land last, as in the video)
i0 = at("l6a", 0); emails = at("l6c", 0)
rows = [[700, 960, 1220], [560, 830, 1090, 1360], [690, 960, 1230], [600, 860, 1120, 1330], [760, 1000, 1180], [880, 1060]]
xs = [x for r in rows for x in r]; NC = len(xs)
order = sorted(range(NC), key=lambda i: np.floor(i/3.5) + (2.2 if abs(xs[i] - 960) < 160 else 0) + i*0.001)
first, last = i0 + 0.3, emails
n = int(0.5*SR); roll = lp(rng.standard_normal(n), 300)*np.sin(np.linspace(0, np.pi, n))
put(sfx, roll/np.max(np.abs(roll)), i0 - 0.05, 0.1)
for rank in range(NC):
    hit(taps[rank % 4], first + (last - first)*np.sqrt(rank/(NC - 1)), 0.24 + 0.06*rng.random())
hit("softM", emails, 0.4); hit("switchOff", emails + 0.55, 0.3)
# the reveal and the website (same scenes as v3)
hit("punchH", drop, 0.3); hit("glass1", drop + 0.02, 0.22)
hit("whoosh", drop + 0.7, 0.32); hit("bong", at("l8", 4), 0.2)
for k, tt in enumerate([at("l8", 8), at("l8", 9), at("l8", 11)]):
    hit(["shove1", "shove2", "shove3"][k], tt - 0.1, 0.42); hit("softM", tt, 0.22)
hit("whoosh", at("l9", 0) - 0.34, 0.28)
# the app, with the typed steps
post = at("l9", 7); connect = at("l9", 20); push = at("l9", 24)
for tt in [at("l9", 0), post - 0.05, at("l9", 11) - 0.05, connect - 0.05]: hit("tap2", tt + 0.08, 0.22)
hit("select1", at("l9", 0) + 0.1, 0.28)
hit("click3", post - 0.05, 0.4); hit("confirm2", post + 0.12, 0.28)
hit("slide1", at("l9", 12) - 0.06, 0.45); hit("slide2", at("l9", 14) - 0.06, 0.45)
hit("slide3", connect - 0.56, 0.4); hit("confirm3", connect, 0.38)
hit("click2", push, 0.3); hit("whip", push + 0.72, 0.4)
# circles and squares
s10 = at("l10a", 0); builders = at("l10a", 2); skills = at("l10a", 11); cn = at("l10b", 0)
hit("tap1", s10 + 0.02, 0.3)
for i in range(1, 5): hit("pluck1", s10 + 0.05 + i*0.06, 0.12, pitch=0.9 + 0.08*i)
hit("whoosh", builders - 0.12, 0.2); hit("tap3", builders + 0.02, 0.3)
S_, BASE = 110, 790
sq_y = [BASE - S_, BASE - S_, BASE - S_, BASE - 2*S_ - 12, BASE - 2*S_ - 12, BASE - 3*S_ - 24]
for i, qy in enumerate(sq_y):
    hit("woodL", builders + 0.05 + i*0.09 + np.sqrt(2*(qy + S_ + 200)/6000), 0.26)
for i in range(5): hit(["chip1", "chip2", "chip3"][i % 3], at("l10a", 6) - 0.1 + i*0.07 + 0.08, 0.28)
for k, name in enumerate(["pluck1", "pluck2", "select2"]): hit(name, skills - 0.1 + k*0.12, 0.28)
meet = cn + 0.55
hit("whoosh", cn, 0.2); hit("click3", meet, 0.45); hit("generic", meet, 0.3); hit("whoosh", meet + 0.05, 0.18)
price = at("l10b", 3); hit("softM", price + 0.15, 0.32); hit("pluck2", price + 0.32, 0.25)
coffee = at("l10b", 6); hit("coins", coffee, 0.4)
ting = (tone(2637, 0.5) + 0.5*tone(3951, 0.5))*np.exp(-np.arange(int(0.5*SR))/SR*8)
put(sfx, ting, coffee + 0.03, 0.16)
# the market (same scene as v3)
cs, ce = at("l11", 0), at("l11", 3); tt_ = cs
while tt_ < ce:
    put(sfx, click(), tt_, 0.2); p_ = (tt_ - cs)/(ce - cs); tt_ += 0.035 + 0.1*p_**2
hit("drop2", ce - 0.08, 0.38); hit("woodL", ce + 0.05, 0.3); hit("pluck2", at("l11", 5), 0.22)
# the drawing, the post, the swipe
s12 = at("l12", 0); live = at("l12", 5); problem = at("l12", 8)
hit("scratchPencil", s12 + 0.05, 0.18); hit("scratchPencil", at("l12", 2) - 0.1, 0.2)
for i in range(5): hit(taps[i % 4], s12 + 0.55 + i*0.1, 0.08)
for i in range(4): hit("slide5" if i % 2 else "tap4", live - 0.1 + i*0.12, 0.2)
hit("scratchPencil", problem - 0.05, 0.3)
ifT = at("l13", 0); lets = at("l13", 10); linkedin = at("l13", 8)
hit("whoosh", ifT - 0.35, 0.14); hit("slide6", ifT - 0.1, 0.3); hit("pluck1", at("l13", 7), 0.3)
hit("drop3", linkedin + 0.3, 0.25)
for j in range(5): put(sfx, click(), linkedin + 0.45 + j*0.13, 0.08)
hit("drop1", lets - 0.05, 0.3)
orT = at("l14", 0); hit("whoosh", orT - 0.05, 0.14); hit("slide5", orT + 0.1, 0.2)
hit("scratchPencil", at("l14", 1) - 0.15, 0.18)
hit("slide1", at("l14", 2), 0.45); hit("whoosh", at("l14", 2) + 0.02, 0.3)
# outro: the dot comes home
o0 = at("l14", 2) + 0.36
hit("whoosh", o0 - 0.05, 0.2); hit("pluck2", o0 + 0.42, 0.35, pitch=1.12)
for i in range(6): hit(taps[i % 4], o0 + i*0.04 + 0.12, 0.1)

# --- mix: music well under the voice
voice, _ = sf.read("audio/voice.wav")
voice = np.pad(voice[:N], (0, max(0, N - len(voice))))
mix = voice*1.0 + music*0.14 + sfx*0.45
meter = pyln.Meter(SR)
# Measure as the stereo file it will be (both channels count), then normalise to -14 LUFS.
st = np.stack([mix, mix], axis=1)
loud = meter.integrated_loudness(st)
mix = mix * 10 ** ((-14.0 - loud) / 20)
peak = np.max(np.abs(mix))
if peak > 0.89:                                     # soft-limit peaks to about -1 dBFS
    over = np.abs(mix) > 0.7
    mix[over] = np.sign(mix[over])*(0.7 + 0.19*np.tanh((np.abs(mix[over]) - 0.7)/0.19))
final = meter.integrated_loudness(np.stack([mix, mix], axis=1))
stereo = np.stack([mix, mix], axis=1).astype(np.float32)
sf.write("public/mix_v4.wav", stereo, SR, subtype="PCM_24")
vr = np.sqrt(np.mean(voice[voice != 0]**2)); mr = np.sqrt(np.mean((music*0.14)[music != 0]**2))
print(f"integrated {final:.1f} LUFS, peak {20*np.log10(np.max(np.abs(mix))):.1f} dBFS, music sits {20*np.log10(vr/mr):.1f} dB under the voice")
