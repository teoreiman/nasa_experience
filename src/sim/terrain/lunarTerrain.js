// Deterministic lunar terrain around landing sites (shared by physics and rendering).
// Coordinates: moon-fixed unit direction; locally an east/north metre grid around the site.
// Apollo 11: the computer's original target sits in the boulder field of West crater (~180 m);
// the real landing point (Tranquility Base) is ~400 m beyond it.

import { Vector3 } from 'three';
import { DEG, R_MOON } from '../../core/constants.js';

export const SITES = {
  TRANQUILITY: { lat: 0.67408, lon: 23.47297, name: 'Base Tranquilidad' },
  SURVEYOR: { lat: -3.01239, lon: -23.42157, name: 'Océano de las Tormentas' },
  HADLEY: { lat: 26.13222, lon: 3.63386, name: 'Hadley-Apeninos' },
  TAURUS_LITTROW: { lat: 20.1908, lon: 30.77168, name: 'Taurus-Littrow' },
  DESCARTES: { lat: -8.97301, lon: 15.50019, name: 'Descartes' },
};

export function siteDir(site, out = new Vector3()) {
  const la = site.lat * DEG;
  const lo = site.lon * DEG;
  return out.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Craters/boulders in local metres around a site (x = east, y = north). Cached per site. */
const cache = new Map();
export function siteFeatures(siteKey = 'TRANQUILITY') {
  if (cache.has(siteKey)) return cache.get(siteKey);
  const r = rand(siteKey.length * 7919 + 17);
  const craters = [];
  const boulders = [];
  for (let i = 0; i < 260; i++) {
    const radius = 4 + Math.pow(r(), 3) * 120;
    craters.push({ x: (r() - 0.5) * 9000, y: (r() - 0.5) * 9000, r: radius, d: radius * (0.12 + r() * 0.08) });
  }
  if (siteKey === 'TRANQUILITY') {
    // West crater uprange (east) of the landing point, with its boulder field
    const west = { x: 400, y: 30, r: 92, d: 28 };
    craters.push(west, { x: 60, y: -15, r: 15, d: 4 }); // Little West
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2;
      const d = west.r * (0.5 + r() * 1.3);
      boulders.push({ x: west.x + Math.cos(a) * d, y: west.y + Math.sin(a) * d, r: 0.6 + r() * 1.8 });
    }
  }
  for (let i = 0; i < 140; i++) boulders.push({ x: (r() - 0.5) * 2400, y: (r() - 0.5) * 2400, r: 0.3 + Math.pow(r(), 2) * 1.2 });
  // keep the actual landing point clear
  const res = { craters: craters.filter((c) => Math.hypot(c.x, c.y) > c.r + 25 || c.r < 8), boulders: boulders.filter((b) => Math.hypot(b.x, b.y) > 18) };
  cache.set(siteKey, res);
  return res;
}

// Spatial index (300 m cells) so a height query only visits the craters that can affect it.
const CELL = 300;
const grids = new Map();
function craterGrid(siteKey) {
  let g = grids.get(siteKey);
  if (g) return g;
  g = new Map();
  for (const c of siteFeatures(siteKey).craters) {
    const reach = c.r * 1.52;
    const x0 = Math.floor((c.x - reach) / CELL);
    const x1 = Math.floor((c.x + reach) / CELL);
    const y0 = Math.floor((c.y - reach) / CELL);
    const y1 = Math.floor((c.y + reach) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const k = i * 100003 + j;
        let list = g.get(k);
        if (!list) g.set(k, (list = []));
        list.push(c);
      }
    }
  }
  grids.set(siteKey, g);
  return g;
}

/** Local height (m) at east/north offset from the site. */
export function heightLocal(x, y, siteKey = 'TRANQUILITY') {
  let h = Math.sin(x * 0.0011) * 3 + Math.cos(y * 0.0013 + 1) * 2.5 + Math.sin((x + y) * 0.004) * 0.8;
  const list = craterGrid(siteKey).get(Math.floor(x / CELL) * 100003 + Math.floor(y / CELL));
  if (!list) return h;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const dx = x - c.x;
    const dy = y - c.y;
    const q = (dx * dx + dy * dy) / (c.r * c.r);
    if (q > 2.3) continue;
    if (q < 1) h -= c.d * (1 - q) * (1 - q * 0.3);
    else h += c.d * 0.25 * Math.max(0, 1 - (q - 1) / 1.3);
  }
  return h;
}

/** Boulder under a footprint? returns radius or 0. */
export function boulderAt(x, y, radius = 4.5, siteKey = 'TRANQUILITY') {
  for (const b of siteFeatures(siteKey).boulders) if (Math.hypot(x - b.x, y - b.y) < b.r + radius * 0.6 && b.r > 0.7) return b.r;
  return 0;
}

/** Local east/north frame at a site (moon-fixed). */
export function siteFrame(siteKey = 'TRANQUILITY') {
  const s = SITES[siteKey];
  const up = siteDir(s);
  const east = new Vector3(-Math.sin(s.lon * DEG), Math.cos(s.lon * DEG), 0);
  const north = new Vector3().crossVectors(up, east);
  return { up, east, north, radius: R_MOON };
}
