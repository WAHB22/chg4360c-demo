import React from "react";
import { GROTESK, INTER, K, MONO, SERIF } from "./kit";

/** One thought, drawn centred on (0,0). Everything is paper, ink and one orange; AI things are green. */
export type ThoughtData = { kind: string; lines: string[]; w: number; h: number; fs?: number };

const isDate = (s: string) => /\b(Oct|oct|Nov|yesterday|due)\b/.test(s);

/** Hard cut-paper shadow: the silhouette, offset down. lift = how far the paper is off the table. */
export const Shadow: React.FC<{ d: ThoughtData; lift: number }> = ({ d, lift }) => {
  const { kind, w, h } = d;
  const o = { transform: `translate(${lift * 0.35}px, ${lift}px)` };
  if (kind === "word") return null; // type casts its own shadow (see Word)
  if (kind === "ring") return <circle cx={0} cy={0} r={w / 2} fill="#000" opacity={0.42} style={o} />;
  return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={kind === "term" ? 14 : 6} fill="#000" opacity={0.42} style={o} />;
};

const Ticket: React.FC<{ d: ThoughtData }> = ({ d }) => {
  const { w, h, lines } = d;
  const teeth = 14;
  return (
    <g>
      <path d={`M${-w / 2} ${-h / 2} H${w / 2} V${h / 2} ${Array.from({ length: teeth }, (_, i) => { const x1 = w / 2 - (w / teeth) * (i + 0.5), x2 = w / 2 - (w / teeth) * (i + 1); return `L${x1} ${h / 2 - 10} L${x2} ${h / 2}`; }).join(" ")} Z`} fill={K.paper} />
      <rect x={-w / 2} y={-h / 2} width={w} height={46} fill={K.ink3} />
      <text x={-w / 2 + 20} y={-h / 2 + 31} fontFamily={GROTESK} fontWeight={700} fontSize={23} letterSpacing={0.5} fill={K.paper}>{lines[0]}</text>
      <text x={-w / 2 + 20} y={-h / 2 + 84} fontFamily={INTER} fontWeight={500} fontSize={22} fill={K.mutedLight}>{lines[1]}</text>
      <line x1={-w / 2 + 20} x2={w / 2 - 20} y1={-h / 2 + 100} y2={-h / 2 + 100} stroke="#CFCAC0" strokeWidth={2} strokeDasharray="6 6" />
      <text x={-w / 2 + 20} y={-h / 2 + 146} fontFamily={GROTESK} fontWeight={700} fontSize={lines[2].length > 14 ? 26 : 34} letterSpacing={-0.5} fill={K.ink}>{lines[2]}</text>
    </g>
  );
};

const Ring: React.FC<{ d: ThoughtData; k: number }> = ({ d, k }) => {
  const r = d.w / 2;
  const ra = r - 26;
  const a = 0.72 * Math.min(1, k);
  const end = -Math.PI / 2 + a * Math.PI * 2;
  return (
    <g>
      <circle r={r} fill={K.paper} />
      <circle r={ra} fill="none" stroke="#E2DED5" strokeWidth={16} />
      <path d={`M0 ${-ra} A${ra} ${ra} 0 ${a > 0.5 ? 1 : 0} 1 ${Math.cos(end) * ra} ${Math.sin(end) * ra}`} fill="none" stroke={K.accent} strokeWidth={16} strokeLinecap="round" />
      <text x={0} y={-6} textAnchor="middle" fontFamily={GROTESK} fontWeight={700} fontSize={30} letterSpacing={1} fill={K.ink}>{d.lines[0]}</text>
      <text x={0} y={34} textAnchor="middle" fontFamily={GROTESK} fontWeight={500} fontSize={30} fill={K.accentDark}>{d.lines[1]}</text>
    </g>
  );
};

const Stamp: React.FC<{ d: ThoughtData; k: number }> = ({ d, k }) => {
  const { w, h, lines } = d;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={K.paper} />
      <text x={-w / 2 + 22} y={-h / 2 + 40} fontFamily={GROTESK} fontWeight={700} fontSize={24} fill={K.mutedLight}>{lines[0]}</text>
      <text x={-w / 2 + 20} y={-h / 2 + 106} fontFamily={SERIF} fontWeight={700} fontSize={62} letterSpacing={-1.5} fill={K.ink}>{lines[1]}</text>
      <text x={-w / 2 + 22} y={-h / 2 + 168} fontFamily={INTER} fontWeight={700} fontSize={30} fill={K.ink}>{lines[2]}</text>
      {/* hand drawn circle around the date */}
      <path d={`M${-w / 2 + 8} ${-h / 2 + 158} C${-w / 2 + 10} ${-h / 2 + 124} ${-w / 2 + 140} ${-h / 2 + 122} ${-w / 2 + 146} ${-h / 2 + 156} C${-w / 2 + 150} ${-h / 2 + 190} ${-w / 2 + 20} ${-h / 2 + 196} ${-w / 2 + 12} ${-h / 2 + 166} L${-w / 2 + 22} ${-h / 2 + 140}`}
        fill="none" stroke={K.accent} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, Math.max(0, (k - 0.2) * 1.6))} />
      <g transform={`translate(${w / 2 - 70} ${h / 2 - 52}) rotate(-14)`} opacity={k > 0.55 ? 1 : 0} filter="url(#stamp)">
        <rect x={-58} y={-30} width={116} height={60} rx={6} fill="none" stroke={K.accentDark} strokeWidth={5} />
        <text x={0} y={14} textAnchor="middle" fontFamily={GROTESK} fontWeight={700} fontSize={38} fill={K.accentDark}>{lines[3]}</text>
      </g>
    </g>
  );
};

const Term: React.FC<{ d: ThoughtData; k: number; t: number }> = ({ d, k, t }) => {
  const { w, h, lines } = d;
  // characters appear as if typed
  const chars = Math.floor(k * lines.join("").length);
  let left = chars;
  const thinking = lines[1] === "Claude is thinking";
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={14} fill={K.ink2} stroke={K.ink3} strokeWidth={2} />
      {[0, 1, 2].map((i) => <circle key={i} cx={-w / 2 + 24 + i * 20} cy={-h / 2 + 22} r={6} fill={K.ink3} />)}
      {lines.map((ln, i) => {
        const show = thinking && i === 1 ? ln : ln.slice(0, Math.max(0, left));
        if (!(thinking && i === 1)) left -= ln.length;
        const prompt = show.startsWith(">") || show.startsWith("$");
        const y = -h / 2 + 66 + i * 34;
        if (thinking && i === 1) {
          if (k < 0.6) return null;
          const a = t * 6;
          return (
            <g key={i}>
              <g transform={`translate(${-w / 2 + 34} ${y - 8}) rotate(${(a * 180) / Math.PI})`}>
                {[0, 1, 2, 3, 4, 5].map((j) => <line key={j} x1={0} y1={0} x2={Math.cos((j * Math.PI) / 3) * 10} y2={Math.sin((j * Math.PI) / 3) * 10} stroke={K.ai} strokeWidth={3} strokeLinecap="round" />)}
              </g>
              <text x={-w / 2 + 56} y={y} fontFamily={MONO} fontSize={22} fill={K.muted}>{ln}</text>
            </g>
          );
        }
        return (
          <text key={i} x={-w / 2 + 24} y={y} fontFamily={MONO} fontSize={23} fill={K.paper}>
            {prompt ? <tspan fill={K.ai} fontWeight={700}>{show[0]}</tspan> : null}
            {prompt ? show.slice(1) : show}
          </text>
        );
      })}
    </g>
  );
};

const Card: React.FC<{ d: ThoughtData }> = ({ d }) => {
  const { w, h, lines } = d;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={K.paper} />
      <rect x={-w / 2} y={-h / 2} width={8} height={h} rx={2} fill={K.ink3} />
      <text x={-w / 2 + 28} y={-h / 2 + 50} fontFamily={GROTESK} fontWeight={700} fontSize={lines[0].length > 14 ? 26 : 32} letterSpacing={-0.4} fill={K.ink}>{lines[0]}</text>
      {lines.slice(1).map((ln, i) => (
        <text key={i} x={-w / 2 + 28} y={-h / 2 + 96 + i * 38} fontFamily={INTER} fontWeight={i === lines.length - 2 && isDate(ln) ? 700 : 500} fontSize={ln.length > 20 ? 21 : 25}
          fill={i === lines.length - 2 && isDate(ln) ? K.accentDark : K.mutedLight}>{ln}</text>
      ))}
    </g>
  );
};

/** A bare thought in display type, floating on the ink. A final full stop is the orange dot's colour. */
export const Word: React.FC<{ d: ThoughtData; lift: number }> = ({ d, lift }) => {
  const s = d.lines[0];
  const fs = d.fs || 84;
  const stop = s.endsWith(".");
  const body = stop ? s.slice(0, -1) : s;
  const common = { x: -d.w / 2 + 20, y: fs * 0.34, fontFamily: SERIF, fontWeight: 700, fontSize: fs, letterSpacing: -0.025 * fs };
  return (
    <g>
      <text {...common} fill="#000" opacity={0.5} transform={`translate(${lift * 0.35} ${lift})`}>{s}</text>
      <text {...common} fill={K.paper}>{body}{stop ? <tspan fill={K.accent}>.</tspan> : null}</text>
    </g>
  );
};

const Mail: React.FC<{ d: ThoughtData }> = ({ d }) => {
  const { w } = d;
  return (
    <g>
      <rect x={-w / 2} y={-55} width={w} height={110} rx={14} fill={K.paper} />
      <circle cx={-w / 2 + 42} cy={-6} r={22} fill="#C9C4B8" />
      <text x={-w / 2 + 80} y={-18} fontFamily={INTER} fontWeight={600} fontSize={18} fill={K.mutedLight}>Careers Team</text>
      <text x={-w / 2 + 80} y={8} fontFamily={INTER} fontWeight={700} fontSize={21} fill={K.ink}>{d.lines[0]}</text>
      <rect x={-w / 2 + 80} y={22} width={w - 120} height={8} rx={4} fill="#DAD5CA" />
      <rect x={-w / 2 + 80} y={36} width={(w - 120) * 0.6} height={8} rx={4} fill="#E4E0D7" />
    </g>
  );
};

const Sketch: React.FC<{ d: ThoughtData; k: number; t: number }> = ({ d, k, t }) => {
  const { w, h, lines } = d;
  const kind = lines[1];
  const dr = (a: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - Math.max(0, Math.min(1, (k - a) * 2.2)) });
  const ink = { fill: "none", stroke: K.ink, strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let art: React.ReactNode = null;
  if (kind === "mol") {
    // SN2: nucleophile, carbon centre, leaving group, curved arrow
    art = (
      <g transform="translate(0 -22)">
        <path d="M-30 0 L30 0 M0 0 L-18 -34 M0 0 L-18 34 M30 0 L62 0" {...ink} {...dr(0.1)} />
        <text x={70} y={9} fontFamily={INTER} fontWeight={700} fontSize={26} fill={K.ink}>Br</text>
        <text x={-112} y={9} fontFamily={INTER} fontWeight={700} fontSize={26} fill={K.ink}>HO</text>
        <text x={-60} y={-14} fontFamily={INTER} fontWeight={700} fontSize={18} fill={K.ink}>−</text>
        <path d="M-70 -20 C-60 -70 -10 -70 -4 -14" fill="none" stroke={K.accent} strokeWidth={4} strokeLinecap="round" {...dr(0.35)} />
        <path d="M-12 -24 L-4 -12 L4 -25" fill="none" stroke={K.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={k > 0.7 ? 1 : 0} />
      </g>
    );
  } else if (kind === "pid") {
    art = (
      <g transform="translate(0 -26)" fontFamily={INTER} fontWeight={700} fontSize={22}>
        <circle cx={-104} cy={0} r={14} {...ink} {...dr(0.05)} />
        <rect x={-66} y={-24} width={58} height={48} {...ink} {...dr(0.15)} />
        <rect x={34} y={-24} width={58} height={48} {...ink} {...dr(0.25)} />
        <path d="M-130 0 H-118 M-90 0 H-66 M-8 0 H34 M92 0 H128 M112 0 V48 H-104 V14" {...ink} {...dr(0.35)} />
        <text x={-37} y={8} textAnchor="middle" fill={K.ink}>PID</text>
        <text x={63} y={8} textAnchor="middle" fill={K.ink}>G</text>
      </g>
    );
  } else if (kind === "lap") {
    art = <text x={0} y={-8} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontWeight={700} fontSize={46} fill={K.ink}>{lines[0]}</text>;
  } else if (kind === "rx") {
    const a = t * 7;
    art = (
      <g transform="translate(0 -30)">
        <path d="M-56 -50 V36 Q-56 56 -36 56 H36 Q56 56 56 36 V-50" {...ink} {...dr(0.05)} />
        <path d="M0 -70 V28" {...ink} {...dr(0.25)} />
        <path d={`M${-26 * Math.cos(a)} 28 L${26 * Math.cos(a)} 28`} {...ink} opacity={k > 0.6 ? 1 : 0} />
        <path d="M-90 -30 H-56 M56 20 H92" {...ink} {...dr(0.35)} />
        <path d="M-56 0 Q-28 -8 0 0 T56 0" fill="none" stroke={K.accent} strokeWidth={3} opacity={k > 0.5 ? 0.9 : 0} />
      </g>
    );
  }
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={K.paper} />
      {art}
      <text x={0} y={h / 2 - 26} textAnchor="middle" fontFamily={INTER} fontWeight={600} fontSize={24} fill={K.mutedLight}>{kind === "lap" ? "Laplace, again" : lines[0]}</text>
    </g>
  );
};

const Jar: React.FC<{ d: ThoughtData; k: number }> = ({ d, k }) => {
  const { w, h } = d;
  const fill = 0.32 * Math.min(1, k);
  const top = -h / 2 + 40;
  const bottom = h / 2 - 18;
  const level = bottom - (bottom - top) * fill;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={K.paper} />
      <path d={`M${-w / 2 + 34} ${level} H${w / 2 - 34} V${bottom - 14} Q${w / 2 - 34} ${bottom} ${w / 2 - 48} ${bottom} H${-w / 2 + 48} Q${-w / 2 + 34} ${bottom} ${-w / 2 + 34} ${bottom - 14} Z`} fill={K.accent} opacity={0.9} />
      <path d={`M${-w / 2 + 44} ${top} V${top - 14} H${w / 2 - 44} V${top} M${-w / 2 + 34} ${top} H${w / 2 - 34} V${bottom - 14} Q${w / 2 - 34} ${bottom} ${w / 2 - 48} ${bottom} H${-w / 2 + 48} Q${-w / 2 + 34} ${bottom} ${-w / 2 + 34} ${bottom - 14} Z`}
        fill="none" stroke={K.ink} strokeWidth={4} strokeLinejoin="round" />
      <rect x={-w / 2 + 50} y={top + 36} width={w - 100} height={50} rx={4} fill={K.paper} stroke={K.ink} strokeWidth={3} />
      <text x={0} y={top + 70} textAnchor="middle" fontFamily={GROTESK} fontWeight={700} fontSize={28} fill={K.ink}>{d.lines[0]}</text>
    </g>
  );
};

export const ThoughtBody: React.FC<{ d: ThoughtData; k: number; t: number }> = ({ d, k, t }) => {
  switch (d.kind) {
    case "ticket": return <Ticket d={d} />;
    case "ring": return <Ring d={d} k={k} />;
    case "stamp": return <Stamp d={d} k={k} />;
    case "term": return <Term d={d} k={k} t={t} />;
    case "mail": return <Mail d={d} />;
    case "sketch": return <Sketch d={d} k={k} t={t} />;
    case "jar": return <Jar d={d} k={k} />;
    default: return <Card d={d} />;
  }
};

/** Small far-away thoughts for the zoom out. Cheap: no filters. */
export const BgCard: React.FC<{ kind: string; lines: string[] }> = ({ kind, lines }) => {
  if (kind === "word")
    return <text x={0} y={20} textAnchor="middle" fontFamily={SERIF} fontWeight={700} fontSize={64} letterSpacing={-1.5} fill={K.paper} opacity={0.85}>{lines[0]}</text>;
  const term = kind === "term";
  return (
    <g>
      <rect x={-140 + 6} y={-70 + 14} width={280} height={140} rx={term ? 12 : 5} fill="#000" opacity={0.4} />
      <rect x={-140} y={-70} width={280} height={140} rx={term ? 12 : 5} fill={term ? K.ink2 : K.paper} stroke={term ? K.ink3 : "none"} strokeWidth={2} />
      <text x={-118} y={-22} fontFamily={term ? MONO : GROTESK} fontWeight={700} fontSize={26} fill={term ? K.paper : K.ink}>{lines[0].slice(0, 18)}</text>
      {lines[1] ? <text x={-118} y={20} fontFamily={INTER} fontWeight={500} fontSize={22} fill={term ? K.muted : K.mutedLight}>{lines[1].slice(0, 22)}</text> : null}
      <rect x={-118} y={38} width={150} height={8} rx={4} fill={term ? K.ink3 : "#DAD5CA"} />
    </g>
  );
};
