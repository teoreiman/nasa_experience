// Front-wall projection screens of MOCR-2: the big central plot (world map with the ground track
// and MSFN stations in Earth orbit, the Earth–Moon plot in translunar coast, the lunar map in lunar
// orbit), the side boards (vehicle status, consumables, event list) and the digital clock strip
// (GMT, GET, next event). Each screen owns a canvas drawn at a low rate and exposes a THREE texture.

import * as THREE from 'three';
import { NMI, FT, DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON } from '../core/constants.js';
import { MissionClock } from '../core/MissionClock.js';
import { gmst, sunDirection, moonPosition, moonVelocity } from '../sim/physics/ephemeris.js';
import { MSFN } from './MOCRData.js';

const RAD = 180 / Math.PI;
const LAT_MAX = 78;

const C = {
  ocean: [12, 34, 58],
  land: [46, 86, 74],
  coast: [196, 232, 214],
  grid: 'rgba(160,200,230,0.18)',
  track: '#ffe27a',
  pred: 'rgba(255,226,122,0.55)',
  text: '#dcecff',
  dim: 'rgba(220,236,255,0.55)',
};

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Stylised world map (ocean / land / bright coastline) from the water mask texture. */
function buildWorldBase(img, W, H) {
  const c = canvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  // crop the poles: rows of the source between +LAT_MAX and −LAT_MAX
  const sh = img.height;
  const y0 = ((90 - LAT_MAX) / 180) * sh;
  const y1 = ((90 + LAT_MAX) / 180) * sh;
  g.drawImage(img, 0, y0, img.width, y1 - y0, 0, 0, W, H);
  const id = g.getImageData(0, 0, W, H);
  const p = id.data;
  const land = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) land[i] = p[i * 4] < 110 ? 1 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const L = land[i];
      let coast = false;
      if (L) {
        const l = land[y * W + ((x + W - 1) % W)];
        const r = land[y * W + ((x + 1) % W)];
        const u = y > 0 ? land[i - W] : 1;
        const d = y < H - 1 ? land[i + W] : 1;
        coast = !l || !r || !u || !d;
      }
      const col = coast ? C.coast : L ? C.land : C.ocean;
      // faint latitude shading so the map is not flat
      const k = 0.92 + 0.08 * Math.cos(((y / H) - 0.5) * Math.PI);
      p[i * 4] = col[0] * k;
      p[i * 4 + 1] = col[1] * k;
      p[i * 4 + 2] = col[2] * k;
      p[i * 4 + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

/** Grey-blue lunar map from the LROC colour mosaic. */
function buildMoonBase(img, W, H) {
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.15) brightness(0.62)';
  const sh = img.height;
  const y0 = ((90 - LAT_MAX) / 180) * sh;
  const y1 = ((90 + LAT_MAX) / 180) * sh;
  g.drawImage(img, 0, y0, img.width, y1 - y0, 0, 0, W, H);
  g.filter = 'none';
  g.fillStyle = 'rgba(30,70,110,0.28)';
  g.fillRect(0, 0, W, H);
  return c;
}


const _mp = new THREE.Vector3();
const _mv = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _dm = new THREE.Vector3();
const _hh = new THREE.Vector3();
const _ww = new THREE.Vector3();

/** Geocentric acceleration: Earth + Moon (with the indirect term), Moon from the ephemeris. */
function accelEM(r, utc, out) {
  const rl = r.length();
  out.copy(r).multiplyScalar(-MU_EARTH / (rl * rl * rl));
  moonPosition(utc, _mp);
  _dm.copy(_mp).sub(r);
  const dl = _dm.length();
  out.addScaledVector(_dm, MU_MOON / (dl * dl * dl));
  const ml = _mp.length();
  return out.addScaledVector(_mp, -MU_MOON / (ml * ml * ml));
}

/** Point of the Earth–Moon rotating plot (Earth at 0, Moon at x = 1) for an ECI position at `utc`. */
function emPoint(r, utc) {
  moonPosition(utc, _mp);
  moonVelocity(utc, _mv);
  const D = _mp.length();
  _hh.crossVectors(_mp, _mv);
  _ww.crossVectors(_hh, _mp).normalize();
  return [r.dot(_mp) / (D * D), r.dot(_ww) / D];
}

/** Coast the state forward (sign +1) or backward (−1) in time with adaptive steps. Returns
 *  { em: [[x, y]...] rotating-plot points, ll: [[lat, lon]...] Earth track (when low) }. */
export function coastPath(r0, v0, utc0, seconds, sign = 1, { maxPts = 900, earthTrack = false } = {}) {
  const r = r0.clone();
  const v = v0.clone();
  const em = [];
  const ll = [];
  let t = 0;
  let next = 0;
  while (t < seconds && em.length < maxPts) {
    const utc = utc0 + sign * t * 1000;
    moonPosition(utc, _mp);
    const dMoon = r.distanceTo(_mp);
    const rl = r.length();
    if (rl < R_EARTH + 90000 || dMoon < R_MOON + 5000) break;
    const sp = Math.max(200, v.length());
    const dt = Math.max(earthTrack ? 20 : 15, Math.min(earthTrack ? 60 : 900, (0.03 * Math.min(dMoon, rl)) / sp));
    if (t >= next) {
      em.push(emPoint(r, utc));
      if (earthTrack) {
        let lon = (Math.atan2(r.y, r.x) - gmst(utc)) * RAD;
        lon = ((lon + 540) % 360) - 180;
        ll.push([Math.asin(r.z / rl) * RAD, lon]);
      }
      next = t + (earthTrack ? 40 : Math.min(1800, dt * 3));
    }
    accelEM(r, utc, _acc);
    v.addScaledVector(_acc, dt * sign);
    r.addScaledVector(v, dt * sign);
    t += dt;
  }
  return { em, ll };
}

const xOf = (lon, W) => ((lon + 180) / 360) * W;
const yOf = (lat, H) => ((LAT_MAX - lat) / (2 * LAT_MAX)) * H;

export class MainPlot {
  constructor({ data, sim, game }) {
    this.d = data;
    this.sim = sim;
    this.game = game;
    const q = game.quality?.name;
    this.W = q === 'low' ? 1024 : 1536;
    this.H = Math.round(this.W / 2.25);
    this.canvas = canvas(this.W, this.H);
    this.g = this.canvas.getContext('2d');
    this.texture = makeTexture(this.canvas);
    this.worldBase = null;
    this.moonBase = null;
    this._acc = 10;
    this._predAcc = 1e9;
    this.pred = [];
  }

  async load() {
    const a = this.game.assets;
    const [water, moon] = await Promise.all([
      a.texture('earth_water_2k', { srgb: false }).catch(() => null),
      a.texture('moon_color', { sizes: ['2k'] }).catch(() => null),
    ]);
    try {
      if (water?.image) this.worldBase = buildWorldBase(water.image, this.W, this.H);
      if (moon?.image) this.moonBase = buildMoonBase(moon.image, this.W, this.H);
    } catch (err) {
      console.warn('[mocr] map base failed', err);
    }
    this.draw(0);
  }

  update(dt, t) {
    this._acc += dt;
    this._predAcc += dt;
    if (this._acc < 0.5) return;
    this._acc = 0;
    if (this._predAcc > 8) {
      this._predAcc = 0;
      this._predict();
    }
    this.draw(t);
  }

  _predict() {
    this.pred = [];
    const d = this.d;
    const st = d.st;
    const clock = this.sim.clock;
    if (!d.flying || d.phase === 'ENTRY' || d.phase === 'SPLASHED' || d.phase === 'PAD' || d.phase === 'ASCENT') return;
    try {
      if (d.phase === 'TLC' || d.phase === 'TEC') {
        // where the spacecraft came from (once) and where it is going (free coast, real Moon motion)
        if (!this.pastEM) this.pastEM = coastPath(st.r, st.v, clock.utcMs, Math.min(80 * 3600, Math.max(0, clock.get)), -1).em.reverse();
        this.futureEM = coastPath(st.r, st.v, clock.utcMs, 90 * 3600, 1).em;
        return;
      }
      if (st.primary === 'EARTH' && st.alt < 2000e3) {
        if (!this.pastTrack && d.track.length < 3 && clock.get > 900) this.pastTrack = coastPath(st.r, st.v, clock.utcMs, 4800, -1, { earthTrack: true }).ll.reverse();
        this.pred = coastPath(st.r, st.v, clock.utcMs, 5400, 1, { earthTrack: true }).ll;
      }
    } catch (err) {
      if (!this._predWarned) {
        this._predWarned = true;
        console.warn('[mocr] trajectory prediction failed', err);
      }
      this.pred = [];
    }
  }

  _title(text, sub) {
    const g = this.g;
    const { W } = this;
    g.fillStyle = 'rgba(5,12,20,0.72)';
    g.fillRect(0, 0, W, 44);
    g.fillStyle = C.text;
    g.font = '600 26px "Barlow Condensed", sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(text, 18, 23);
    g.textAlign = 'right';
    g.fillStyle = C.dim;
    g.fillText(sub, W - 18, 23);
  }

  _poly(points, color, width, dash = null, lonKey = 1, latKey = 0) {
    const g = this.g;
    const { W, H } = this;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash ?? []);
    g.beginPath();
    let prev = null;
    for (const p of points) {
      const lon = p[lonKey];
      const lat = p[latKey];
      const x = xOf(lon, W);
      const y = yOf(lat, H);
      if (prev === null || Math.abs(lon - prev) > 180) g.moveTo(x, y);
      else g.lineTo(x, y);
      prev = lon;
    }
    g.stroke();
    g.setLineDash([]);
  }

  draw(t) {
    const d = this.d;
    const ph = d.phase;
    if (ph === 'TLC' || ph === 'TEC') this._drawCislunar(t);
    else if (d.st.primary === 'MOON') this._drawMoon(t);
    else this._drawWorld(t);
    this.texture.needsUpdate = true;
  }

  _grid() {
    const g = this.g;
    const { W, H } = this;
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 30) {
      g.beginPath();
      g.moveTo(xOf(lo, W), 0);
      g.lineTo(xOf(lo, W), H);
      g.stroke();
    }
    for (let la = -60; la <= 60; la += 30) {
      g.beginPath();
      g.moveTo(0, yOf(la, H));
      g.lineTo(W, yOf(la, H));
      g.stroke();
    }
    g.fillStyle = C.dim;
    g.font = '15px "Share Tech Mono", monospace';
    g.textAlign = 'left';
    for (let lo = -150; lo <= 150; lo += 30) g.fillText(`${Math.abs(lo)}${lo < 0 ? 'W' : lo > 0 ? 'E' : ''}`, xOf(lo, W) + 4, H - 10);
  }

  _marker(x, y, t, label) {
    const g = this.g;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 9 + pulse * 6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
    if (label) {
      g.font = '600 20px "Barlow Condensed", sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#ffffff';
      g.fillText(label, x + 16, y - 14);
    }
  }

  _drawWorld(t) {
    const g = this.g;
    const d = this.d;
    const { W, H } = this;
    if (this.worldBase) g.drawImage(this.worldBase, 0, 0);
    else {
      g.fillStyle = `rgb(${C.ocean.join(',')})`;
      g.fillRect(0, 0, W, H);
    }
    // night side
    const utc = this.sim.clock.utcMs;
    const sun = sunDirection(utc);
    const th = gmst(utc);
    const sLat = Math.asin(sun.z) * RAD;
    let sLon = (Math.atan2(sun.y, sun.x) - th) * RAD;
    sLon = ((sLon + 540) % 360) - 180;
    g.fillStyle = 'rgba(0,4,12,0.42)';
    const step = 8;
    for (let x = 0; x < W; x += step) {
      const lon = (x / W) * 360 - 180;
      // terminator latitude for this longitude
      const dl = (lon - sLon) * DEG;
      const tl = Math.atan(-Math.cos(dl) / Math.tan(sLat * DEG || 1e-6)) * RAD;
      const yT = yOf(tl, H);
      if (sLat > 0) g.fillRect(x, yT, step, H - yT);
      else g.fillRect(x, 0, step, yT);
    }
    this._grid();
    // stations
    g.font = '600 15px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    const sv = d.stationInView();
    for (const s of MSFN) {
      const x = xOf(s.lon, W);
      const y = yOf(s.lat, H);
      const prime = sv.station?.id === s.id && sv.aos && d.flying;
      g.strokeStyle = prime ? '#9effc0' : 'rgba(200,230,255,0.45)';
      g.lineWidth = prime ? 2 : 1;
      g.beginPath();
      g.arc(x, y, prime ? 46 : 30, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = prime ? '#9effc0' : 'rgba(220,236,255,0.75)';
      g.fillRect(x - 3, y - 3, 6, 6);
      g.fillText(s.id, x + 6, y - 6);
    }
    // Houston
    const hx = xOf(-95.09, W);
    const hy = yOf(29.56, H);
    g.fillStyle = '#ffb000';
    g.beginPath();
    g.moveTo(hx, hy - 7);
    g.lineTo(hx + 6, hy + 5);
    g.lineTo(hx - 6, hy + 5);
    g.closePath();
    g.fill();
    // track: predicted (dashed) then flown
    if (this.pred.length) this._poly(this.pred, C.pred, 2.5, [10, 8]);
    if (this.pastTrack) this._poly(this.pastTrack, C.track, 3.2);
    this._poly(d.track, C.track, 3.2);
    const name = (d.mission?.callsigns?.CSM ?? '').toUpperCase();
    if (d.flying) this._marker(xOf(d.lon, W), yOf(d.lat, H), t, name || 'APOLLO');
    else this._marker(xOf(-80.6, W), yOf(28.6, H), t, 'LC-39A');
    const rev = Math.max(0, Math.floor(d.get / 5280) + 1);
    this._title(`${(d.mission?.name ?? 'APOLLO').toUpperCase().replace('APOLO', 'APOLLO')} · GROUND TRACK`, d.flying ? `REV ${rev} · HA ${(d.st.apoAlt / NMI).toFixed(1)} HP ${(d.st.periAlt / NMI).toFixed(1)} NM` : 'PRELAUNCH');
  }

  _drawMoon(t) {
    const g = this.g;
    const d = this.d;
    const { W, H } = this;
    if (this.moonBase) g.drawImage(this.moonBase, 0, 0);
    else {
      g.fillStyle = '#20262c';
      g.fillRect(0, 0, W, H);
    }
    this._grid();
    // landing sites
    const sites = [
      ['TRANQUILLITY', 0.674, 23.473],
      ['SURVEYOR III', -3.012, -23.422],
      ['FRA MAURO', -3.645, -17.471],
    ];
    g.font = '600 16px "Barlow Condensed", sans-serif';
    for (const [n, la, lo] of sites) {
      const x = xOf(lo, W);
      const y = yOf(la, H);
      g.strokeStyle = '#ffb000';
      g.lineWidth = 2;
      g.strokeRect(x - 6, y - 6, 12, 12);
      g.fillStyle = '#ffd27a';
      g.textAlign = 'left';
      g.fillText(n, x + 10, y + 18);
    }
    this._poly(d.moonTrack, C.track, 3.2);
    const v = d.v;
    const label = v.config.startsWith('LM') ? (d.mission?.callsigns?.LM ?? 'LM').toUpperCase() : (d.mission?.callsigns?.CSM ?? 'CSM').toUpperCase();
    this._marker(xOf(d.mlon, W), yOf(d.mlat, H), t, label);
    if (d.st.losEarth) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 44, W, H - 44);
      g.fillStyle = '#ffffff';
      g.font = '700 46px "Barlow Condensed", sans-serif';
      g.textAlign = 'center';
      g.fillText('LOSS OF SIGNAL', W / 2, H / 2);
    }
    this._title('LUNAR ORBIT · GROUND TRACK', `ALT ${(d.st.alt / NMI).toFixed(1)} NM · HA ${(d.st.apoAlt / NMI).toFixed(1)} HP ${(d.st.periAlt / NMI).toFixed(1)}`);
  }

  _drawCislunar(t) {
    const g = this.g;
    const d = this.d;
    const { W, H } = this;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#061424');
    grd.addColorStop(1, '#03080f');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    const ox = W * 0.12;
    const oy = H * 0.56;
    const s = W * 0.74;
    // distance rings from Earth (every 50,000 nm)
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    const emNm = (this.sim.dyn?.moonPos?.length?.() ?? 3.84e8) / NMI;
    for (let k = 50000; k < 260000; k += 50000) {
      g.beginPath();
      g.arc(ox, oy, (k / emNm) * s, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.fillStyle = C.dim;
      g.font = '14px "Share Tech Mono", monospace';
      g.fillText(`${k / 1000}K`, ox + (k / emNm) * s + 4, oy - 4);
    }
    // Earth & Moon
    g.fillStyle = '#3d7bd6';
    g.beginPath();
    g.arc(ox, oy, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c9c9c4';
    g.beginPath();
    g.arc(ox + s, oy, 9, 0, Math.PI * 2);
    g.fill();
    g.font = '600 20px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = C.text;
    g.fillText('EARTH', ox, oy + 42);
    g.fillText('MOON', ox + s, oy + 34);
    // predicted coast (dashed), path already flown (solid)
    const line = (pts, color, width, dash) => {
      if (!pts?.length) return;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash ?? []);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy - y * s) : g.moveTo(ox + x * s, oy - y * s)));
      g.stroke();
      g.setLineDash([]);
    };
    line(this.futureEM, C.pred, 2.5, [12, 9]);
    line(this.pastEM, C.track, 3);
    line(d.lunarPath, C.track, 3);
    if (d.emX !== undefined) this._marker(ox + d.emX * s, oy - d.emY * s, t, (d.mission?.callsigns?.CSM ?? '').toUpperCase());
    this._title('TRANSLUNAR / TRANSEARTH PLOT', `R EARTH ${Math.round(d.st.r.length() / NMI).toLocaleString('en-US')} NM · R MOON ${Math.round(d.moonDistNmi).toLocaleString('en-US')} NM`);
    g.textAlign = 'left';
    g.fillStyle = C.dim;
    g.font = '16px "Share Tech Mono", monospace';
    g.fillText(`VI ${(d.st.speed / FT).toFixed(0)} FPS`, 18, H - 18);
  }

  dispose() {
    this.texture.dispose();
  }
}

/** Generic projection board of text rows (side screens). */
export class Board {
  constructor({ data, sim, kind, title, w = 768, h = 576 }) {
    this.d = data;
    this.sim = sim;
    this.kind = kind;
    this.title = title;
    this.W = w;
    this.H = h;
    this.canvas = canvas(w, h);
    this.g = this.canvas.getContext('2d');
    this.texture = makeTexture(this.canvas);
    this._acc = 10;
    this._ver = -1;
  }

  update(dt, t) {
    this._acc += dt;
    if (this._acc < 1) return;
    this._acc = 0;
    this.draw(t);
  }

  _frame(title) {
    const g = this.g;
    const { W, H } = this;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#0a1a2c');
    grd.addColorStop(1, '#050c16');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(160,200,240,0.14)';
    g.fillRect(0, 0, W, 54);
    g.fillStyle = C.text;
    g.font = '700 32px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(title, 22, 28);
  }

  row(i, label, value, { warn = false, y0 = 84, lh = 46 } = {}) {
    const g = this.g;
    const y = y0 + i * lh;
    g.font = '600 26px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.fillStyle = C.dim;
    g.fillText(label, 24, y);
    g.font = '30px "Share Tech Mono", monospace';
    g.textAlign = 'right';
    g.fillStyle = warn ? '#ff8a6a' : '#ffffff';
    g.fillText(value, this.W - 24, y);
  }

  bar(i, label, frac, { y0 = 84, lh = 52 } = {}) {
    const g = this.g;
    const y = y0 + i * lh;
    g.font = '600 24px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.fillStyle = C.dim;
    g.fillText(label, 24, y);
    const x = 250;
    const w = this.W - x - 120;
    g.strokeStyle = 'rgba(200,225,255,0.45)';
    g.lineWidth = 2;
    g.strokeRect(x, y - 13, w, 26);
    const f = Number.isNaN(frac) ? 0 : Math.max(0, Math.min(1, frac));
    g.fillStyle = f < 0.15 ? '#ff7a5a' : f < 0.35 ? '#ffd27a' : '#9fd8ff';
    g.fillRect(x + 3, y - 10, (w - 6) * f, 20);
    g.font = '26px "Share Tech Mono", monospace';
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(Number.isNaN(frac) ? '---' : `${Math.round(f * 100)}%`, this.W - 22, y);
  }

  draw(t) {
    const d = this.d;
    const st = d.st;
    const g = this.g;
    if (this.kind === 'status') {
      this._frame(this.title);
      const ph = d.phase;
      g.font = '700 30px "Barlow Condensed", sans-serif';
      g.fillStyle = '#ffd27a';
      g.textAlign = 'left';
      g.fillText(d.phaseEs, 24, 84);
      const gam = st.speed > 1 ? Math.asin(Math.max(-1, Math.min(1, st.hdot / st.speed))) * RAD : NaN;
      const rows = [
        ['ALTITUDE', st.alt < 100000 ? `${Math.round(st.alt / FT).toLocaleString('en-US')} FT` : `${(st.alt / NMI).toFixed(1)} NM`],
        ['VELOCITY', `${Math.round(st.speed / FT).toLocaleString('en-US')} FPS`],
        ['FLT PATH ANGLE', Number.isNaN(gam) ? '---' : `${gam >= 0 ? '+' : ''}${gam.toFixed(2)}°`],
        ['APOGEE / PERIGEE', Number.isNaN(st.apoAlt) || !d.flying ? '---' : `${(st.apoAlt / NMI).toFixed(1)} / ${(st.periAlt / NMI).toFixed(1)}`],
        ['ACCEL', `${(st.gLoad || 0).toFixed(2)} G`],
        [st.primary === 'MOON' ? 'MOON DIST' : 'EARTH DIST', st.primary === 'MOON' ? `${(st.rRel.length() / NMI).toFixed(0)} NM` : `${(st.r.length() / NMI).toFixed(0)} NM`],
      ];
      rows.forEach(([l, v], i) => this.row(i + 1, l, v, { y0: 96 }));
      if (d.los) {
        g.fillStyle = '#ff8a6a';
        g.font = '700 34px "Barlow Condensed", sans-serif';
        g.textAlign = 'center';
        g.fillText(st.inBlackout ? 'BLACKOUT · NO DATA' : 'LOS · NO DATA', this.W / 2, this.H - 40);
      }
      void ph;
    } else if (this.kind === 'consumables') {
      this._frame(this.title);
      const tm = d.tm;
      const n = (k) => (typeof tm[k] === 'number' ? tm[k] : NaN);
      const items = [];
      if (d.sim.csm) {
        items.push(['SPS PROP', n('CM.SPS.OX_QTY')]);
        items.push(['SM RCS', (n('CM.RCS.QUAD_A.QTY') + n('CM.RCS.QUAD_B.QTY') + n('CM.RCS.QUAD_C.QTY') + n('CM.RCS.QUAD_D.QTY')) / 4]);
        items.push(['O2 TANK 1', n('CM.CRYO.O2_1.QTY')]);
        items.push(['O2 TANK 2', n('CM.CRYO.O2_2.QTY')]);
        items.push(['H2 TANKS', (n('CM.CRYO.H2_1.QTY') + n('CM.CRYO.H2_2.QTY')) / 2]);
      }
      if (d.sim.lm) {
        items.push(['LM DPS', n('LM.DPS.FUEL_QTY')]);
        let ah = 0;
        for (let i = 1; i <= 6; i++) ah += n(`LM.EPS.BAT${i}.AH`) || 0;
        items.push(['LM BATTERIES', ah / (4 * 415 + 2 * 296)]);
        items.push(['LM H2O', n('LM.ECS.H2O_DES_QTY')]);
      }
      if (d.sim.saturn && !items.length) items.push(['S-IVB PROP', (n('SAT.PROP_KG') || 0) / 109000]);
      items.slice(0, 8).forEach(([l, f], i) => this.bar(i + 0.4, l, f, { y0: 96, lh: 56 }));
    } else if (this.kind === 'events') {
      this._frame(this.title);
      const ev = d.events.slice(-10);
      g.textAlign = 'left';
      ev.forEach((e, i) => {
        const y = 92 + i * 47;
        g.font = '24px "Share Tech Mono", monospace';
        g.fillStyle = C.dim;
        g.fillText(d.fmtShort(e.get), 22, y);
        g.font = '600 26px "Barlow Condensed", sans-serif';
        g.fillStyle = e.level === 'alarm' ? '#ff8a6a' : e.level === 'crew' ? '#9fd8ff' : '#ffffff';
        const txt = e.text.toUpperCase();
        g.fillText(txt.length > 30 ? `${txt.slice(0, 29)}…` : txt, 190, y);
      });
      if (!ev.length) {
        g.fillStyle = C.dim;
        g.font = '600 26px "Barlow Condensed", sans-serif';
        g.fillText('AWAITING EVENTS', 24, 100);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** Digital clock strip (GMT · GET · next event) above the screens. */
export class ClockStrip {
  constructor({ data, sim, runner }) {
    this.d = data;
    this.sim = sim;
    this.runnerRef = runner;
    this.W = 2048;
    this.H = 160;
    this.canvas = canvas(this.W, this.H);
    this.g = this.canvas.getContext('2d');
    this.texture = makeTexture(this.canvas);
    this._last = '';
  }

  update() {
    const c = this.sim.clock;
    const utc = new Date(c.utcMs);
    const gmt = `${String(utc.getUTCDate()).padStart(2, '0')} ${String(utc.getUTCHours()).padStart(2, '0')}:${String(utc.getUTCMinutes()).padStart(2, '0')}:${String(utc.getUTCSeconds()).padStart(2, '0')}`;
    const get = c.get < 0 ? MissionClock.formatT(c.get) : MissionClock.format(c.get);
    const skip = this.sim.runner?.skip;
    let next = '--:--:--';
    let nextLabel = 'NEXT EVENT';
    if (skip && skip.get > c.get) {
      const s = Math.floor(skip.get - c.get);
      next = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      nextLabel = (skip.label ?? 'NEXT EVENT').toUpperCase().slice(0, 22);
    }
    const key = `${gmt}|${get}|${next}|${nextLabel}`;
    if (key === this._last) return;
    this._last = key;
    const g = this.g;
    const { W, H } = this;
    g.fillStyle = '#07090b';
    g.fillRect(0, 0, W, H);
    const cell = (x, w, label, value, color) => {
      g.fillStyle = '#0d1114';
      g.fillRect(x + 8, 8, w - 16, H - 16);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.strokeRect(x + 8, 8, w - 16, H - 16);
      g.fillStyle = 'rgba(230,236,240,0.62)';
      g.font = '600 28px "Barlow Condensed", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, 34);
      g.font = '74px "Share Tech Mono", monospace';
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 16;
      g.fillText(value, x + w / 2, 104);
      g.shadowBlur = 0;
    };
    cell(0, 620, 'GREENWICH MEAN TIME', gmt, '#ff9d4a');
    cell(620, 760, 'GROUND ELAPSED TIME', get, '#ff6a3d');
    cell(1380, 668, nextLabel, next, '#ffcf6a');
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
