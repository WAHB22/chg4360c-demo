"""Fits Wahb's own recording to the video: aligns the script words to a Whisper transcript,
shortens long pauses (cut inside the silence with short crossfades), cleans the voice
(high-pass, gentle compression) and writes audio/voice.wav + timeline.json."""
import json, re, difflib, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
SR=48000
x,_=sf.read("/tmp/claude-0/-home-user-chg4360c-demo/ede279eb-6cd7-57db-b650-c218a4d8ec34/scratchpad/myvoice/raw.wav"); x=x.astype(np.float64)
tw=json.load(open("/tmp/claude-0/-home-user-chg4360c-demo/ede279eb-6cd7-57db-b650-c218a4d8ec34/scratchpad/myvoice/words.json"))
T=json.load(open("audio/timeline.json"))
norm=lambda w: re.sub(r"[^a-z0-9]","",w.lower().replace("é","e"))
sw=[(si,wi,w) for si,s in enumerate(T["segments"]) for wi,w in enumerate(s["words"])]
A=[norm(w["w"]) for _,_,w in sw]; B=[norm(w["w"]) for w in tw]
alias={"pictures":"pitchers","thankyou":"thanks"}
B=[alias.get(b,b) for b in B]
times=[None]*len(A)
for tag,i1,i2,j1,j2 in difflib.SequenceMatcher(None,A,B,autojunk=False).get_opcodes():
    if tag=="equal" or (tag=="replace" and i2-i1==j2-j1):
        for k in range(i2-i1): times[i1+k]=(tw[j1+k]["s"],tw[j1+k]["e"])
    elif tag=="replace":   # spread script words across the heard span
        s0,e0=tw[j1]["s"],tw[j2-1]["e"]; n=i2-i1
        for k in range(n): times[i1+k]=(s0+(e0-s0)*k/n, s0+(e0-s0)*(k+1)/n)
# fill gaps (deleted/unheard) by interpolation between neighbours
for i in range(len(times)):
    if times[i] is None:
        p=next(times[j][1] for j in range(i-1,-1,-1) if times[j]); q=next((times[j][0] for j in range(i+1,len(times)) if times[j]),p+0.3)
        times[i]=(p,max(p+0.05,min(q,p+0.3)))
# ---- pause tightening: gaps between consecutive heard words
KEEP={("l7a",0):1.4}  # pause before "Introducing" stays dramatic
ids=[(T["segments"][si]["id"],wi) for si,wi,_ in sw]
cuts=[]  # (src_start, src_end) to remove
lead=times[0][0]-1.0
if lead>0: cuts.append((0.1, 0.1+lead))
for i in range(1,len(times)):
    g=times[i][0]-times[i-1][1]; tgt=KEEP.get(ids[i],0.75)
    if g>tgt+0.1:
        mid=(times[i-1][1]+times[i][0])/2; r=g-tgt
        cuts.append((mid-r/2, mid+r/2))
def mapt(t):
    return t-sum(max(0,min(t,b)-a) for a,b in cuts)
# splice with 40 ms crossfades
out=[]; pos=0; F=int(.04*SR)
for a,b in cuts:
    out.append(x[pos:int(a*SR)]); pos=int(b*SR)
out.append(x[pos:])
y=out[0]
for seg in out[1:]:
    r=np.linspace(0,1,F); y=np.concatenate([y[:-F], y[-F:]*(1-r)+seg[:F]*r, seg[F:]])
# clean: HPF 80 Hz, de-mud, soft compression, peak norm
y=sosfilt(butter(2,80,btype="high",fs=SR,output="sos"),y)
env=np.sqrt(np.convolve(y**2,np.ones(480)/480,"same"))+1e-9
thr=np.percentile(env[env>1e-4],80); gain=np.where(env>thr,(thr/env)**0.5,1.0)
gain=np.convolve(gain,np.ones(960)/960,"same"); y=y*gain
y=y/np.max(np.abs(y))*0.89
sf.write("audio/voice.wav",y,SR)
for (si,wi,w),(s,e) in zip(sw,times): w["start"]=round(mapt(s),3); w["end"]=round(mapt(e),3)
for s in T["segments"]: s["start"]=s["words"][0]["start"]; s["end"]=s["words"][-1]["end"]
T["voice"]="Mohamed Wahb Berguia (own recording)"; T["voEnd"]=T["segments"][-1]["end"]
json.dump(T,open("audio/timeline.json","w"),indent=1); json.dump(T,open("src/timeline.json","w"),indent=1)
print("cuts",[(round(a,2),round(b,2)) for a,b in cuts]); print("len",len(y)/SR,"voEnd",T["voEnd"])
for s in T["segments"]: print(s["id"],s["start"],s["end"])
