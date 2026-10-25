// Small DOM helpers for the SAO interface. No dependencies.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}

export function clear(el) {
  if (el) while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Visible copy must never carry dashes: em dash, en dash or a spaced hyphen.
// Data from the engine passes through here before it is shown.
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export function reducedMotion() {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return !!(mq && mq.matches);
}

// Web Animations with a reduced motion fallback: a 200 ms fade, or nothing.
export function play(el, frames, opts = {}) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  let f = frames;
  let o = { fill: 'both', ...opts };
  if (reducedMotion()) {
    const first = frames[0] || {};
    const last = frames[frames.length - 1] || {};
    if (first.opacity == null && last.opacity == null) return Promise.resolve();
    f = [{ opacity: first.opacity == null ? 1 : first.opacity }, { opacity: last.opacity == null ? 1 : last.opacity }];
    o = { duration: 200, easing: 'linear', fill: 'both', delay: 0 };
  }
  try {
    const a = el.animate(f, o);
    // a throttled or hidden tab may never finish the animation: never wait forever
    const limit = (Number(o.duration) || 0) + (Number(o.delay) || 0) + 400;
    return Promise.race([a.finished.then(() => a, () => a), new Promise((r) => setTimeout(() => r(a), limit))]);
  } catch (e) {
    return Promise.resolve();
  }
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function focusables(root) {
  return root ? [...root.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null) : [];
}

// Keeps Tab inside a dialog. Returns a function that removes the trap.
export function trapFocus(root) {
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables(root);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

export function store(key, value) {
  try {
    if (value === undefined) {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage blocked: the page still works */ }
  return value;
}

export function param(name) {
  try {
    const v = new URLSearchParams(location.search).get(name);
    return v == null || v === '' ? null : v;
  } catch (e) {
    return null;
  }
}

export function isPhone() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 599px)').matches;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}
