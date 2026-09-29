import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { FPS, at } from "../config";
import envelope from "../envelope.json";

/** v3 palette: ink stage, warm paper cut-outs, one orange. Green only for the AI chat. */
export const K = {
  ink: "#0E0F12",
  ink2: "#16171C",
  ink3: "#22242B",
  paper: "#F6F4EF",
  paper2: "#E9E5DC",
  accent: "#FF5A1F",
  accentDark: "#C9400F",
  ai: "#10A37F",
  muted: "#8E8E97",
  shadow: "rgba(0,0,0,0.38)",
};
export const SERIF = '"Times New Roman", "Liberation Serif", Tinos, Times, serif';
export const GROTESK = '"SpaceGrotesk", "Liberation Sans", sans-serif';
export const INTER = '"InterV", "Liberation Sans", sans-serif';

/** Cue time in seconds: word i of line id. */
export const W = at;

/** Current time in seconds, on ones (for camera) and on twos (for drawn animation). */
export const useT = () => {
  const frame = useCurrentFrame();
  return { frame, t: frame / FPS, t2: (frame - (frame % 2)) / FPS };
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const E = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  in: Easing.bezier(0.55, 0, 1, 0.45),
  soft: Easing.bezier(0.45, 0, 0.55, 1),
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
};
/** Progress 0..1 between two times (seconds). */
export const p = (t: number, a: number, b: number, ease: (x: number) => number = E.out) =>
  interpolate(t, [a, b], [0, 1], { ...clamp, easing: ease });
/** Map a time through keyframes: lerp(t, [t0,t1,..], [v0,v1,..]). */
export const lerp = (t: number, ts: number[], vs: number[], ease: (x: number) => number = E.soft) =>
  interpolate(t, ts, vs, { ...clamp, easing: ease });
/** Springy 0..1 that starts at time t0. */
export const pop = (t: number, t0: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  t < t0 ? 0 : spring({ frame: (t - t0) * FPS, fps: FPS, config: { damping: 11, stiffness: 170, mass: 0.7, ...cfg } });
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;
export const inRange = (t: number, a: number, b: number) => t >= a && t < b;

/** Decaying camera shake from a list of hits {t, amp}. */
export const shake = (t: number, hits: { t: number; amp: number }[]) => {
  let x = 0, y = 0, r = 0;
  for (const h of hits) {
    const d = t - h.t;
    if (d < 0 || d > 0.6) continue;
    const k = h.amp * Math.exp(-d * 9);
    x += Math.sin(d * 97) * k; y += Math.cos(d * 83) * k * 0.8; r += Math.sin(d * 61) * k * 0.04;
  }
  return { x, y, r };
};

/** Slow handheld drift so no frame is ever perfectly still. */
export const drift = (t: number, amt = 1) => ({
  x: (Math.sin(t * 0.7) * 4 + Math.sin(t * 1.9 + 1) * 1.5) * amt,
  y: (Math.cos(t * 0.53) * 3 + Math.sin(t * 1.3 + 2) * 1.2) * amt,
  r: Math.sin(t * 0.41) * 0.18 * amt,
});

/** A camera: everything inside moves together. (cx, cy) is the world point at screen centre. */
export const Camera: React.FC<{ cx?: number; cy?: number; zoom?: number; rot?: number; t: number; hits?: { t: number; amp: number }[]; driftAmt?: number; children: React.ReactNode }> = ({ cx = 960, cy = 540, zoom = 1, rot = 0, t, hits = [], driftAmt = 1, children }) => {
  const s = shake(t, hits);
  const d = drift(t, driftAmt);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(960px,540px) rotate(${rot + s.r + d.r}deg) scale(${zoom}) translate(${-cx + s.x + d.x}px,${-cy + s.y + d.y}px)` }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Global SVG filters: line boil (seed changes every 3 frames) and cut-paper boil with a hard offset shadow. */
export const Filters = () => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 3) % 7;
  return (
    <svg width={0} height={0} style={{ position: "absolute" }}>
      <defs>
        <filter id="boil" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={seed} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={3.2} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="cut" x="-10%" y="-10%" width="125%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={2} seed={seed} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={3.2} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feDropShadow in="d" dx={0} dy={7} stdDeviation={1.5} floodColor="#000" floodOpacity={0.42} />
        </filter>
        <filter id="shadow" x="-10%" y="-10%" width="125%" height="130%">
          <feDropShadow dx={0} dy={8} stdDeviation={2} floodColor="#000" floodOpacity={0.4} />
        </filter>
        <radialGradient id="bulbGlow">
          <stop offset="0%" stopColor="#FFB36B" stopOpacity={0.55} />
          <stop offset="45%" stopColor="#FF5A1F" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#FF5A1F" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="warm">
          <stop offset="0%" stopColor="#FF8A4C" stopOpacity={0.35} />
          <stop offset="60%" stopColor="#FF5A1F" stopOpacity={0.08} />
          <stop offset="100%" stopColor="#FF5A1F" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="cool">
          <stop offset="0%" stopColor="#3A4152" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#3A4152" stopOpacity={0} />
        </radialGradient>
        <filter id="stamp" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves={3} seed={4} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={30} />
        </filter>
      </defs>
    </svg>
  );
};

/** Font faces: the website's own typefaces for any UI shown on screen. */
export const Fonts = () => (
  <style>{`
    @font-face { font-family: "SpaceGrotesk"; src: url(${staticFile("fonts/space-grotesk.woff2")}) format("woff2"); font-weight: 300 700; }
    @font-face { font-family: "InterV"; src: url(${staticFile("fonts/inter.woff2")}) format("woff2"); font-weight: 100 900; }
  `}</style>
);

/** Film grain + vignette on top of everything. */
export const Grain = () => {
  const frame = useCurrentFrame();
  const i = frame % 6;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Img src={staticFile(`grain${i}.png`)} style={{ width: 1920, height: 1080, mixBlendMode: "overlay", opacity: 0.16, imageRendering: "auto" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%)" }} />
    </AbsoluteFill>
  );
};

/** Full-frame paper sheet (texture), for paper-coloured scenes. */
export const PaperBg: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <Img src={staticFile("paper.jpg")} style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, ...style }} />
);

/** Draw-on for an SVG path that has pathLength=1. */
export const draw = (k: number) => ({ strokeDasharray: 1, strokeDashoffset: 1 - Math.max(0, Math.min(1, k)) });

/** Deterministic pseudo-random. */
export const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Full-frame SVG in 1920x1080 world units. */
export const Stage: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; w?: number; h?: number }> = ({ children, style, w = 1920, h = 1080 }) => (
  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", ...style }}>
    {children}
  </svg>
);

/** Voice loudness per frame (0..1), for lip flaps. */
export const talkAt = (frame: number) => {
  const f2 = frame - (frame % 2);
  return (envelope as number[])[Math.max(0, Math.min(envelope.length - 1, f2))] ?? 0;
};
