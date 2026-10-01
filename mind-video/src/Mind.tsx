import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, staticFile } from "remotion";
import { BgCard, Shadow, ThoughtBody, ThoughtData, Word } from "./cards";
import { CUE, FPS, plan } from "./config";
import { Dot, Pt } from "./dot";
import { Camera, E, Filters, Grain, K, SERIF, INTER, lerp, mix, p, pop, rnd, Stage, useT } from "./kit";

const { thoughts, bg, hops, layout } = plan;
const TD = layout.title.dot;
const ED = layout.end.dot;

/* ---------- the dot: its whole life as one function of time ---------- */

const R_MAIN = 20;

/** Title: the dot falls in as the full stop after "inside my head" and bounces. */
const titleDot = (t: number): Pt & { squash: number } => {
  const t0 = CUE.dotDrop, y0 = -80, yF = TD.y, g = 5200, e = 0.4;
  if (t < t0) return { x: TD.x, y: y0, squash: 1 };
  const T1 = Math.sqrt((2 * (yF - y0)) / g);
  let v = g * T1, start = t0 + T1;
  if (t < start) return { x: TD.x, y: y0 + 0.5 * g * (t - t0) ** 2, squash: 1 };
  const v1 = v;
  for (let b = 0; b < 4; b++) {
    const s = t - start;
    const sq = s < 0.09 ? 1 - 0.3 * (v / v1) * Math.sin((s / 0.09) * Math.PI) : 1;
    v *= e;
    const dur = (2 * v) / g;
    if (s < dur) return { x: TD.x, y: yF - (v * s - 0.5 * g * s * s), squash: sq };
    start += dur;
  }
  return { x: TD.x, y: yF, squash: 1 };
};

/** Between hops: anticipation, an arc (or a straight zip once there is no time), a squash on landing. */
const hopDot = (t: number): Pt & { squash: number; k: number } => {
  let k = 0;
  while (k < hops.length - 1 && hops[k + 1].t <= t) k++;
  const a = hops[k];
  if (k === hops.length - 1 || t < hops[0].t) return { x: a.x, y: a.y, squash: 1, k };
  const b = hops[k + 1];
  const gap = b.t - a.t;
  const dur = Math.min(0.34, gap * 0.78);
  const dep = b.t - dur;
  if (t < dep) {
    const since = t - a.t;
    const land = since < 0.1 && k > 0 ? 1 - 0.38 * Math.sin((since / 0.1) * Math.PI) : 1;
    const ant = dep - t < 0.07 && dur > 0.18 ? 1 - 0.22 * Math.sin(((0.07 - (dep - t)) / 0.07) * Math.PI * 0.5) : 1;
    return { x: a.x, y: a.y, squash: Math.min(land, ant), k };
  }
  const u = E.inOut((t - dep) / dur);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const arc = dur > 0.18 ? Math.min(240, dist * 0.32) : 0;
  return { x: mix(a.x, b.x, u), y: mix(a.y, b.y, u) - arc * 4 * u * (1 - u), squash: 1, k };
};

/** Mess time: runs normally, then stops dead at the freeze. */
const mt = (t: number) => Math.min(t, CUE.freeze);

const dotWorld = (t: number) => (t < CUE.titleOut - 0.05 ? titleDot(t) : hopDot(mt(t)));

/* ---------- camera ---------- */

const FREEZE_DOT = hopDot(CUE.freeze);
const chaosJitter = (t: number) => {
  if (t < CUE.chaos - 1 || t >= CUE.freeze) return { x: 0, y: 0 };
  const amp = lerp(t, [CUE.chaos - 1, CUE.zoomOut, CUE.freeze - 0.4], [0, 7, 14], E.in);
  const f = Math.floor(t * FPS);
  return { x: (rnd(f) - 0.5) * 2 * amp, y: (rnd(f + 999) - 0.5) * 2 * amp };
};
const camera = (t: number) => {
  let zoom = lerp(t, [0, CUE.titleOut, CUE.chaos, CUE.zoomOut], [1, 1, 1.07, 1.0]);
  if (t >= CUE.zoomOut) zoom = lerp(t, [CUE.zoomOut, CUE.freeze - 0.5, CUE.freeze], [1.0, 0.37, 0.355], E.inOut);
  let cx = 960, cy = 540;
  if (t >= CUE.freeze) {
    zoom = 0.355 * lerp(t, [CUE.freeze, CUE.pushIn], [1, 1.04], E.soft);
    // dive into the dot: exponential zoom, centre glides onto it
    const k = p(t, CUE.pushIn, CUE.wahb, E.in);
    zoom = zoom * Math.pow(140 / zoom, k);
    const c = p(t, CUE.pushIn, CUE.pushIn + 0.45, E.inOut);
    cx = mix(960, FREEZE_DOT.x, c);
    cy = mix(540, FREEZE_DOT.y, c);
  }
  const j = chaosJitter(t);
  return { zoom, cx: cx + j.x, cy: cy + j.y };
};

/* ---------- layers ---------- */

const hits = thoughts.filter((th) => th.t < CUE.chaos).map((th, i) => ({ t: th.t, amp: i < 4 ? 5 : 3 }));

const Thought: React.FC<{ th: (typeof thoughts)[number]; t: number }> = ({ th, t }) => {
  if (t < th.t) return null;
  const k = pop(t, th.t, { damping: 13, stiffness: 260, mass: 0.6 });
  const s = mix(1.28, 1, k);
  const lift = mix(30, 9, Math.min(1, k));
  const rot = th.rot + (1 - k) * (th.i % 2 ? 9 : -9);
  const d = th as unknown as ThoughtData;
  return (
    <g transform={`translate(${th.x} ${th.y}) rotate(${rot}) scale(${s})`}>
      {th.kind === "word" ? <Word d={d} lift={lift} /> : <><Shadow d={d} lift={lift} /><ThoughtBody d={d} k={Math.min(1, (t - th.t) * 2.2)} t={t} /></>}
    </g>
  );
};

/** Orange thread: every jump of attention leaves a string between two thoughts. */
const Threads: React.FC<{ t: number }> = ({ t }) => {
  const out: React.ReactNode[] = [];
  for (let i = 1; i < hops.length; i++) {
    const a = hops[i - 1], b = hops[i];
    const dur = Math.min(0.34, (b.t - a.t) * 0.78);
    const k = p(t, b.t - dur, b.t, E.inOut);
    if (k <= 0) break;
    out.push(<line key={i} x1={a.x} y1={a.y} x2={mix(a.x, b.x, k)} y2={mix(a.y, b.y, k)} stroke={K.accent} strokeWidth={2.4} strokeOpacity={0.55} strokeLinecap="round" />);
  }
  return <g>{out}</g>;
};

const Background: React.FC<{ t: number }> = ({ t }) => (
  <g>
    {bg.map((b, i) => {
      if (t < b.t) return null;
      const k = pop(t, b.t, { damping: 14, stiffness: 240, mass: 0.6 });
      return (
        <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.rot + (1 - k) * 8}) scale(${b.s * mix(1.3, 1, k)})`}>
          <BgCard kind={b.kind} lines={b.lines} />
        </g>
      );
    })}
  </g>
);

/** Type that rises out of a baseline mask (HTML, so it sits above the camera). */
const Rise: React.FC<{ text: React.ReactNode; k: number; size: number; x: number; y: number; color?: string; weight?: number; family?: string; tracking?: number }> = ({ text, k, size, x, y, color = K.paper, weight = 700, family = SERIF, tracking = -0.025 }) => (
  <div style={{ position: "absolute", left: x, top: y - size, height: size * 1.3, overflow: "hidden" }}>
    <div style={{ transform: `translateY(${(1 - k) * size * 1.3}px)`, fontFamily: family, fontWeight: weight, fontSize: size, lineHeight: `${size * 1.2}px`, letterSpacing: tracking * size, color, whiteSpace: "nowrap" }}>{text}</div>
  </div>
);

/* ---------- the piece ---------- */

export const Mind: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("SpaceGrotesk", `url(${staticFile("fonts/space-grotesk.woff2")}) format("woff2")`, { weight: "300 700" }),
      new FontFace("InterV", `url(${staticFile("fonts/inter.woff2")}) format("woff2")`, { weight: "100 900" }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => { loaded.forEach((f) => document.fonts.add(f)); return document.fonts.ready; })
      .then(() => continueRender(handle));
  }, [handle]);

  const { t, t2 } = useT();
  const m = mt(t2);
  const cam = camera(t);
  const frozen = t >= CUE.freeze;
  const grey = p(t, CUE.freeze, CUE.freeze + 0.12, E.out);
  const messFade = 1 - p(t, CUE.pushIn + 0.35, CUE.wahb - 0.1, E.in);

  // the dot, in world space (and once more one frame earlier for the smear)
  const dw = dotWorld(t2);
  const dprev = dotWorld(t2 - 1 / FPS);
  const r = t < CUE.titleOut - 0.05 ? TD.r : lerp(t, [CUE.titleOut - 0.05, CUE.titleOut + 0.3], [TD.r, R_MAIN]);
  const zoomComp = t >= CUE.zoomOut && t < CUE.freeze + 0.01 ? lerp(t, [CUE.zoomOut, CUE.freeze - 0.5], [1, 2.1], E.inOut) : t >= CUE.freeze ? 2.1 : 1;

  // title
  const titleK = (i: number) => p(t, CUE.titleIn + i * 0.09, CUE.titleIn + i * 0.09 + 0.55);
  const whip = p(t, CUE.titleOut - 0.08, CUE.titleOut + 0.22, E.in);

  // end card
  // the dive fills the frame with orange before this point, so the cut lands on orange
  const endOn = t >= CUE.wahb;
  const big = p(t, CUE.wahb, CUE.land, E.out);
  const fade = p(t, CUE.fade, 30, E.soft);

  return (
    <AbsoluteFill style={{ background: K.ink }}>
      <Filters />
      {/* the stage */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 65% at 50% 46%, ${K.ink2} 0%, ${K.ink} 70%)` }} />

      {!endOn && (
        <Camera t={t} cx={cam.cx} cy={cam.cy} zoom={cam.zoom} hits={frozen ? [] : hits} driftAmt={frozen ? 0.25 : 1}>
          <div style={{ position: "absolute", inset: 0, filter: grey > 0 ? `grayscale(${grey}) brightness(${1 - 0.55 * grey})` : undefined, opacity: messFade }}>
            <Stage>
              <Background t={m} />
              <g filter={frozen ? undefined : "url(#boil)"}>
                <Threads t={m} />
                {thoughts.map((th) => <Thought key={th.i} th={th} t={m} />)}
              </g>
            </Stage>
          </div>
          {/* title: inside the camera so it shares the handheld drift */}
          {t < CUE.titleOut + 0.3 && (
            <div style={{ position: "absolute", left: 0, top: 0, transform: `translateX(${-whip * 2100}px)`, filter: whip > 0 ? `blur(${whip * 18}px)` : undefined }}>
              {layout.title.words.map((w, i) => <Rise key={w.text} text={w.text} k={titleK(i)} size={layout.title.size} x={w.x} y={layout.title.y} />)}
              <Rise text="Thursday, 06:14" k={p(t, 0.05, 0.6)} size={34} x={layout.title.x + 6} y={layout.title.y - 210} family={INTER} weight={500} color={K.muted} tracking={0} />
            </div>
          )}
          <Stage>
            {(t >= CUE.dotDrop) && <Dot x={dw.x} y={dw.y} r={r * zoomComp} prev={dw.squash === 1 ? dprev : undefined} squash={dw.squash} />}
          </Stage>
        </Camera>
      )}

      {/* after the freeze: two lines over the stopped mess */}
      {frozen && !endOn && (
        <AbsoluteFill style={{ opacity: 1 - p(t, CUE.pushIn, CUE.pushIn + 0.3, E.in) }}>
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(14,15,18,0) 45%, rgba(14,15,18,0.82) 78%)" }} />
          <Rise text="it's all happening at once." k={p(t, CUE.line1, CUE.line1 + 0.6)} size={96} x={150} y={800} />
          <Rise text={<>and I still show up at <span style={{ color: K.accent }}>06:15</span>.</>} k={p(t, CUE.line2, CUE.line2 + 0.6)} size={96} x={150} y={930} />
        </AbsoluteFill>
      )}

      {/* the end: the dot comes out of the dive and lands as the full stop after WAHB */}
      {endOn && (
        <AbsoluteFill style={{ opacity: 1 - fade }}>
          <Camera t={t} driftAmt={0.5} hits={[{ t: CUE.land, amp: 7 }]}>
            <Rise text="WAHB" k={p(t, CUE.wahb + 0.05, CUE.wahb + 0.7)} size={layout.end.size} x={layout.end.x} y={layout.end.y} tracking={-0.02} />
            <Rise text="inside, all at once" k={p(t, CUE.land + 0.35, CUE.land + 0.95)} size={40} x={layout.end.x + 8} y={layout.end.y + 110} family={INTER} weight={500} color={K.muted} tracking={0} />
            <Stage>
              {(() => {
                // from screen-filling to full stop: the dive continues as a shrink, then a drop and a squash
                const land = CUE.land;
                const rr = t < land ? mix(1300, ED.r, big) : ED.r;
                const x = t < land ? mix(960, ED.x, big) : ED.x;
                const y = t < land ? mix(540, ED.y, big) - Math.sin(big * Math.PI) * 120 : ED.y;
                const s = t - land;
                const sq = s >= 0 && s < 0.12 ? 1 - 0.42 * Math.sin((s / 0.12) * Math.PI) : 1;
                return <Dot x={x} y={y} r={rr} squash={sq} />;
              })()}
            </Stage>
          </Camera>
        </AbsoluteFill>
      )}

      <Grain />
      <Audio src={staticFile("mix.wav")} />
    </AbsoluteFill>
  );
};
