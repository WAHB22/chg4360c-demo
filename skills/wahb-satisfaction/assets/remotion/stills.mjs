// Renders a list of frames (seconds) of the Pitch composition as JPEGs: node scripts/stills.mjs outdir 1.5 3 4.2 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const [out, ...secs] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: process.env.COMP || "Pitch" });
for (const s of secs) {
  const frame = Math.round(parseFloat(s) * 30);
  await renderStill({ serveUrl, composition, frame, output: path.join(out, `s_${String(s).padStart(6, "0")}.jpg`), imageFormat: "jpeg", jpegQuality: 80 });
}
console.log("done", secs.length);
