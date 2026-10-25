// Sound, off by default. Ambient: a soft wind made from filtered noise with a
// slow swell. Ambient plus cues: the same, plus a small two note bell when a
// question or a report arrives. Made in code with Web Audio (no files), only
// after an intentional action, and silent in quiet hours or a hidden tab.

let ctx = null;
let master = null;
let wind = null;
let mode = 'off';
let quiet = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

function startWind() {
  if (!ensure() || wind) return;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.4;
  const swell = ctx.createGain();
  swell.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 0.25;
  lfo.connect(lfoAmt).connect(swell.gain);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.045;
  const lfo2Amt = ctx.createGain();
  lfo2Amt.gain.value = 180;
  lfo2.connect(lfo2Amt).connect(lp.frequency);
  src.connect(lp).connect(swell).connect(master);
  src.start();
  lfo.start();
  lfo2.start();
  wind = { src, lfo, lfo2 };
}

function level() {
  if (!ctx || !master) return;
  const on = mode !== 'off' && !quiet && !document.hidden;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(on ? 0.22 : 0, t, on ? 1.2 : 0.3);
}

// Called from the Settings choice (an intentional action) or the first tap
// after load when a sound choice was saved earlier.
export function setSound(m) {
  mode = m === 'ambient' || m === 'cues' ? m : 'off';
  if (mode === 'off') {
    level();
    return;
  }
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  startWind();
  level();
}

export function setSoundQuiet(q) {
  quiet = !!q;
  level();
}

export function cue() {
  if (mode !== 'cues' || quiet || !ctx || document.hidden) return;
  const t = ctx.currentTime + 0.02;
  [[784, 0], [1175, 0.16]].forEach(([f, dt]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + dt);
    g.gain.linearRampToValueAtTime(0.12, t + dt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.6);
    o.connect(g).connect(ctx.destination);
    o.start(t + dt);
    o.stop(t + dt + 1.7);
  });
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', level);
