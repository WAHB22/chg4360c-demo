// The opening ritual. First open of the day (2 s): a soft white fade, the
// vista comes into focus from a slight blur, ICON looks up, the lamp brightens.
// Every other open: a 0.5 s fade. Skippable in Settings and with ?intro=0.
// Reduced motion: a 200 ms fade.

import { h, play, wait, reducedMotion } from './dom.js';

export async function runIntro({ vista, first, skip }) {
  const veil = h('div', { class: 'intro', 'aria-hidden': 'true' });
  document.body.appendChild(veil);
  if (skip) {
    veil.remove();
    return;
  }
  if (reducedMotion()) {
    await play(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    veil.remove();
    return;
  }
  if (!first) {
    await play(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
    veil.remove();
    return;
  }
  const lamp = h('div', { class: 'intro-lamp', 'aria-hidden': 'true' });
  if (vista) vista.appendChild(lamp);
  const focus = vista
    ? play(vista, [{ filter: 'blur(8px) saturate(.85)', transform: 'scale(1.02)' }, { filter: 'blur(0px) saturate(1)', transform: 'scale(1)' }], { duration: 2000, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'none' })
    : Promise.resolve();
  const fade = play(veil, [{ opacity: 1 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0 }], { duration: 2000, easing: 'cubic-bezier(.4,0,.2,1)' });
  const glow = play(lamp, [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0.35 }], { duration: 2000, easing: 'ease-in-out' });
  lookUp();
  await Promise.all([focus, fade, glow]);
  veil.remove();
  play(lamp, [{ opacity: 0.35 }, { opacity: 0 }], { duration: 1600, easing: 'ease-out' }).then(() => lamp.remove());
}

// ICON lifts his head: a small rise and settle on his sprite, with weight.
async function lookUp() {
  await wait(800);
  const icon = document.querySelector('.sao-bot[data-bot="icon"] .sao-body > svg');
  if (!icon) return;
  play(
    icon,
    [
      { transform: 'translateY(0) scaleY(1)' },
      { transform: 'translateY(1px) scaleY(.97)', offset: 0.25 },
      { transform: 'translateY(-3px) scaleY(1.03)', offset: 0.6 },
      { transform: 'translateY(0) scaleY(1)' },
    ],
    { duration: 900, easing: 'cubic-bezier(.3,0,.3,1)', fill: 'none' },
  );
}
