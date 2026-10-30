// Shared UI building blocks: SVG mission patches, icons and role art, the settings / credits /
// achievements modals and toasts. Used by the menu, briefing, debrief and the in-mission HUD.

import { h, clear } from '../core/dom.js';
import { store, DEFAULT_SETTINGS } from '../core/Store.js';

let _uid = 0;

// ------------------------------------------------------------------ icons (24×24, stroke)

const ICONS = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  star: '<path d="M12 3.5l2.6 5.6 6 .6-4.5 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.4 9.7l6-.6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1 1-1.1 1.8v.6M12 16.8v.4"/>',
  skip: '<path d="M4 6l7 6-7 6zM12 6l7 6-7 6z" fill="currentColor" stroke="none"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  rocket: '<path d="M12 2.5c3 2.5 4.5 6 4.5 10.5l-2 3h-5l-2-3c0-4.5 1.5-8 4.5-10.5z"/><path d="M9.5 16l-2.5 3.5h3M14.5 16l2.5 3.5h-3M12 19v2.5"/><circle cx="12" cy="9" r="1.6"/>',
  headset: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13.5" width="3.5" height="6" rx="1"/><rect x="17" y="13.5" width="3.5" height="6" rx="1"/><path d="M19 19.5c0 1.5-2 2-5 2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  credits: '<path d="M5 4h11l3 3v13H5z"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V20h11V9.5"/>',
  volume: '<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  hint: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  log: '<path d="M4 5h16v11H9l-5 4z"/>',
  hud: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  seat: '<path d="M7 4v9h9l2 7M7 13l-2 7M7 8h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 10.5h6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.style.display = 'contents';
  // width/height = 1em so an icon in a container without its own svg rule never falls back to
  // the 300×150 px default size (that blew up the briefing header); CSS rules still override it
  span.innerHTML = `<svg class="${cls}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return span.firstChild;
}

export function iconSVG(name) {
  return `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

// ------------------------------------------------------------------ mission patches

function stars(seed, n, r0 = 30, r1 = 92, cx = 100, cy = 100) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = r0 + rnd() * (r1 - r0);
    out += `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" r="${(0.4 + rnd() * 0.9).toFixed(2)}" fill="#fff" opacity="${(0.35 + rnd() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

function ringText(id, top, bottom, color = '#f6e7b8', size = 15) {
  return `
    <path id="${id}t" d="M 26 100 A 74 74 0 0 1 174 100" fill="none"/>
    <path id="${id}b" d="M 22 100 A 78 78 0 0 0 178 100" fill="none"/>
    <text font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="${size}" letter-spacing="3" fill="${color}" text-anchor="middle">
      <textPath href="#${id}t" startOffset="50%">${top}</textPath>
    </text>
    ${bottom ? `<text font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="600" font-size="${size * 0.72}" letter-spacing="2.5" fill="${color}" text-anchor="middle"><textPath href="#${id}b" startOffset="50%" dominant-baseline="hanging">${bottom}</textPath></text>` : ''}`;
}

const PATCH = {
  apollo11: (id) => `
    <defs>
      <radialGradient id="${id}sky" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#16243f"/><stop offset="1" stop-color="#050812"/></radialGradient>
      <radialGradient id="${id}earth" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#7fc4ff"/><stop offset="0.6" stop-color="#2a6fc2"/><stop offset="1" stop-color="#0b2a55"/></radialGradient>
      <linearGradient id="${id}moon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfc8b8"/><stop offset="1" stop-color="#7b7466"/></linearGradient>
      <clipPath id="${id}clip"><circle cx="100" cy="100" r="66"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="97" fill="#0d1b33" stroke="#e6c35c" stroke-width="4"/>
    <circle cx="100" cy="100" r="86" fill="none" stroke="#e6c35c" stroke-width="1.5"/>
    ${ringText(id, 'APOLLO 11', '', '#f6e7b8', 17)}
    <g clip-path="url(#${id}clip)">
      <rect x="20" y="20" width="160" height="160" fill="url(#${id}sky)"/>
      ${stars(11, 40, 0, 66)}
      <circle cx="134" cy="66" r="15" fill="url(#${id}earth)"/>
      <path d="M126 58c4-3 9-2 11 1-3 1-5 4-9 3zM134 72c3 0 6 2 7 5-3 0-6-1-7-5z" fill="#e8f4ff" opacity="0.85"/>
      <path d="M140 54a15 15 0 0 1 0 26a12 12 0 0 0 0-26z" fill="#000" opacity="0.45"/>
      <path d="M30 140 Q100 118 170 140 L170 170 L30 170 Z" fill="url(#${id}moon)"/>
      <ellipse cx="72" cy="146" rx="9" ry="2.6" fill="#5f594d" opacity="0.7"/>
      <ellipse cx="128" cy="150" rx="12" ry="3" fill="#5f594d" opacity="0.6"/>
      <ellipse cx="102" cy="158" rx="6" ry="1.8" fill="#5f594d" opacity="0.6"/>
      <g transform="translate(100 112)">
        <path d="M-46 -6 C-30 -22 -12 -24 -2 -12 C-14 -14 -26 -10 -46 -6 Z" fill="#c9a46a"/>
        <path d="M-40 -2 C-26 -14 -12 -14 -2 -8 C-16 -6 -28 -4 -40 -2 Z" fill="#a27c45"/>
        <path d="M46 -16 C34 -28 16 -28 4 -14 C18 -16 32 -16 46 -16 Z" fill="#c9a46a"/>
        <path d="M38 -10 C28 -18 14 -18 4 -9 C16 -10 28 -10 38 -10 Z" fill="#a27c45"/>
        <path d="M-6 -14 C-2 -22 8 -22 10 -14 L8 6 C4 12 -2 12 -6 6 Z" fill="#8a6234"/>
        <path d="M-4 -18 C-2 -26 8 -26 9 -18 C6 -15 0 -15 -4 -18 Z" fill="#f2efe6"/>
        <path d="M9 -20 L15 -18 L9 -16 Z" fill="#e6c35c"/>
        <path d="M-2 6 L-8 16 M6 6 L10 16" stroke="#e6c35c" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M-12 17 C-4 13 6 13 14 17" stroke="#6b8f3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <circle cx="-8" cy="15" r="1.6" fill="#89b04c"/><circle cx="2" cy="13.6" r="1.6" fill="#89b04c"/><circle cx="11" cy="15.2" r="1.6" fill="#89b04c"/>
      </g>
    </g>
    <circle cx="100" cy="100" r="66" fill="none" stroke="#e6c35c" stroke-width="2"/>`,
  apollo13: (id) => `
    <defs>
      <radialGradient id="${id}sky" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#1b1430"/><stop offset="1" stop-color="#05040c"/></radialGradient>
      <radialGradient id="${id}sun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.5" stop-color="#ffc23d"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2ddd0"/><stop offset="1" stop-color="#8d8677"/></linearGradient>
      <clipPath id="${id}clip"><circle cx="100" cy="100" r="66"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="97" fill="#151528" stroke="#e6c35c" stroke-width="4"/>
    <circle cx="100" cy="100" r="86" fill="none" stroke="#e6c35c" stroke-width="1.5"/>
    ${ringText(id, 'APOLLO 13', 'EX LUNA · SCIENTIA', '#f6e7b8', 17)}
    <g clip-path="url(#${id}clip)">
      <rect x="20" y="20" width="160" height="160" fill="url(#${id}sky)"/>
      ${stars(13, 36, 0, 66)}
      <circle cx="78" cy="84" r="44" fill="url(#${id}sun)"/>
      <g stroke="#ffd166" stroke-width="2" opacity="0.8">
        <path d="M78 34v-12M78 134v12M28 84h-12M128 84h14M43 49l-8-8M113 49l8-8M43 119l-8 8"/>
      </g>
      <circle cx="78" cy="84" r="14" fill="#fff3c4"/>
      <circle cx="136" cy="128" r="30" fill="url(#${id}moon)"/>
      <circle cx="128" cy="120" r="5" fill="#a39b8a"/><circle cx="146" cy="136" r="7" fill="#a39b8a"/><circle cx="132" cy="143" r="3" fill="#a39b8a"/>
      <circle cx="58" cy="140" r="10" fill="#2f78c9"/>
      <path d="M52 136c3-2 6-1 8 1-2 1-4 2-6 1z" fill="#eaf4ff"/>
      <g fill="#f2e2b0" transform="translate(96 86) rotate(-18)">
        <path d="M0 0 l22 -6 l8 4 l-6 2 l6 6 l-10 -2 l-10 6 l-4 -4 z"/>
        <path d="M-4 10 l22 -6 l8 4 l-6 2 l6 6 l-10 -2 l-10 6 l-4 -4 z" opacity="0.8"/>
        <path d="M-8 20 l22 -6 l8 4 l-6 2 l6 6 l-10 -2 l-10 6 l-4 -4 z" opacity="0.6"/>
      </g>
    </g>
    <circle cx="100" cy="100" r="66" fill="none" stroke="#e6c35c" stroke-width="2"/>`,
  apollo12: (id) => `
    <defs>
      <linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2a5c"/><stop offset="1" stop-color="#061230"/></linearGradient>
      <clipPath id="${id}clip"><circle cx="100" cy="100" r="66"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="97" fill="#0b2048" stroke="#e6c35c" stroke-width="4"/>
    <circle cx="100" cy="100" r="86" fill="none" stroke="#e6c35c" stroke-width="1.5"/>
    ${ringText(id, 'APOLLO XII', 'CONRAD · GORDON · BEAN', '#f6e7b8', 17)}
    <g clip-path="url(#${id}clip)">
      <rect x="20" y="20" width="160" height="160" fill="url(#${id}sky)"/>
      ${stars(12, 26, 0, 66)}
      <circle cx="100" cy="160" r="52" fill="#b9b3a3"/>
      <circle cx="84" cy="146" r="6" fill="#958f80"/><circle cx="118" cy="152" r="8" fill="#958f80"/>
      <g fill="#f4f1e6">
        <path d="M62 120 h76 l-10 12 h-56 z" fill="#d8b46a"/>
        <path d="M78 116 v-56 l-16 50 z"/><path d="M82 116 v-62 l22 54 z"/>
        <path d="M102 116 v-50 l-14 46 z"/><path d="M106 116 v-54 l20 50 z"/>
        <path d="M126 116 v-36 l12 32 z"/>
      </g>
      <g fill="#ffe08a"><path d="M40 70l2 4 4 .4-3 2.7 1 4-4-2-4 2 1-4-3-2.7 4-.4z"/><path d="M152 64l2 4 4 .4-3 2.7 1 4-4-2-4 2 1-4-3-2.7 4-.4z"/><path d="M48 46l1.5 3 3 .3-2.2 2 .7 3-3-1.5-3 1.5.7-3-2.2-2 3-.3z"/><path d="M146 42l1.5 3 3 .3-2.2 2 .7 3-3-1.5-3 1.5.7-3-2.2-2 3-.3z"/></g>
    </g>
    <circle cx="100" cy="100" r="66" fill="none" stroke="#e6c35c" stroke-width="2"/>`,
  apollo8: (id) => `
    <defs>
      <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1a36"/><stop offset="1" stop-color="#050a18"/></linearGradient>
      <radialGradient id="${id}earth" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#1a4f99"/></radialGradient>
    </defs>
    <path d="M100 8 C112 8 186 150 186 168 C186 184 176 190 160 190 L40 190 C24 190 14 184 14 168 C14 150 88 8 100 8 Z" fill="url(#${id}bg)" stroke="#e6c35c" stroke-width="4"/>
    ${stars(8, 22, 10, 60, 100, 120)}
    <path d="M100 72 C138 72 138 128 100 128 C62 128 62 184 100 184" fill="none" stroke="#e8352a" stroke-width="0"/>
    <path d="M72 92 C 100 60, 160 60, 160 100 C 160 140, 100 140, 72 112 C 44 84, 40 140, 72 140" fill="none" stroke="#e8352a" stroke-width="6" stroke-linecap="round"/>
    <circle cx="58" cy="126" r="16" fill="url(#${id}earth)"/>
    <circle cx="140" cy="100" r="10" fill="#c9c3b5"/>
    <text x="100" y="58" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="20" letter-spacing="3" fill="#f6e7b8" text-anchor="middle">APOLLO</text>
    <text x="100" y="178" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="600" font-size="11" letter-spacing="2" fill="#f6e7b8" text-anchor="middle">BORMAN · LOVELL · ANDERS</text>`,
  training: (id) => `
    <defs>
      <radialGradient id="${id}bg" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#1f2a38"/><stop offset="1" stop-color="#0a0e14"/></radialGradient>
    </defs>
    <circle cx="100" cy="100" r="97" fill="url(#${id}bg)" stroke="#9fb0c0" stroke-width="4"/>
    <circle cx="100" cy="100" r="86" fill="none" stroke="#9fb0c0" stroke-width="1.5"/>
    ${ringText(id, 'ENTRENAMIENTO', 'HOUSTON · CABO KENNEDY', '#dfe7f0', 15)}
    <ellipse cx="100" cy="104" rx="56" ry="22" fill="none" stroke="#ffb000" stroke-width="3" transform="rotate(-20 100 104)"/>
    <circle cx="100" cy="104" r="20" fill="#2a6fc2"/>
    <path d="M100 54 c7 6 10 16 10 28 l-4 6 h-12 l-4 -6 c0 -12 3 -22 10 -28z" fill="#f2f2f2"/>
    <path d="M94 88 l-6 8 h7 z M106 88 l6 8 h-7 z" fill="#f2f2f2"/>
    <path d="M96 90 h8 l-4 12 z" fill="#ffb000"/>`,
};

/** @returns {string} SVG markup for a mission patch */
export function patchSVG(patch, cls = '') {
  const id = `p${++_uid}`;
  const body = (PATCH[patch] ?? PATCH.training)(id);
  return `<svg class="${cls}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${patch}">${body}</svg>`;
}

export function patchEl(patch, cls = '') {
  const d = document.createElement('div');
  d.innerHTML = patchSVG(patch, cls);
  return d.firstChild;
}

// ------------------------------------------------------------------ role art

export const ROLE_ART = {
  astronaut: `<svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="ra-h" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#d4d9df"/><stop offset="1" stop-color="#8b939c"/></radialGradient>
      <linearGradient id="ra-v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd780"/><stop offset="0.35" stop-color="#c88a1c"/><stop offset="0.7" stop-color="#3a2408"/><stop offset="1" stop-color="#7a5212"/></linearGradient>
    </defs>
    <ellipse cx="100" cy="150" rx="70" ry="8" fill="#000" opacity="0.35"/>
    <path d="M40 150 C40 118 62 104 100 104 C138 104 160 118 160 150 Z" fill="#e9ecef" stroke="#9aa3ad" stroke-width="2"/>
    <rect x="72" y="118" width="56" height="20" rx="4" fill="#c7cdd4" stroke="#8d96a0"/>
    <circle cx="84" cy="128" r="4" fill="#d6372b"/><circle cx="98" cy="128" r="4" fill="#2f6fd0"/><rect x="108" y="124" width="14" height="8" rx="1" fill="#59606a"/>
    <circle cx="100" cy="66" r="50" fill="url(#ra-h)" stroke="#8b939c" stroke-width="2"/>
    <path d="M58 64 C58 38 76 26 100 26 C124 26 142 38 142 64 C142 86 126 98 100 98 C74 98 58 86 58 64 Z" fill="url(#ra-v)"/>
    <path d="M70 46 C80 34 98 32 112 36" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.65" fill="none"/>
    <path d="M118 74 C114 84 104 90 92 90" stroke="#ffe7a8" stroke-width="2" opacity="0.5" fill="none"/>
    <circle cx="84" cy="70" r="7" fill="#7fc4ff" opacity="0.55"/>
    <rect x="94" y="14" width="12" height="10" rx="2" fill="#c7cdd4"/>
  </svg>`,
  controller: `<svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="rc-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b29f"/><stop offset="1" stop-color="#7f796a"/></linearGradient>
      <radialGradient id="rc-s" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#1f4a2c"/><stop offset="1" stop-color="#061009"/></radialGradient>
    </defs>
    <ellipse cx="100" cy="152" rx="80" ry="7" fill="#000" opacity="0.35"/>
    <path d="M22 96 L178 96 L190 148 L10 148 Z" fill="url(#rc-c)" stroke="#5f5a4f" stroke-width="2"/>
    <rect x="30" y="20" width="62" height="70" rx="6" fill="#57534a" stroke="#3b3832" stroke-width="2"/>
    <rect x="38" y="28" width="46" height="40" rx="3" fill="url(#rc-s)"/>
    <g stroke="#6dffa0" stroke-width="1.6" fill="none" opacity="0.9">
      <path d="M42 56 C50 40 58 62 66 44 S78 50 80 38"/>
      <path d="M42 34 h14 M42 38 h10 M60 34 h18"/>
    </g>
    <rect x="108" y="20" width="62" height="70" rx="6" fill="#57534a" stroke="#3b3832" stroke-width="2"/>
    <rect x="116" y="28" width="46" height="40" rx="3" fill="url(#rc-s)"/>
    <g fill="#6dffa0" opacity="0.85" font-family="Share Tech Mono, monospace" font-size="6.5"><text x="120" y="38">EECOM  GO</text><text x="120" y="47">O2 2  0.00</text><text x="120" y="56">MN B  UV</text><text x="120" y="65">FC 1  OFF</text></g>
    <g>
      <rect x="40" y="104" width="10" height="7" rx="1" fill="#e8e1c8"/><rect x="54" y="104" width="10" height="7" rx="1" fill="#ffb000"/><rect x="68" y="104" width="10" height="7" rx="1" fill="#e8e1c8"/>
      <rect x="40" y="115" width="10" height="7" rx="1" fill="#e8e1c8"/><rect x="54" y="115" width="10" height="7" rx="1" fill="#e8e1c8"/><rect x="68" y="115" width="10" height="7" rx="1" fill="#6dffa0"/>
      <rect x="122" y="106" width="20" height="12" rx="2" fill="#3fbf6a"/><rect x="148" y="106" width="20" height="12" rx="2" fill="#d6372b"/>
      <text x="132" y="115" font-size="6" text-anchor="middle" font-family="Barlow Condensed" fill="#062" font-weight="700">GO</text>
      <text x="158" y="115" font-size="5.5" text-anchor="middle" font-family="Barlow Condensed" fill="#300" font-weight="700">NO GO</text>
    </g>
    <path d="M86 132 C86 112 114 112 114 132" stroke="#2a2a2a" stroke-width="4" fill="none"/>
    <rect x="80" y="128" width="9" height="13" rx="3" fill="#2a2a2a"/><rect x="111" y="128" width="9" height="13" rx="3" fill="#2a2a2a"/>
    <path d="M84 140 C84 148 96 150 100 146" stroke="#2a2a2a" stroke-width="2" fill="none"/>
  </svg>`,
};

// ------------------------------------------------------------------ modals

/** Generic modal. @returns {{ el, close }} */
export function openModal({ title, content, wide = false, onClose = null, tabs = null }) {
  const body = h('div', { class: 'modal-body ui-scroll' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.code === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  let tabBar = null;
  if (tabs) {
    const btns = tabs.map((t, i) =>
      h('button', { class: `tab ${i === 0 ? 'active' : ''}`, on: { click: () => select(i) } }, t.label),
    );
    const select = (i) => {
      btns.forEach((b, j) => b.classList.toggle('active', i === j));
      clear(body).append(tabs[i].render());
      window.__game?.audio?.sfx?.('uiClick');
    };
    tabBar = h('div', { class: 'tabs' }, btns);
    body.append(tabs[0].render());
  } else if (content) body.append(content);
  const modal = h(
    'div',
    { class: 'modal', style: wide ? { width: 'min(60rem, 100%)' } : null },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'btn btn-ghost btn-icon', title: 'Cerrar', on: { click: close } }, icon('close'))),
    tabBar,
    body,
  );
  const backdrop = h('div', { class: 'modal-backdrop', on: { pointerdown: (e) => e.target === backdrop && close() } }, modal);
  document.body.append(backdrop);
  return { el: modal, close };
}

function toggleCtl(key) {
  const el = h('div', { class: `switch ${store.settings[key] ? 'on' : ''}`, role: 'switch', tabindex: 0 });
  el.addEventListener('click', () => {
    store.setSetting(key, !store.settings[key]);
    el.classList.toggle('on', !!store.settings[key]);
    window.__game?.audio?.sfx?.('uiClick');
  });
  return el;
}

function rangeCtl(key, min, max, step) {
  const el = h('input', { type: 'range', min, max, step, value: store.settings[key] });
  el.addEventListener('input', () => store.setSetting(key, Number(el.value)));
  el.addEventListener('change', () => window.__game?.audio?.sfx?.('uiClick'));
  return el;
}

function selectCtl(key, options) {
  const el = h('select', null, options.map(([v, label]) => h('option', { value: v, selected: String(store.settings[key]) === String(v) }, label)));
  el.addEventListener('change', () => {
    const raw = el.value;
    const def = DEFAULT_SETTINGS[key];
    store.setSetting(key, typeof def === 'number' ? Number(raw) : raw);
    window.__game?.audio?.sfx?.('uiClick');
  });
  return el;
}

const row = (label, desc, ctl) => h('div', { class: 'setting' }, h('label', null, label, desc ? h('small', null, desc) : null), ctl);

export function openSettings({ inGame = false } = {}) {
  const game = window.__game;
  return openModal({
    title: 'Ajustes',
    tabs: [
      {
        label: 'Juego',
        render: () =>
          h(
            'div',
            null,
            row('Dificultad', 'Cadete: ayudas y piloto automático disponible · Astronauta: equilibrado · Realista: sin pistas', selectCtl('difficulty', [['cadet', 'Cadete'], ['astronaut', 'Astronauta'], ['realistic', 'Realista']])),
            row('Pistas en pantalla', 'Consejos contextuales durante la misión', toggleCtl('hints')),
            row('Resaltar controles', 'Marca el interruptor que pide la lista de comprobación', toggleCtl('highlightControls')),
            row('Unidades del HUD', 'Las de época (pies, nudos, millas náuticas) o métricas', selectCtl('units', [['imperial', 'Imperiales (auténticas)'], ['metric', 'Métricas']])),
            row('Sensibilidad del ratón', null, rangeCtl('mouseSensitivity', 0.3, 2.5, 0.05)),
            row('Invertir eje vertical', null, toggleCtl('invertY')),
            row('Desbloquear todos los capítulos', 'Para explorar libremente', toggleCtl('unlockAll')),
            inGame
              ? null
              : row(
                  'Borrar progreso',
                  'Reinicia capítulos completados y logros',
                  h('button', {
                    class: 'btn btn-sm',
                    on: {
                      click: (e) => {
                        if (e.currentTarget.dataset.armed) {
                          store.resetProgress();
                          e.currentTarget.textContent = 'Progreso borrado';
                        } else {
                          e.currentTarget.dataset.armed = '1';
                          e.currentTarget.textContent = '¿Seguro? Pulsa otra vez';
                        }
                      },
                    },
                  }, 'Borrar'),
                ),
          ),
      },
      {
        label: 'Audio',
        render: () =>
          h(
            'div',
            null,
            row('Volumen general', null, rangeCtl('volumeMaster', 0, 1, 0.01)),
            row('Efectos', 'Motores, interruptores, alarmas', rangeCtl('volumeSfx', 0, 1, 0.01)),
            row('Voces de radio', null, rangeCtl('volumeVoice', 0, 1, 0.01)),
            row('Música', null, rangeCtl('volumeMusic', 0, 1, 0.01)),
            row('Ambiente', 'Ventiladores de cabina, sala de control', rangeCtl('volumeAmbience', 0, 1, 0.01)),
            row('Voces', 'Inglés original con subtítulos, doblaje sintético en español, o solo texto', selectCtl('voiceMode', [['en-sub', 'Inglés + subtítulos'], ['es', 'Español'], ['text', 'Solo texto']])),
            row('Tonos Quindar', 'Los pitidos de inicio y fin de cada transmisión de Houston', toggleCtl('quindar')),
            row('Estática de radio', null, toggleCtl('radioStatic')),
            row('Subtítulos', null, toggleCtl('subtitles')),
            row('Mostrar el original en inglés', 'Debajo del subtítulo en español', toggleCtl('showOriginal')),
          ),
      },
      {
        label: 'Gráficos',
        render: () =>
          h(
            'div',
            null,
            row('Calidad', `Automática detectó: ${game?.detectedTier ?? '—'} (${game?.gpuName ?? ''})`, selectCtl('graphics', [['auto', 'Automática'], ['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta']])),
            row('Escala de resolución', null, rangeCtl('renderScale', 0.5, 1.5, 0.05)),
            row('Campo de visión', 'Grados', rangeCtl('fov', 50, 100, 1)),
            row('Vibración de cámara', 'Durante el lanzamiento y la reentrada', toggleCtl('cameraShake')),
            row('Mostrar FPS', null, toggleCtl('showFps')),
          ),
      },
      { label: 'Controles', render: () => helpContent() },
    ],
  });
}

/** Control reference shared by the help overlay (F1) and the briefing cheat-sheet:
 *  { block: { title, rows: [[keys[], description]] } } */
export const CONTROLS = {
  cockpit: {
    title: 'Cabina',
    rows: [
      [['Arrastrar'], 'Mirar: botón izquierdo sobre una zona sin controles, o botón derecho / central en cualquier lugar'],
      [['Rueda'], 'Zoom (sobre un selector giratorio: girarlo)'],
      [['← → ↑ ↓'], 'Mirar (en el LM durante P64: redesignar el punto de alunizaje)'],
      [['Z'], 'Centrar la vista'],
      [['F'], 'Acercarse al panel bajo el cursor'],
      [['X'], 'Cambiar de asiento'],
      [['C'], 'Vista exterior'],
      [['V'], 'Siguiente cámara'],
      [['Clic'], 'Accionar interruptores y botones (mitad superior / inferior de la palanca)'],
      [['Clic der.', 'Mantener'], 'Abrir / cerrar la tapa de protección'],
    ],
  },
  dsky: {
    title: 'DSKY · con el cursor encima',
    rows: [
      [['V', 'N'], 'VERB · NOUN'],
      [['0–9', '+', '−'], 'Dígitos y signo'],
      [['Intro'], 'ENTR'],
      [['Retroceso'], 'CLR'],
      [['P'], 'PRO (proceder)'],
      [['R'], 'RSET'],
      [['K'], 'KEY REL'],
    ],
  },
  flight: {
    title: 'Vuelo',
    rows: [
      [['W', 'S'], 'Cabeceo'],
      [['A', 'D'], 'Guiñada'],
      [['Q', 'E'], 'Alabeo'],
      [['I', 'K'], 'Traslación adelante / atrás'],
      [['J', 'L'], 'Traslación izquierda / derecha'],
      [['U', 'O'], 'Traslación arriba / abajo'],
      [['RePág', 'AvPág'], 'Acelerador manual (LM)'],
      [['Inicio', 'Fin'], 'Velocidad de descenso ±1 pie/s (P66)'],
    ],
  },
  mocr: {
    title: 'Houston · sala de control',
    rows: [
      [['W', 'A', 'S', 'D'], 'Caminar (también con las flechas)'],
      [['Shift'], 'Correr'],
      [['Arrastrar'], 'Mirar'],
      [['E'], 'Sentarse en la consola más cercana / levantarse (o clic en una consola)'],
      [['Clic'], 'Sentado: pulsar los botones de la consola'],
      [['T'], 'Vista de TV de la nave'],
    ],
  },
  eva: {
    title: 'EVA · superficie lunar',
    rows: [
      [['W', 'A', 'S', 'D'], 'Caminar'],
      [['Shift'], 'Trotar'],
      [['Espacio'], 'Saltar'],
      [['Arrastrar'], 'Mirar (o clic para capturar el puntero)'],
      [['E'], 'Interactuar'],
      [['V'], 'Tercera persona'],
      [['C'], 'Cámara Hasselblad (clic = foto)'],
    ],
  },
  mission: {
    title: 'Misión',
    rows: [
      [['.', ','], 'Acelerar / frenar el tiempo'],
      [['/'], 'Tiempo real'],
      [['F8'], 'Saltar al siguiente evento'],
      [['Tab'], 'Mostrar / ocultar la lista'],
      [['B'], 'Manual de procedimientos'],
      [['G'], 'Registro de comunicaciones'],
      [['H'], 'Ocultar el HUD'],
      [['F1'], 'Esta ayuda'],
      [['Esc'], 'Pausa'],
    ],
  },
  touch: {
    title: 'Pantalla táctil',
    rows: [
      [['Tocar'], 'Accionar interruptores'],
      [['Mantener'], 'Abrir / cerrar la tapa de protección'],
      [['Arrastrar'], 'Mirar (sobre una zona sin controles)'],
      [['Pellizcar'], 'Zoom'],
      [['Palancas'], 'Izquierda: rotación · derecha: traslación'],
    ],
  },
};

/** One titled block of key → description rows (help overlay, briefing). */
export function controlsBlock(title, rows) {
  const k = (keys) => h('span', { class: 'k' }, keys.map((x) => h('kbd', null, x)));
  return h('div', null, title ? h('h4', null, title) : null, h('div', { class: 'keys' }, rows.flatMap(([keys, d]) => [k(keys), h('span', null, d)])));
}

/** Help overlay content. `focus` puts the blocks of the current place first:
 *  'cockpit' (astronaut, default) · 'mocr' (controller) · 'eva' (lunar surface). */
export function helpContent({ focus = 'cockpit' } = {}) {
  const order = {
    cockpit: ['cockpit', 'dsky', 'flight', 'mission', 'mocr', 'eva'],
    mocr: ['mocr', 'mission', 'cockpit', 'dsky', 'flight', 'eva'],
    eva: ['eva', 'mission', 'cockpit', 'dsky', 'flight', 'mocr'],
  }[focus] ?? ['cockpit', 'dsky', 'flight', 'mission', 'mocr', 'eva'];
  if (window.__game?.input?.isTouch) order.splice(1, 0, 'touch');
  return h('div', { class: 'help-grid' }, order.map((id) => controlsBlock(CONTROLS[id].title, CONTROLS[id].rows)));
}

export function openCredits() {
  return openModal({
    title: 'Créditos',
    content: h(
      'div',
      { class: 'credits' },
      h('p', null, 'Proyecto Apolo es un homenaje independiente a los hombres y mujeres del programa Apolo. No está afiliado a la NASA.'),
      h('h4', null, 'Fuentes históricas'),
      h('p', null, 'Apollo Flight Journal y Apollo Lunar Surface Journal (transcripciones aire-tierra y bucle de FLIGHT), Apollo Operations Handbooks del CSM y del LM, Saturn V Flight Evaluation Reports (SA-506, SA-508) y el informe de la Junta de Revisión del Apolo 13.'),
      h('h4', null, 'Audio'),
      h('p', null, 'Grabaciones de las misiones Apolo 8, 11 y 13 y discursos de J. F. Kennedy: NASA Historical Sounds (dominio público). Efectos y música generados en tiempo real con Web Audio.'),
      h('h4', null, 'Imágenes'),
      h('p', null, 'Tierra: NASA Blue Marble Next Generation y Black Marble. Luna: NASA SVS CGI Moon Kit (LRO LROC / LOLA). Dominio público.'),
      h('h4', null, 'Software'),
      h('p', null, 'three.js, Vite, tipografías Barlow, Barlow Condensed y Share Tech Mono (SIL OFL).'),
      h('h4', null, 'Dedicado a'),
      h('p', null, 'Los 400.000 ingenieros, técnicos, costureras, programadoras y controladores que hicieron posible que doce personas caminaran sobre la Luna.'),
    ),
  });
}

// ------------------------------------------------------------------ achievements

const achModules = import.meta.glob('../missions/*/achievements.js', { eager: true });

export function allAchievements() {
  const out = [];
  for (const mod of Object.values(achModules)) out.push(...(mod.achievements ?? mod.default ?? []));
  return out;
}

export function achievementById(id) {
  return allAchievements().find((a) => a.id === id) ?? { id, name: id, desc: '' };
}

export function openAchievements() {
  const list = allAchievements();
  const got = list.filter((a) => store.hasAchievement(a.id)).length;
  return openModal({
    title: `Logros · ${got}/${list.length}`,
    wide: true,
    content: h(
      'div',
      { class: 'ach-grid' },
      list.map((a) =>
        h('div', { class: `ach ${store.hasAchievement(a.id) ? '' : 'locked'}` }, h('div', { class: 'medal' }, a.icon ?? '★'), h('div', null, h('b', null, a.name), h('small', null, a.desc))),
      ),
    ),
  });
}

let toastWrap = null;
export function toast({ title, text, icon: ic = '★', durationS = 5 }) {
  if (!toastWrap || !toastWrap.isConnected) {
    toastWrap = h('div', { class: 'toast-wrap' });
    document.body.append(toastWrap);
  }
  const el = h('div', { class: 'toast' }, h('div', { class: 'medal' }, ic), h('div', null, h('b', null, title), h('small', null, text)));
  toastWrap.append(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.6s, transform 0.6s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30%)';
    setTimeout(() => el.remove(), 700);
  }, durationS * 1000);
}

export function toggleFullscreen() {
  const d = document;
  if (!d.fullscreenElement) {
    d.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } else d.exitFullscreen?.();
}

// ------------------------------------------------------------------ rocket silhouettes (side profile)

export const ROCKET_SVG = {
  saturnv:
    '<svg viewBox="0 0 40 230" xmlns="http://www.w3.org/2000/svg"><path d="M20 0 L20.6 7 L21 18 L22.4 18 L22.4 21 L25 33 L25 40 L28.6 40 L28.6 42 L27.4 42 L30.6 60 L30.6 94 L33 98 L35.3 101 L35.3 204 L38.5 208 L39.5 221 L35.5 221 L34.6 226 L30.2 226 L29.4 221 L24.2 221 L23.4 228 L16.6 228 L15.8 221 L10.6 221 L9.8 226 L5.4 226 L4.5 221 L0.5 221 L1.5 208 L4.7 204 L4.7 101 L7 98 L9.4 94 L9.4 60 L12.6 42 L11.4 42 L11.4 40 L15 40 L15 33 L17.6 21 L17.6 18 L19 18 L19.4 7 Z"/></svg>',
  saturnib:
    '<svg viewBox="0 0 40 230" xmlns="http://www.w3.org/2000/svg"><path d="M20 80 L20.5 90 L21 98 L24.5 106 L24.5 115 L27.3 133 L27.3 173 L27.3 206 L32.5 220 L32.5 224 L27 224 L26 228 L23 228 L22 224 L18 224 L17 228 L14 228 L13 224 L7.5 224 L7.5 220 L12.7 206 L12.7 173 L12.7 133 L15.5 115 L15.5 106 L19 98 L19.5 90 Z"/></svg>',
};
