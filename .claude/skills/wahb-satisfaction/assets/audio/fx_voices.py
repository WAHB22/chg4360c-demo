"""Replaces two moments of the recorded voice with generated voices (Kokoro TTS, open source):
an excited announcer for "Introducing... Spitch!" and a robot for "thanks for your application".
Reads audio/voice_own.wav + audio/timeline_own.json (the fitted recording), writes audio/voice.wav + timeline.json."""
import json, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly, butter, sosfilt, fftconvolve
M="/tmp/claude-0/-home-user-chg4360c-demo/ede279eb-6cd7-57db-b650-c218a4d8ec34/scratchpad/tts/"
k=Kokoro(M+"kokoro-v1.0.onnx", M+"voices-v1.0.bin")
SR=48000
def trim(a,thr=0.012):
    i=np.where(np.abs(a)>thr)[0]; return a[max(0,i[0]-240):i[-1]+480]
def up(a,sr): return resample_poly(a,SR//3000,sr//3000)
def norm(a,pk=0.85): return a/np.max(np.abs(a))*pk
v,_=sf.read("audio/voice_own.wav"); v=v.copy()
T=json.load(open("audio/timeline_own.json")); seg={s["id"]:s for s in T["segments"]}
def clear(a,b):
    ia,ib=int(a*SR),int(b*SR); f=int(0.02*SR)
    v[ia-f:ia]*=np.linspace(1,0,f); v[ia:ib]=0; v[ib:ib+f]*=np.linspace(0,1,f)
def place(x,at): i=int(at*SR); v[i:i+len(x)]+=x[:len(v)-i]

# --- robot: "thanks for your application", squeezed into the recorded slot
r0=seg["l6b"]["start"]; r1=seg["l6c"]["start"]-0.03
a,sr=k.create("thanks for your application",voice="am_michael",speed=1.32,lang="en-us"); a=up(trim(a),sr)
if len(a)>(r1-r0)*SR: a=resample_poly(a,int((r1-r0)*SR),len(a))
t=np.arange(len(a))/SR
robot=0.5*a*np.sin(2*np.pi*62*t)+0.5*np.round(a*14)/14      # ring mod + bit crush
d=int(0.009*SR); robot[d:]+=0.45*robot[:-d]                  # tinny comb
robot=sosfilt(butter(2,[300,3800],btype="band",fs=SR,output="sos"),robot)
clear(r0-0.05,r1); place(norm(robot,0.8),r0)
for j,w in enumerate(seg["l6b"]["words"]): w["start"]=round(r0+(r1-r0)*j/len(seg["l6b"]["words"]),3)

# --- announcer: "Introducing... Spitch!" (Spitch stays on the beat drop)
drop=seg["l7b"]["start"]
a,sr=k.create("Introducing...",voice="am_fenrir",speed=0.95,lang="en-us"); intro=up(trim(a),sr)
b,sr=k.create("spˈɪtʃ!",voice="am_fenrir",speed=0.9,is_phonemes=True); sp=up(trim(b),sr)
i0=drop-0.12-len(intro)/SR
ann=np.zeros(int((drop-i0)*SR)+len(sp)+SR)
ann[:len(intro)]+=norm(intro,0.8); j=int((drop-i0)*SR); ann[j:j+len(sp)]+=norm(sp,0.95)
ir=np.random.default_rng(1).standard_normal(int(1.2*SR))*np.exp(-np.arange(int(1.2*SR))/SR*4.5)   # hall
wet=fftconvolve(ann,ir)[:len(ann)]; ann=ann+0.18*wet/np.max(np.abs(wet))
e=int(0.16*SR); ann[e:]+=0.3*ann[:-e]                                   # announcer slapback
clear(seg["l7a"]["start"]-0.05, seg["l7b"]["end"]+0.1); clear(i0-0.05,i0)
place(norm(ann,0.92),i0)
seg["l7a"]["words"][0]["start"]=round(i0,3); seg["l7a"]["start"]=round(i0,3)
sf.write("audio/voice.wav",v,SR)
json.dump(T,open("audio/timeline.json","w"),indent=1); json.dump(T,open("src/timeline.json","w"),indent=1)
print("robot",r0,r1,"announcer starts",round(i0,2),"drop",drop)
