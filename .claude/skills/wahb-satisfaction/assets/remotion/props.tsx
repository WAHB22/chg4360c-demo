import React from "react";
import { K, SERIF, INTER, GROTESK } from "./kit";

/** The idea bulb. on: 0 dead .. 1 lit. */
export const Bulb: React.FC<{ x: number; y: number; s?: number; on: number; rays?: number; rot?: number }> = ({ x, y, s = 1, on, rays = 0, rot = 0 }) => {
  const glass = on > 0.5 ? "#FFF4DA" : "#4A4D58";
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      {on > 0 && <circle cx={0} cy={-6} r={170} fill="url(#bulbGlow)" opacity={on} />}
      {rays > 0 && Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r0 = 70, r1 = 70 + 34 * rays;
        return <path key={i} d={`M${Math.cos(a) * r0} ${Math.sin(a) * r0 - 8} L${Math.cos(a) * r1} ${Math.sin(a) * r1 - 8}`} stroke={K.accent} strokeWidth={9} strokeLinecap="round" opacity={Math.min(1, rays * 1.4)} />;
      })}
      <g filter="url(#cut)">
        <path d="M-46 -10 C-46 -40 -24 -58 0 -58 C24 -58 46 -40 46 -10 C46 10 32 22 26 36 L-26 36 C-32 22 -46 10 -46 -10Z" fill={glass} />
        <path d="M-10 34 L-10 10 M10 34 L10 10 M-10 10 q3.3 -9 6.6 0 q3.3 9 6.7 0 q3.3 -9 6.7 0" stroke={on > 0.5 ? K.accent : "#2A2C33"} strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-28 -30 Q-20 -44 -6 -46" stroke="#fff" strokeOpacity={on > 0.5 ? 0.9 : 0.25} strokeWidth={6} fill="none" strokeLinecap="round" />
        <rect x={-26} y={36} width={52} height={12} rx={4} fill="#A9A9B2" />
        <rect x={-23} y={48} width={46} height={11} rx={4} fill="#8B8B94" />
        <rect x={-18} y={59} width={36} height={10} rx={5} fill="#6E6E77" />
      </g>
    </g>
  );
};

/** A paper coin with a serif dollar sign. */
export const Coin: React.FC<{ x: number; y: number; s?: number; rot?: number; spin?: number }> = ({ x, y, s = 1, rot = 0, spin = 1 }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s * Math.max(0.12, Math.abs(spin))} ${s})`} filter="url(#cut)">
    <circle r={30} fill={K.accent} />
    <circle r={22} fill="none" stroke={K.accentDark} strokeWidth={3} />
    <text x={0} y={11} textAnchor="middle" fontFamily={SERIF} fontWeight={700} fontSize={32} fill={K.paper}>$</text>
  </g>
);

/** A little flag on a pole. wave: 0..1 unfurl. */
export const Flag: React.FC<{ x: number; y: number; unfurl: number; t: number; rot?: number }> = ({ x, y, unfurl, t, rot = 0 }) => {
  const w = 90 * unfurl;
  const wob = Math.sin(t * 9) * 6 * unfurl;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} filter="url(#cut)">
      <rect x={-4} y={-150} width={8} height={150} rx={3} fill={K.paper} />
      {unfurl > 0.02 && <path d={`M4 -148 Q${w / 2} ${-160 + wob} ${w} ${-140 + wob} L${w} ${-100 + wob} Q${w / 2} ${-116 - wob} 4 -100Z`} fill={K.accent} />}
    </g>
  );
};

/** An email card: "Thank you for your application". */
export const MailCard: React.FC<{ x: number; y: number; rot?: number; s?: number; i?: number; w?: number }> = ({ x, y, rot = 0, s = 1, i = 0, w = 340 }) => {
  const senders = ["Careers Team", "Talent Acquisition", "HR Department", "Recruiting", "People Ops", "Hiring Team"];
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} filter="url(#cut)">
      <rect x={-w / 2} y={-52} width={w} height={104} rx={14} fill={K.paper} />
      <circle cx={-w / 2 + 38} cy={-8} r={20} fill={["#C9C4B8", "#B9B4A8", "#D6D0C3"][i % 3]} />
      <text x={-w / 2 + 70} y={-18} fontFamily={INTER} fontWeight={600} fontSize={17} fill="#6B6B72">{senders[i % senders.length]}</text>
      <text x={-w / 2 + 70} y={6} fontFamily={INTER} fontWeight={700} fontSize={19} fill={K.ink}>Thank you for your application</text>
      <rect x={-w / 2 + 70} y={20} width={w - 110} height={8} rx={4} fill="#DAD5CA" />
      <rect x={-w / 2 + 70} y={34} width={(w - 110) * 0.6} height={8} rx={4} fill="#E4E0D7" />
    </g>
  );
};

/** The Spitch wordmark in serif, with the orange dot. */
export const Wordmark: React.FC<{ x: number; y: number; size: number; color?: string; letters?: number; letterT?: (i: number) => { dy: number; o: number; r: number; s: number }; dot?: number }> = ({ x, y, size, color = K.paper, letterT, dot = 1 }) => {
  const L = "SPITCH".split("");
  const adv = [0.556, 0.611, 0.389, 0.667, 0.722, 0.778].map((a) => a * size); // Times Bold advance widths
  const total = adv.reduce((a, b) => a + b, 0) + size * 0.3;
  let cx = x - total / 2;
  return (
    <g>
      {L.map((ch, i) => {
        const w = adv[i];
        const lt = letterT ? letterT(i) : { dy: 0, o: 1, r: 0, s: 1 };
        const gx = cx + w / 2;
        cx += w;
        return (
          <text key={i} x={0} y={0} transform={`translate(${gx} ${y + lt.dy}) rotate(${lt.r}) scale(${lt.s})`} textAnchor="middle" fontFamily={SERIF} fontWeight={700} fontSize={size} fill={color} opacity={lt.o}>{ch}</text>
        );
      })}
      {dot > 0 && <circle cx={cx + size * 0.14} cy={y - size * 0.09} r={size * 0.1 * dot} fill={K.accent} />}
    </g>
  );
};

/** A pitch card, styled after the website's example cards. */
export const PitchCard: React.FC<{ w: number; title: string; desc: string; needs: string[]; score: number; stamp?: "like" | "nope" | null; stampK?: number; thumb?: React.ReactNode }> = ({ w, title, desc, needs, score, stamp, stampK = 0, thumb }) => {
  const h = w * 1.42;
  const pad = w * 0.06;
  const vh = w * 0.56;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={w * 0.05} fill="#FFFFFF" />
      <g>
        <clipPath id={`thumb-${title.replace(/\W/g, "")}`}><rect x={pad} y={pad} width={w - pad * 2} height={vh} rx={w * 0.035} /></clipPath>
        <g clipPath={`url(#thumb-${title.replace(/\W/g, "")})`}>
          <rect x={pad} y={pad} width={w - pad * 2} height={vh} fill={K.ink} />
          <circle cx={w - pad - w * 0.12} cy={pad + vh - w * 0.02} r={w * 0.2} fill={K.accent} />
          <circle cx={pad + w * 0.02} cy={pad + w * 0.1} r={w * 0.09} fill="#23252C" />
          {thumb}
        </g>
        <text x={pad + w * 0.04} y={pad + w * 0.08} fontFamily={INTER} fontWeight={600} fontSize={w * 0.04} fill={K.paper}>Video pitch</text>
        {!thumb && <g transform={`translate(${w / 2} ${pad + vh / 2})`}><circle r={w * 0.07} fill={K.paper} /><path d={`M${-w * 0.02} ${-w * 0.032} L${w * 0.035} 0 L${-w * 0.02} ${w * 0.032}Z`} fill={K.ink} /></g>}
      </g>
      <text x={pad} y={pad + vh + w * 0.1} fontFamily={GROTESK} fontWeight={700} fontSize={w * 0.066} fill={K.ink}>{title}</text>
      <text x={pad} y={pad + vh + w * 0.17} fontFamily={INTER} fontWeight={400} fontSize={w * 0.042} fill="#55555C">{desc}</text>
      <text x={pad} y={pad + vh + w * 0.26} fontFamily={INTER} fontWeight={500} fontSize={w * 0.036} fill="#6B6B72">Needs</text>
      {needs.map((n, i) => {
        const cw = n.length * w * 0.024 + w * 0.06;
        const xx = pad + needs.slice(0, i).reduce((a, b) => a + b.length * w * 0.024 + w * 0.08, 0);
        return (
          <g key={n} transform={`translate(${xx} ${pad + vh + w * 0.29})`}>
            <rect width={cw} height={w * 0.07} rx={w * 0.035} fill="#F1EEE7" />
            <text x={cw / 2} y={w * 0.047} textAnchor="middle" fontFamily={INTER} fontWeight={600} fontSize={w * 0.033} fill={K.ink}>{n}</text>
          </g>
        );
      })}
      <text x={pad} y={h - pad - w * 0.1} fontFamily={INTER} fontWeight={500} fontSize={w * 0.036} fill="#6B6B72">Compatibility</text>
      {Array.from({ length: 5 }, (_, i) => <circle key={i} cx={w - pad - w * 0.2 + i * w * 0.035} cy={h - pad - w * 0.112} r={w * 0.013} fill={i < score ? K.accent : "#DAD5CA"} />)}
      <g transform={`translate(${w / 2 - w * 0.09} ${h - pad - w * 0.02})`}><circle r={w * 0.05} fill="#fff" stroke="#DAD5CA" strokeWidth={2} /><path d={`M${-w * 0.015} ${-w * 0.015} L${w * 0.015} ${w * 0.015} M${w * 0.015} ${-w * 0.015} L${-w * 0.015} ${w * 0.015}`} stroke={K.ink} strokeWidth={3} strokeLinecap="round" /></g>
      <g transform={`translate(${w / 2 + w * 0.09} ${h - pad - w * 0.02})`}><circle r={w * 0.05} fill={K.accent} /><Heart s={w * 0.0014} color={K.ink} /></g>
      {stamp && stampK > 0 && (
        <g transform={`translate(${stamp === "like" ? w * 0.28 : w * 0.72} ${h * 0.26}) rotate(${stamp === "like" ? -16 : 16}) scale(${1.5 - 0.5 * Math.min(1, stampK)})`} opacity={Math.min(1, stampK * 1.5)}>
          <rect x={-w * 0.2} y={-w * 0.08} width={w * 0.4} height={w * 0.16} rx={w * 0.03} fill="none" stroke={stamp === "like" ? K.accent : "#8E8E97"} strokeWidth={w * 0.018} />
          <text x={0} y={w * 0.045} textAnchor="middle" fontFamily={GROTESK} fontWeight={700} fontSize={w * 0.1} fill={stamp === "like" ? K.accent : "#8E8E97"}>{stamp === "like" ? "YES" : "PASS"}</text>
        </g>
      )}
    </g>
  );
};

/** A small heart (centred on 0,0, about 34 units wide at s=1). */
export const Heart: React.FC<{ s?: number; color?: string }> = ({ s = 1, color = K.accent }) => (
  <path transform={`scale(${s * 1})`} d="M0 12 C-18 0 -18 -14 -8 -16 C-3 -17 0 -13 0 -10 C0 -13 3 -17 8 -16 C18 -14 18 0 0 12Z" fill={color} />
);

/** Paper coffee cup with an orange sleeve and lid. */
export const Cup: React.FC<{ x: number; y: number; s?: number; rot?: number; steam?: number; t: number }> = ({ x, y, s = 1, rot = 0, steam = 1, t }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    {steam > 0 && [-26, 0, 26].map((dx, i) => {
      const ph = t * 1.6 + i * 0.7;
      const k = (ph % 1);
      return <path key={i} d={`M${dx} ${-150 - k * 60} q12 -18 0 -36 q-12 -18 0 -36`} stroke={K.paper} strokeWidth={7} fill="none" strokeLinecap="round" opacity={steam * 0.55 * Math.sin(k * Math.PI)} />;
    })}
    <g filter="url(#cut)">
      <path d="M-78 -118 L78 -118 L62 110 Q60 124 46 124 L-46 124 Q-60 124 -62 110Z" fill={K.paper} />
      <path d="M-73 -40 L73 -40 L67 46 L-67 46Z" fill={K.accent} />
      <circle cx={0} cy={3} r={14} fill={K.paper} />
      <rect x={-92} y={-142} width={184} height={30} rx={12} fill="#D9D3C7" />
      <rect x={-70} y={-158} width={140} height={20} rx={8} fill="#CFC8BA" />
    </g>
  </g>
);

/** A chat bubble with a tail. */
export const Bubble: React.FC<{ x: number; y: number; w: number; h: number; fill: string; tail?: "left" | "right" | "down"; children?: React.ReactNode; s?: number }> = ({ x, y, w, h, fill, tail = "left", children, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x={0} y={0} width={w} height={h} rx={Math.min(28, h / 2)} fill={fill} />
    {tail === "left" && <path d={`M18 ${h - 16} L-6 ${h + 6} L40 ${h - 4}Z`} fill={fill} />}
    {tail === "right" && <path d={`M${w - 18} ${h - 16} L${w + 6} ${h + 6} L${w - 40} ${h - 4}Z`} fill={fill} />}
    {tail === "down" && <path d={`M${w * 0.2} ${h - 4} L${w * 0.14} ${h + 30} L${w * 0.34} ${h - 4}Z`} fill={fill} />}
    {children}
  </g>
);
