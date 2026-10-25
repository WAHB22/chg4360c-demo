// SAO interface icons: simple navy line drawings, inline SVG, drawn by hand on
// a 24 unit grid with slightly uneven strokes so they read as inked, not stock.
// icon(name, {size, label}) returns an SVG string. Color follows currentColor.

const P = {
  // menu column
  report:
    '<path d="M6.2 4.6c3.9-.5 8-.4 11.6.1"/><path d="M6.4 4.7c-1.3.2-2 1.2-1.8 2.3.2 1 1.1 1.6 2.1 1.4"/>' +
    '<path d="M6.6 8.4c.1 3.6 0 7.4-.2 11"/><path d="M17.8 4.7c.2 4.8.2 9.6-.1 14.4"/>' +
    '<path d="M6.4 19.4c3.7.4 7.6.3 11.3-.2"/><path d="M9.2 9.6h5.8M9.2 12.4h5.2M9.2 15.2h3.4"/>' +
    '<circle cx="15.6" cy="16.6" r="1.6"/>',
  map:
    '<path d="M3.6 6.3l5.2-2 6.3 2.1 5.3-2v13.5l-5.3 2-6.3-2.1-5.2 2z"/>' +
    '<path d="M8.8 4.4v13.4M15.1 6.5v13.4"/><path d="M10.6 10.4c.9.8 2 .9 2.9.1" stroke-dasharray="1.2 1.6"/>',
  bots:
    '<path d="M12 7.6c3.7 0 6.2 2.9 6.2 6.4 0 3.2-2.7 5.6-6.2 5.6s-6.2-2.4-6.2-5.6c0-3.5 2.5-6.4 6.2-6.4z"/>' +
    '<circle cx="9.9" cy="13.4" r=".55" fill="currentColor"/><circle cx="14.1" cy="13.4" r=".55" fill="currentColor"/>' +
    '<path d="M10.6 16.2c.9.5 1.9.5 2.8 0"/><path d="M12 2.6l1.5 1.9-1.5 1.9-1.5-1.9z"/>',
  drafts:
    '<path d="M19.4 3.8c-5.4 1.2-9.4 5.6-11.1 11.2"/><path d="M19.4 3.8c.4 4.9-3 9.5-8.6 11.6"/>' +
    '<path d="M8.3 15l-1.9 4.7"/><path d="M12.6 9.2l-2.2 2.4"/><path d="M4 20.4c2.5-.3 5.4-.2 8.2.1"/>',
  questions:
    '<path d="M5 6.6c0-1.3 1-2.2 2.3-2.2h9.4c1.3 0 2.3.9 2.3 2.2v7.2c0 1.3-1 2.2-2.3 2.2h-6.2l-3.9 3.4.4-3.4H7.3c-1.3 0-2.3-.9-2.3-2.2z"/>' +
    '<path d="M10.1 8.4c.3-1.2 1.2-1.8 2.1-1.8 1.2 0 2 .8 2 1.8 0 1.4-1.9 1.6-2.1 3"/><circle cx="12.1" cy="13.5" r=".6" fill="currentColor"/>',
  rules:
    '<path d="M7 20.2V8.6C7 5.7 9.2 3.6 12 3.6s5 2.1 5 5v11.6"/><path d="M4.6 20.4h14.8"/>' +
    '<path d="M9.6 9.4h4.8M9.6 12.2h4.8M9.6 15h3.4"/>',
  settings:
    '<circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="1.3"/><path d="M12 12l3.4-3.2"/>' +
    '<path d="M12 4.6v1.6M12 17.8v1.6M4.6 12h1.6M17.8 12h1.6M6.8 6.8l1.1 1.1M16.1 16.1l1.1 1.1M6.8 17.2l1.1-1.1"/>',

  // controls
  close: '<path d="M6.4 6.2c3.8 3.7 7.5 7.6 11.2 11.6"/><path d="M17.6 6.3c-3.9 3.6-7.6 7.4-11.2 11.5"/>',
  back: '<path d="M14.6 5.6c-2.4 2.1-4.6 4.2-6.6 6.4 2 2.2 4.2 4.3 6.6 6.4"/>',
  check: '<path d="M5.2 12.6c1.6 1.4 3 2.9 4.2 4.6 2.6-4.1 5.6-7.8 9.2-11"/>',
  copy: '<rect x="8.4" y="8.2" width="10.6" height="11.6" rx="1.6"/><path d="M15.6 5.6V5.2c0-.9-.7-1.6-1.6-1.6H6.6C5.7 3.6 5 4.3 5 5.2v8.6c0 .9.7 1.6 1.6 1.6h.6"/>',
  open: '<path d="M4 6.2c2.9-.9 5.6-.6 8 1.1 2.4-1.7 5.1-2 8-1.1v12.2c-2.9-.9-5.6-.6-8 1.1-2.4-1.7-5.1-2-8-1.1z"/><path d="M12 7.3v12.1"/>',
  send: '<path d="M4.4 11.6c5.2-2.4 10.3-4.6 15.4-6.4-1.6 4.9-3.6 9.8-6.2 14.6l-2.4-5.6z"/><path d="M11.2 14.2l8.6-9"/>',
  stop: '<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2"/>',
  sound: '<path d="M4.6 9.6h3.2l4.6-3.8v12.4l-4.6-3.8H4.6z"/><path d="M15.6 9.2c1.3 1.6 1.3 4 0 5.6M18 7c2.4 2.9 2.4 7.1 0 10"/>',
  menu: '<circle cx="6.4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17.6" cy="12" r="1.5" fill="currentColor"/>',
  moon: '<path d="M16.8 15.8c-4.6.9-8.6-2.6-8.2-7.2.1-1.6.8-3.1 1.8-4.2-4 .7-6.6 4.6-5.8 8.6.8 4 4.7 6.6 8.7 5.8 1.6-.3 3-1.1 4.1-2.2-.2-.3-.4-.6-.6-.8z"/>',
  idle: '<path d="M8 8.4h4.2L8 13h4.2"/><path d="M13.6 12.2h3.6l-3.6 4h3.6"/>',

  // place symbols (places.js symbol field)
  compass: '<circle cx="12" cy="12" r="8"/><path d="M12 6.2l1.8 5.8-1.8 5.8-1.8-5.8z"/><path d="M12 3.4v1.4M12 19.2v1.4M3.4 12h1.4M19.2 12h1.4"/>',
  book: '<path d="M4 6.2c2.9-.9 5.6-.6 8 1.1 2.4-1.7 5.1-2 8-1.1v12.2c-2.9-.9-5.6-.6-8 1.1-2.4-1.7-5.1-2-8-1.1z"/><path d="M12 7.3v12.1"/>',
  cup: '<path d="M5.4 9.4h10.8v4.4c0 3-2.4 5.4-5.4 5.4s-5.4-2.4-5.4-5.4z"/><path d="M16.2 10.6h1.2c1.3 0 2.2 1 2.2 2.2s-1 2.2-2.2 2.2h-1.6"/><path d="M8.6 4.4c-.7 1 .7 1.8 0 2.8M12.4 4.4c-.7 1 .7 1.8 0 2.8"/>',
  scroll: '<path d="M7 5.2h10.4c1.2 0 2 .9 2 2s-.8 2-2 2"/><path d="M7 5.2c-1.2 0-2 .9-2 2v10.4c0 .7.5 1.2 1.2 1.2H15c1.2 0 2-.9 2-2V7.2"/><path d="M8.6 11.4h5.2M8.6 14.4h4"/>',
  shield: '<path d="M12 3.6c2.4 1.4 4.8 2 7.2 2.1-.1 6.5-2.6 11.2-7.2 14.4-4.6-3.2-7.1-7.9-7.2-14.4 2.4-.1 4.8-.7 7.2-2.1z"/><path d="M12 7.4v9"/>',
  pot: '<path d="M4.8 10.2h14.4"/><path d="M6 10.2v5.2c0 2.2 1.8 4 4 4h4c2.2 0 4-1.8 4-4v-5.2"/><path d="M3.6 11.8H6M18 11.8h2.4"/><path d="M9.4 4.4c-.7 1.1.7 2 0 3.1M12.6 4.4c-.7 1.1.7 2 0 3.1"/>',
  basket: '<path d="M4 10.4h16l-1.8 8.4c-.2.9-1 1.4-1.8 1.4H7.6c-.9 0-1.6-.6-1.8-1.4z"/><path d="M7.4 10.4c.6-3.4 2.4-5.6 4.6-5.6s4 2.2 4.6 5.6"/><path d="M9.4 13.4l.4 3.8M14.6 13.4l-.4 3.8"/>',
  key: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12h8.6M17.2 12v3M19.8 12v2.2"/>',
  flag: '<path d="M6.2 20.4V3.8"/><path d="M6.2 4.6c3.2-1.6 5.4 1.4 8.6.2 1.4-.5 2.4-.6 3.4-.4v8c-1-.2-2-.1-3.4.4-3.2 1.2-5.4-1.8-8.6-.2"/>',
  lamp: '<path d="M10 3.6h4M12 3.6v2"/><path d="M8.4 8.4c0-1.6 1.6-2.8 3.6-2.8s3.6 1.2 3.6 2.8v6.4c0 1-.8 1.8-1.8 1.8h-3.6c-1 0-1.8-.8-1.8-1.8z"/><path d="M12 10v3.6"/><path d="M9.6 20.4h4.8M12 16.6v3.8"/>',

  // floors and markers
  crest: '<path d="M12 3.4l6.8 2.6v5.4c0 4.2-2.8 7.6-6.8 9.2-4-1.6-6.8-5-6.8-9.2V6z"/><path d="M8.6 10.6l2.2 2.4 4.6-4.6"/>',
  diamond: '<path d="M12 4l5 8-5 8-5-8z"/>',
  marker_question: '<path d="M9 8.6c.4-1.8 1.6-2.8 3.1-2.8 1.8 0 3 1.2 3 2.7 0 2.2-2.9 2.4-3 4.6"/><circle cx="12.1" cy="16.6" r=".9" fill="currentColor"/>',
  marker_z: '<path d="M8 7.6h7.6L8 16.4h7.6"/>',
};

export function icon(name, { size = 24, label = '', cls = '' } = {}) {
  const body = P[name] || P.compass;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

// Marker glyph for a bot state: diamond working, ? waiting, z sleeping.
export function markerIcon(state, size = 12) {
  if (state === 'waiting') return icon('marker_question', { size });
  if (state === 'sleeping') return icon('marker_z', { size });
  if (state === 'working' || state === 'traveling') return icon('diamond', { size });
  return '';
}

export const ICON_NAMES = Object.keys(P);
