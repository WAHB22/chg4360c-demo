import sys, glob
from PIL import Image, ImageDraw
d=sys.argv[1]; fs=sorted(glob.glob(d+"/s_*.jpg"), key=lambda p: float(p.split("s_")[1][:-4]))
cols=int(sys.argv[2]) if len(sys.argv)>2 else 3
ims=[Image.open(f).resize((640,360)) for f in fs]
rows=(len(ims)+cols-1)//cols
S=Image.new("RGB",(640*cols,360*rows),(40,40,40))
for i,(im,f) in enumerate(zip(ims,fs)):
    S.paste(im,((i%cols)*640,(i//cols)*360)); ImageDraw.Draw(S).text(((i%cols)*640+8,(i//cols)*360+6),f.split("s_")[1][:-4].lstrip("0"),fill=(255,255,0))
S.save(d+"/sheet.jpg",quality=85)
