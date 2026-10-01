import React from "react";
import { FPS } from "./config";
import { K } from "./kit";

/** Mix two #rrggbb colours. */
export const mixColor = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, k))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

export type Pt = { x: number; y: number };

/**
 * The protagonist: one orange dot. It stretches along its velocity (a smear, like a drawn in-between)
 * and squashes on impact. Pass the position one frame earlier to get the smear.
 */
export const Dot: React.FC<{ x: number; y: number; r: number; prev?: Pt; squash?: number; color?: string; glow?: number; shadow?: boolean }> = ({ x, y, r, prev, squash = 1, color = K.accent, glow = 0, shadow = true }) => {
  let rx = r, ry = r, rot = 0;
  if (squash !== 1) {
    rx = r / Math.sqrt(squash); ry = r * squash;
  } else if (prev) {
    const vx = x - prev.x, vy = y - prev.y;
    const v = Math.hypot(vx, vy);
    const s = 1 + Math.min(0.9, (v / r) * 0.2);
    rx = r * s; ry = r / Math.sqrt(s);
    rot = (Math.atan2(vy, vx) * 180) / Math.PI;
  }
  // keep the bottom on the ground when squashing
  const dy = squash !== 1 ? r - ry : 0;
  return (
    <g>
      {glow > 0 && <circle cx={x} cy={y} r={r * 9} fill="url(#bulbGlow)" opacity={glow} />}
      <g transform={`translate(${x} ${y + dy}) rotate(${rot})`}>
        {shadow && <ellipse cx={0} cy={r * 0.12} rx={rx} ry={ry} fill="#000" opacity={0.35} transform={`translate(0 ${r * 0.1})`} />}
        <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={color} />
        <ellipse cx={-rx * 0.3} cy={-ry * 0.38} rx={rx * 0.28} ry={ry * 0.16} fill="#fff" opacity={0.28} transform={`rotate(-20 ${-rx * 0.3} ${-ry * 0.38})`} />
      </g>
    </g>
  );
};

/** Evaluate a position function now and one frame ago (for the smear). */
export const track = (fn: (t: number) => Pt, t: number) => ({ ...fn(t), prev: fn(t - 1 / FPS) });

/**
 * A ball dropped at t0 from y0 onto a floor at yF, bouncing with restitution e.
 * Returns y and the squash factor (1 = none) around each impact.
 */
export const bounce = (t: number, t0: number, y0: number, yF: number, g = 5200, e = 0.42, maxB = 4) => {
  if (t < t0) return { y: y0, squash: 1, landed: false, impact: -1 };
  const T1 = Math.sqrt((2 * (yF - y0)) / g);
  let v = g * T1;
  let start = t0 + T1;
  const v1 = v;
  if (t < start) {
    const d = t - t0;
    return { y: y0 + 0.5 * g * d * d, squash: 1, landed: false, impact: -1 };
  }
  for (let b = 0; b < maxB; b++) {
    const since = t - start;
    const sq = since < 0.09 ? 1 - 0.42 * (v / v1) * Math.sin((since / 0.09) * Math.PI) : 1;
    v *= e;
    const dur = (2 * v) / g;
    if (since < dur) {
      const y = yF - (v * since - 0.5 * g * since * since);
      return { y, squash: sq, landed: true, impact: start };
    }
    start += dur;
  }
  const since = t - start;
  const sq = since < 0.09 ? 1 - 0.1 * Math.sin((since / 0.09) * Math.PI) : 1;
  return { y: yF, squash: sq, landed: true, impact: start };
};

/** Point along a polyline at fraction k (by length), plus the index of the segment. */
export const along = (pts: Pt[], k: number) => {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, k)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) {
      const u = lens[i] ? d / lens[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u, i };
    }
    d -= lens[i];
  }
  const l = pts[pts.length - 1];
  return { x: l.x, y: l.y, i: lens.length - 1 };
};

/** Typeset line that rises out of a mask at its baseline (the way type is revealed in editorial motion). */
export const MaskLine: React.FC<{ x: number; y: number; size: number; k: number; children: React.ReactNode; anchor?: "start" | "middle" | "end"; color?: string; family?: string; weight?: number; italic?: boolean; tracking?: number; id: string; opacity?: number }> = ({ x, y, size, k, children, anchor = "start", color = K.paper, family = '"Times New Roman", "Liberation Serif", Tinos, Times, serif', weight = 700, italic, tracking = -0.02, id, opacity = 1 }) => (
  <g opacity={opacity}>
    <clipPath id={`m-${id}`}><rect x={-4000} y={y - size * 1.05} width={12000} height={size * 1.32} /></clipPath>
    <g clipPath={`url(#m-${id})`}>
      <text x={x} y={y + (1 - k) * size * 1.15} textAnchor={anchor} fontFamily={family} fontWeight={weight} fontStyle={italic ? "italic" : undefined} fontSize={size} letterSpacing={tracking * size} fill={color}>{children}</text>
    </g>
  </g>
);
