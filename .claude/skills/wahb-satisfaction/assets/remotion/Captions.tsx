import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FPS, SEGMENTS } from "../config";
import { K, SERIF, pop } from "./kit";

/** Key words per line: orange, and the AI chat box in chat-assistant green. */
const HL: Record<string, string[]> = {
  l1: ["idea"], l2: ["financial", "freedom"], l3: ["died"], l4: ["means", "live"],
  l5a: ["projects"], l5r: ["resume"], l5b: ["rough"], l6a: ["tired"], l6b: ["thanks", "for", "your", "application"],
  l7a: ["introducing"], l7b: ["spitch"], l8: ["broadcast", "visibility", "partnerships", "collaborations"],
  l9: ["less", "than", "a", "minute", "swipe", "right", "left", "connect"],
  l10a: ["pitchers", "builders", "means", "skills"], l10b: ["price", "of", "a", "coffee"],
  l11: ["market", "uottawa"], l12: ["fourth-year", "engineering", "live", "this", "problem"],
  l13: ["linkedin", "let's", "chat"], l14: ["swipe", "right"],
};
const GREEN: Record<string, string[]> = { l3: ["ai", "chat", "box"] };
const norm = (w: string) => w.toLowerCase().replace(/[^a-z'-]/g, "").replace(/^'|'$/g, "");
const pretty = (w: string) => w.replace(/^'/, "‘").replace(/'$/, "’").replace(/^resume$/, "résumé");

type Word = { w: string; start: number; color?: string };
type Chunk = { words: Word[]; start: number; end: number };

/** Short creator-style chunks: at most 5 words, broken after punctuation, never leaving a one-word orphan. */
function build(): Chunk[] {
  const lines: { id: string; end: number; words: (Word & { seg: string })[] }[] = [];
  for (const s of SEGMENTS) {
    const words = s.words.filter((w) => /[A-Za-z]/.test(w.w)).map((w) => ({ w: w.w, start: w.start, seg: s.id }));
    const g = lines[lines.length - 1];
    if (g && ["l5r", "l5c", "l5b", "l6b", "l6c"].includes(s.id)) { g.words.push(...words); g.end = s.end; }
    else lines.push({ id: s.id, end: s.end, words });
  }
  const out: Chunk[] = [];
  for (const ln of lines) {
    let cur: typeof ln.words = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({
        start: cur[0].start, end: 0,
        words: cur.map((w) => {
          const n = norm(w.w);
          return { w: pretty(w.w), start: w.start, color: GREEN[w.seg]?.includes(n) ? K.ai : HL[w.seg]?.includes(n) ? K.accent : undefined };
        }),
      });
      cur = [];
    };
    ln.words.forEach((w, i) => {
      cur.push(w);
      const left = ln.words.length - 1 - i;
      if (left === 0 || (left > 1 && (cur.length >= 5 || (cur.length >= 2 && /[,.?]$/.test(w.w))))) flush();
    });
    out[out.length - 1].end = ln.end + 0.4;
  }
  for (let i = 0; i < out.length; i++) {
    if (!out[i].end) out[i].end = out[i + 1].start;
    if (out[i + 1] && out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
  }
  return out;
}
const CHUNKS = build();

const OUTLINE = [
  [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3],
].map(([x, y]) => `${x}px ${y}px 0 ${K.ink}`).join(",") + `, 0 8px 18px rgba(0,0,0,0.55)`;

export const Captions: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  if (t < from || t >= to) return null;
  const c = CHUNKS.find((x) => t >= x.start - 0.04 && t < x.end);
  if (!c) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 96 }}>
      <div style={{ maxWidth: 1500, textAlign: "center", fontFamily: SERIF, fontWeight: 700, fontSize: 74, lineHeight: 1.12, letterSpacing: -0.5 }}>
        {c.words.map((w, i) => {
          const k = pop(t, w.start - 0.03, { damping: 13, stiffness: 260, mass: 0.5 });
          const shown = t >= w.start - 0.03;
          return (
            <span key={i} style={{ display: "inline-block", marginRight: i < c.words.length - 1 ? 18 : 0, color: w.color ?? "#fff", textShadow: OUTLINE, opacity: shown ? Math.min(1, k * 1.6) : 0, transform: `translateY(${(1 - k) * 14}px) scale(${0.82 + 0.18 * k})` }}>
              {w.w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
