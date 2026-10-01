"""Film grain frames (public/grain0-5.png): mid-grey noise, blended as overlay in the video."""
import numpy as np
from PIL import Image
rng = np.random.default_rng(11)
for i in range(6):
    n = rng.normal(128, 38, (540, 960)).clip(0, 255).astype(np.uint8)
    Image.fromarray(n, "L").resize((1920, 1080), Image.NEAREST).save(f"public/grain{i}.png", optimize=True)
