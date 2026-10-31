// CRT telemetry pages of the Mission Control consoles (Philco-Ford "D/TV" displays: white-blue
// phosphor characters on black, 40 × 16 character grid). Every page reads the live MOCRData:
// values go static ("S") during LOS / blackout and garble while telemetry quality is bad
// (Apollo 12 SCE, Apollo 13's 1.8 s dropout). Out-of-limit values blink in inverse video.
//
//   drawPage(g, pageId, d, { w, h, t, hi })   g: CanvasRenderingContext2D of the CRT canvas

import { FT, NMI, R_EARTH, R_MOON, MU_EARTH, MU_MOON } from '../../core/constants.js';
import { MSFN } from '../MOCRData.js';

const COLS = 40;
const ROWS = 16;
const VW = 512; // virtual page size: every page is laid out in 512 × 384 units
const VH = 384;
const CW = VW / COLS;
const RH = VH / ROWS;

export const PHOSPHOR = '#d9ecff';
const DIM = 'rgba(205,228,255,0.42)';
const FAINT = 'rgba(205,228,255,0.16)';

const GARBLE = '#%&8@$*?=/';

/** Writer bound to one CRT frame. */
class W {
  begin(g, d, { w, h, t, hi }) {
    this.g = g;
    this.d = d;
    this.t = t;
    this.hi = hi;
    this.los = d.los;
    this.q = d.quality;
    g.setTransform(w / VW, 0, 0, h / VH, 0, 0);
    g.fillStyle = '#05080b';
    g.fillRect(0, 0, VW, VH);
    g.font = `${hi ? 21 : 20}px "Share Tech Mono", monospace`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    if (hi) {
      g.shadowColor = 'rgba(170,215,255,0.55)';
      g.shadowBlur = 5;
    } else g.shadowBlur = 0;
    this.blink = Math.floor(t * 2.2) % 2 === 0;
  }

  /** Raw text at (col,row). */
  at(col, row, s, color = PHOSPHOR) {
    const g = this.g;
    g.fillStyle = color;
    g.fillText(s, col * CW + 4, row * RH + RH / 2 + 1);
  }

  /** Inverse-video text (headers, alarms). */
  inv(col, row, s, color = PHOSPHOR) {
    const g = this.g;
    const sb = g.shadowBlur;
    g.shadowBlur = 0;
    g.fillStyle = color;
    g.fillRect(col * CW + 2, row * RH + 2, s.length * CW + 4, RH - 3);
    g.fillStyle = '#05080b';
    g.fillText(s, col * CW + 4, row * RH + RH / 2 + 1);
    g.shadowBlur = sb;
  }

  header(title, code) {
    const d = this.d;
    this.inv(0, 0, ` ${title}`.padEnd(COLS - 1), PHOSPHOR);
    const right = `${code}`;
    const g = this.g;
    g.fillStyle = '#05080b';
    g.textAlign = 'right';
    g.fillText(right, VW - 8, RH / 2 + 1);
    g.textAlign = 'left';
    const get = d.fmtShort(d.get);
    let tail = `GET ${get}`;
    if (this.los) tail += this.blink ? '   LOS · NO DATA' : '';
    else if (this.q < 0.98) tail += this.blink ? '   TLM DROPOUT' : '';
    this.at(0, ROWS - 1, tail, this.los || this.q < 0.98 ? PHOSPHOR : DIM);
    this.at(COLS - 10, ROWS - 1, d.mission?.id === 'apollo13' ? 'MOCR-2 A13' : 'MOCR-2', DIM);
  }

  /** Format a telemetry number into `width` characters; static/garbled as needed. */
  num(v, dec = 1, width = 7, sign = false) {
    if (v === undefined || v === null || Number.isNaN(v)) return '-'.repeat(Math.min(width, 5)).padStart(width);
    let s = Math.abs(v) >= 1e6 ? v.toExponential(2) : v.toFixed(dec);
    if (sign && v >= 0) s = `+${s}`;
    if (this.q < 0.999 && !this.los) {
      const p = (1 - this.q) * 0.9;
      s = [...s].map((c) => (Math.random() < p ? GARBLE[(Math.random() * GARBLE.length) | 0] : c)).join('');
    }
    return s.padStart(width);
  }

  /** label .... value unit, with limit flags. lim: { warn: bool, caution: bool } */
  kv(col, row, label, value, unit = '', { lw = 10, warn = false, caution = false } = {}) {
    this.at(col, row, label.padEnd(lw).slice(0, lw), DIM);
    const s = `${value}${this.los ? 'S' : ''}`;
    const x = col + lw;
    if (warn && !this.los) {
      if (this.blink) this.inv(x, row, s);
      else this.at(x, row, s);
    } else this.at(x, row, s, caution && !this.los ? '#ffffff' : PHOSPHOR);
    if (unit) this.at(x + s.length + 1, row, unit, DIM);
  }

  /** Horizontal bar 0..1 in `width` cells. */
  bar(col, row, frac, width = 12, { warn = false } = {}) {
    const g = this.g;
    const x = col * CW + 4;
    const y = row * RH + 6;
    const wpx = width * CW - 8;
    g.strokeStyle = DIM;
    g.lineWidth = 1;
    g.strokeRect(x, y, wpx, RH - 12);
    const f = Number.isNaN(frac) ? 0 : Math.max(0, Math.min(1, frac));
    if (!(warn && !this.blink)) {
      g.fillStyle = PHOSPHOR;
      g.fillRect(x + 2, y + 2, (wpx - 4) * f, RH - 16);
    }
  }

  wrap(text, width) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
    return out;
  }

  /** Plot area in grid cells → pixel rect. */
  rect(c0, r0, c1, r1) {
    return { x: c0 * CW + 4, y: r0 * RH + 2, w: (c1 - c0) * CW - 8, h: (r1 - r0) * RH - 4 };
  }
}

const w = new W();
const pct = (v) => (Number.isNaN(v) ? NaN : v * 100);
const up = (s) => String(s ?? '').toUpperCase();
/** Spanish text for the CRT (keeps accents, the font has them). */
const ES = (s) => up(s).replace(/\s+/g, ' ');

// ------------------------------------------------------------------ pages

function flightSummary(w, d) {
  const st = d.st;
  const tm = d.tm;
  w.header('FLIGHT DIRECTOR SUMMARY', 'PG 01');
  w.kv(0, 1, 'MISSION', up(d.mission?.name ?? '').replace('APOLO', 'APOLLO'), '', { lw: 9 });
  w.kv(20, 1, 'CFG', d.v.config.replace(/_/g, ' ').slice(0, 13), '', { lw: 4 });
  w.at(0, 2, ES(d.phaseEs), PHOSPHOR);
  w.kv(0, 3, 'ALT', w.num(st.alt / NMI, 1, 8), 'NM');
  w.kv(20, 3, 'VI', w.num(st.speed / FT, 0, 7), 'FPS', { lw: 4 });
  w.kv(0, 4, 'HA', w.num(st.apoAlt / NMI, 1, 8), 'NM');
  w.kv(20, 4, 'HP', w.num(st.periAlt / NMI, 1, 7), 'NM', { lw: 4, caution: st.periAlt < 40 * NMI && d.flying && st.primary === 'EARTH' && d.phase !== 'ENTRY' });
  const maCM = d.b('CM.CW.MASTER_ALARM');
  const maLM = d.b('LM.CW.MASTER_ALARM');
  w.kv(0, 5, 'MA CSM', maCM ? 'ON ' : 'OFF', '', { warn: maCM, lw: 7 });
  w.kv(20, 5, 'MA LM', maLM ? 'ON ' : 'OFF', '', { warn: maLM, lw: 6 });
  const cmc = d.sim.gnc?.cmc?.dsky?.display;
  const lgc = d.sim.gnc?.lgc?.dsky?.display;
  w.kv(0, 6, 'CMC PROG', cmc?.prog ?? '--', '', { lw: 9 });
  w.kv(20, 6, 'LGC PROG', lgc?.prog ?? '--', '', { lw: 9 });
  w.kv(0, 7, 'SPS', w.num(pct(d.t('CM.SPS.OX_QTY')), 1, 5), '%', { lw: 4 });
  const rcs = (d.t('CM.RCS.QUAD_A.QTY') + d.t('CM.RCS.QUAD_B.QTY') + d.t('CM.RCS.QUAD_C.QTY') + d.t('CM.RCS.QUAD_D.QTY')) / 4;
  w.kv(13, 7, 'RCS', w.num(pct(rcs), 0, 4), '%', { lw: 4 });
  const o2 = (d.t('CM.CRYO.O2_1.QTY') + d.t('CM.CRYO.O2_2.QTY')) / 2;
  w.kv(26, 7, 'O2', w.num(pct(o2), 0, 4), '%', { lw: 3, warn: o2 < 0.2 });
  if (d.v.hasLM) {
    w.kv(0, 8, 'LM DPS', w.num(pct(d.t('LM.DPS.FUEL_QTY')), 1, 5), '%', { lw: 7 });
    w.kv(20, 8, 'LM AMPS', w.num(d.t('LM.EPS.TOTAL_AMPS'), 1, 5), '', { lw: 8 });
  }
  const sv = d.stationInView();
  w.kv(0, 9, 'COMM', d.los ? 'LOS' : sv.station ? `AOS ${sv.station.name}` : '---', '', { lw: 5 });
  const p = d.poll;
  if (p) {
    const go = p.consoles.filter((c) => c.answer === 'GO').length;
    const no = p.consoles.filter((c) => c.answer === 'NOGO').length;
    w.kv(0, 10, 'POLL', `${go} GO / ${no} NO GO / ${p.consoles.length}`, '', { lw: 5, warn: no > 0 });
  }
  w.at(0, 11, 'LAST EVENTS', DIM);
  const ev = d.events.slice(-3);
  ev.forEach((e, i) => w.at(0, 12 + i, `${d.fmtShort(e.get)} ${ES(e.text)}`.slice(0, COLS), e.level === 'alarm' ? '#ffffff' : PHOSPHOR));
}

function traj(w, d) {
  const st = d.st;
  w.header(`${d.st.primary === 'MOON' ? 'LUNAR' : 'EARTH'} TRAJECTORY · FIDO`, 'PG 11');
  const gamma = st.speed > 1 ? (Math.asin(Math.max(-1, Math.min(1, st.hdot / st.speed))) * 180) / Math.PI : NaN;
  w.kv(0, 1, 'ALT', w.num(st.alt / FT, 0, 9), 'FT');
  w.kv(22, 1, '', w.num(st.alt / NMI, 1, 8), 'NM', { lw: 0 });
  w.kv(0, 2, 'VI', w.num(st.speed / FT, 0, 9), 'FPS');
  w.kv(22, 2, 'GAM', w.num(gamma, 2, 7, true), 'DEG', { lw: 4 });
  w.kv(0, 3, 'HDOT', w.num(st.hdot / FT, 0, 9, true), 'FPS');
  w.kv(0, 4, 'HA', w.num(st.apoAlt / NMI, 1, 9), 'NM');
  w.kv(22, 4, 'HP', w.num(st.periAlt / NMI, 1, 7), 'NM', { lw: 4 });
  w.kv(0, 5, 'INCL', w.num(st.inclination * (180 / Math.PI), 2, 9), 'DEG');
  const lat = st.primary === 'MOON' ? d.mlat : d.lat;
  const lon = st.primary === 'MOON' ? d.mlon : d.lon;
  w.kv(0, 6, 'LAT', w.num(lat, 2, 9, true), '');
  w.kv(22, 6, 'LON', w.num(lon, 2, 8, true), '', { lw: 4 });
  w.kv(0, 7, 'R EARTH', w.num(d.st.r.length() / NMI, 0, 9), 'NM');
  w.kv(0, 8, 'R MOON', w.num(d.moonDistNmi, 0, 9), 'NM');
  w.kv(0, 9, 'SOI', st.primary === 'MOON' ? 'MOON' : 'EARTH', '');
  // orbital period (closed orbits)
  const mu = st.primary === 'MOON' ? MU_MOON : MU_EARTH;
  const rl = st.rRel?.length?.() || st.r.length();
  const en = (st.speed * st.speed) / 2 - mu / rl;
  if (en < 0) {
    const a = -mu / (2 * en);
    const T = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    w.kv(22, 9, 'PER', w.num(T / 60, 1, 7), 'MIN', { lw: 4 });
  }
  if (d.phase === 'ASCENT' || st.dynPressure > 10) {
    w.kv(0, 10, 'MACH', w.num(st.mach, 2, 9), '');
    w.kv(22, 10, 'Q', w.num(st.dynPressure / 47.88, 0, 7), 'PSF', { lw: 4, caution: st.dynPressure > 30000 });
    w.kv(0, 11, 'G', w.num(st.gLoad, 2, 9), '');
  }
  const R = st.primary === 'MOON' ? R_MOON : R_EARTH;
  void R;
  w.at(0, 13, d.track.length > 1 || d.moonTrack.length > 1 ? 'TRACK RECORDING' : '', DIM);
}

function plot(w, d) {
  const g = w.g;
  const ph = d.phase;
  const cis = ph === 'TLC' || ph === 'TEC';
  w.header(cis ? 'EARTH-MOON PLOT · ROTATING' : d.st.primary === 'MOON' ? 'LUNAR GROUND TRACK' : 'GROUND TRACK', 'PG 12');
  const r = w.rect(0, 1, COLS, ROWS - 1);
  g.save();
  g.strokeStyle = FAINT;
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  if (cis) {
    // Earth at left third, Moon at right
    const ox = r.x + r.w * 0.15;
    const oy = r.y + r.h / 2;
    const s = r.w * 0.75;
    g.strokeStyle = DIM;
    g.beginPath();
    g.arc(ox, oy, 6, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(ox + s, oy, 4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = DIM;
    g.fillText('E', ox - 4, oy + 18);
    g.fillText('M', ox + s - 5, oy + 18);
    g.strokeStyle = PHOSPHOR;
    g.beginPath();
    d.lunarPath.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy - y * s) : g.moveTo(ox + x * s, oy - y * s)));
    g.stroke();
    if (d.emX !== undefined && w.blink) {
      g.fillStyle = PHOSPHOR;
      g.fillRect(ox + d.emX * s - 3, oy - d.emY * s - 3, 6, 6);
    }
  } else {
    const track = d.st.primary === 'MOON' ? d.moonTrack : d.track;
    g.strokeStyle = FAINT;
    for (let lo = -180; lo <= 180; lo += 30) {
      const x = r.x + ((lo + 180) / 360) * r.w;
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
    }
    for (let la = -60; la <= 60; la += 30) {
      const y = r.y + ((90 - la) / 180) * r.h;
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
    }
    g.strokeStyle = PHOSPHOR;
    g.beginPath();
    let prev = null;
    for (const [la, lo] of track) {
      const x = r.x + ((lo + 180) / 360) * r.w;
      const y = r.y + ((90 - la) / 180) * r.h;
      if (prev === null || Math.abs(lo - prev) > 180) g.moveTo(x, y);
      else g.lineTo(x, y);
      prev = lo;
    }
    g.stroke();
    const la = d.st.primary === 'MOON' ? d.mlat : d.lat;
    const lo = d.st.primary === 'MOON' ? d.mlon : d.lon;
    if (w.blink) {
      g.fillStyle = PHOSPHOR;
      g.fillRect(r.x + ((lo + 180) / 360) * r.w - 4, r.y + ((90 - la) / 180) * r.h - 4, 8, 8);
    }
    if (d.st.primary !== 'MOON') {
      g.fillStyle = DIM;
      for (const s of MSFN) g.fillRect(r.x + ((s.lon + 180) / 360) * r.w - 1.5, r.y + ((90 - s.lat) / 180) * r.h - 1.5, 3, 3);
    }
  }
  g.restore();
}

function booster(w, d) {
  const sat = d.sim.saturn;
  const tm = d.tm;
  w.header('LAUNCH VEHICLE · BOOSTER', 'PG 31');
  if (!sat) {
    w.at(0, 2, 'NO LAUNCH VEHICLE DATA', DIM);
    w.at(0, 3, 'S-IVB JETTISONED / NOT IN CONFIG', DIM);
    return;
  }
  const stage = tm['SAT.STAGE'] ?? sat.stage;
  w.kv(0, 1, 'VEHICLE', d.mission?.id === 'apollo13' ? 'SA-508' : d.mission?.id === 'apollo12' ? 'SA-507' : 'SA-506', '', { lw: 8 });
  w.kv(20, 1, 'STAGE', String(stage).replace('SIVB', 'S-IVB').replace('SII', 'S-II').replace('SIC', 'S-IC').replace('_', ' '), '', { lw: 6 });
  // engine status boxes
  const n = stage === 'SIC' || stage === 'SII' ? 5 : 1;
  w.at(0, 2, 'ENG', DIM);
  for (let i = 1; i <= 5; i++) {
    const on = i <= n && !tm[`CM.LV.ENG${i}`] && (tm['SAT.ENGINES_ON'] ?? 0) > 0;
    const label = ` ${i} `;
    if (i > n) w.at(4 + (i - 1) * 4, 2, ' - ', FAINT);
    else if (on) w.inv(4 + (i - 1) * 4, 2, label);
    else w.at(4 + (i - 1) * 4, 2, `[${i}]`, (tm['SAT.ENGINES_ON'] ?? 0) > 0 && w.blink ? '#ffffff' : DIM);
  }
  w.at(26, 2, (tm['SAT.ENGINES_ON'] ?? 0) > 0 ? 'THRUST OK' : 'NO THRUST', (tm['SAT.ENGINES_ON'] ?? 0) > 0 ? PHOSPHOR : DIM);
  w.kv(0, 3, 'THRUST', w.num((tm['SAT.THRUST_N'] ?? 0) / 4448.2 / 1000, 1, 8), 'KLBF', { lw: 8 });
  w.kv(0, 4, 'PROP', w.num((tm['SAT.PROP_KG'] ?? 0) * 2.2046 / 1000, 1, 8), 'KLB', { lw: 8 });
  w.kv(0, 5, 'ACCEL', w.num(d.st.gLoad, 2, 8), 'G', { lw: 8, caution: d.st.gLoad > 3.9 });
  w.kv(20, 5, 'Q', w.num(d.st.dynPressure / 47.88, 0, 6), 'PSF', { lw: 3 });
  w.kv(0, 6, 'ALT', w.num(d.st.alt / FT, 0, 8), 'FT', { lw: 8 });
  w.kv(20, 6, 'MACH', w.num(d.st.mach, 2, 6), '', { lw: 5 });
  w.kv(0, 7, 'VI', w.num(d.st.speed / FT, 0, 8), 'FPS', { lw: 8 });
  if (d.tm['SAT.MANUAL']) w.kv(0, 8, 'GUIDANCE', 'CMC MANUAL TAKEOVER', '', { lw: 9, warn: true });
  else w.kv(0, 8, 'GUIDANCE', stage === 'SIVB_COAST' ? 'IU ORB RATE' : 'IU', '', { lw: 9 });
  if (!Number.isNaN(tm['SAT.TB6'] ?? NaN)) w.kv(0, 9, 'TB6', d.fmtShort(tm['SAT.TB6']), '', { lw: 9 });
  const done = sat.done ? [...sat.done] : [];
  const keyEv = done.filter((k) => /CECO|OECO|SEP|IGNITION|CUTOFF|INSERTION|JETT/.test(k)).slice(-5);
  w.at(0, 10, 'SEQUENCE', DIM);
  keyEv.forEach((k, i) => w.at(0, 11 + i, k.replace(/_/g, ' '), PHOSPHOR));
}

function eps(w, d) {
  w.header('CSM EPS · EECOM', 'PG 21');
  const mna = d.t('CM.EPS.MNA.V');
  const mnb = d.t('CM.EPS.MNB.V');
  w.kv(0, 1, 'MAIN A', w.num(mna, 1, 6), 'V', { lw: 7, warn: mna < 26.25 });
  w.kv(20, 1, 'MAIN B', w.num(mnb, 1, 6), 'V', { lw: 7, warn: mnb < 26.25 });
  w.kv(0, 2, 'AC 1', w.num(d.t('CM.EPS.AC1.V'), 1, 7), 'V', { lw: 6, warn: d.t('CM.EPS.AC1.V') < 95 });
  w.kv(20, 2, 'AC 2', w.num(d.t('CM.EPS.AC2.V'), 1, 7), 'V', { lw: 6, warn: d.t('CM.EPS.AC2.V') < 95 });
  w.at(0, 3, 'FUEL CELL       1       2       3', DIM);
  const fc = [1, 2, 3];
  const line = (row, label, f, warnF) => {
    w.at(0, row, label, DIM);
    fc.forEach((i, j) => {
      const v = f(i);
      const s = typeof v === 'string' ? v.padStart(6) : w.num(v, 1, 6);
      const warn = warnF?.(i, v);
      if (warn && !w.los && w.blink) w.inv(14 + j * 8, row, s);
      else w.at(14 + j * 8, row, s + (w.los ? 'S' : ''));
    });
  };
  line(4, 'AMPS', (i) => d.t(`CM.EPS.FC${i}.AMPS`));
  line(5, 'VOLTS', (i) => d.t(`CM.EPS.FC${i}.V`), (i, v) => v < 26);
  line(6, 'TEMP F', (i) => d.t(`CM.EPS.FC${i}.TEMP_F`), (i, v) => v < 380 || v > 475);
  line(7, 'ON LINE', (i) => (d.tm[`CM.EPS.FC${i}.ON_LINE`] ? 'YES' : 'NO'), (i, v) => v === 'NO');
  const ind = d.t('CM.EPS.IND_AMPS');
  w.kv(0, 9, 'TOTAL AMPS', w.num(ind, 1, 6), 'A', { lw: 11 });
  w.at(0, 10, 'ENTRY BAT    A       B       C', DIM);
  ['A', 'B', 'C'].forEach((b, j) => {
    w.at(11 + j * 8, 11, w.num(d.t(`CM.EPS.BAT_${b}.V`), 1, 6) + (w.los ? 'S' : ''));
    w.at(11 + j * 8, 12, w.num(d.t(`CM.EPS.BAT_${b}.AH`), 1, 6));
  });
  w.at(0, 11, 'VOLTS', DIM);
  w.at(0, 12, 'AMP-HR', DIM);
  const uvA = d.b('CM.CW.MAIN_BUS_A_UNDERVOLT');
  const uvB = d.b('CM.CW.MAIN_BUS_B_UNDERVOLT');
  if (uvA || uvB) {
    if (w.blink) w.inv(0, 13, `MAIN BUS ${uvA && uvB ? 'A+B' : uvA ? 'A' : 'B'} UNDERVOLT`);
    else w.at(0, 13, `MAIN BUS ${uvA && uvB ? 'A+B' : uvA ? 'A' : 'B'} UNDERVOLT`);
  }
}

function cryo(w, d) {
  w.header('CSM CRYOGENICS · EECOM', 'PG 22');
  const rows = [
    ['O2 TK 1', 'CM.CRYO.O2_1', 865, 935],
    ['O2 TK 2', 'CM.CRYO.O2_2', 865, 935],
    ['H2 TK 1', 'CM.CRYO.H2_1', 225, 260],
    ['H2 TK 2', 'CM.CRYO.H2_2', 225, 260],
  ];
  w.at(0, 1, 'TANK       PRESS      QTY', DIM);
  rows.forEach(([label, k, lo, hi], i) => {
    const r = 2 + i * 2;
    const p = d.t(`${k}.P_PSI`);
    const q = d.t(`${k}.QTY`);
    w.at(0, r, label, DIM);
    const warnP = !Number.isNaN(p) && (p < lo - 60 || p > hi + 80);
    const sP = `${w.num(p, 0, 5)}${w.los ? 'S' : ''}`;
    if (warnP && !w.los && w.blink) w.inv(10, r, sP);
    else w.at(10, r, sP);
    w.at(16, r, 'PSI', DIM);
    const sQ = `${w.num(pct(q), 1, 5)}%`;
    if (q < 0.05 && !w.los && w.blink) w.inv(21, r, sQ);
    else w.at(21, r, sQ);
    w.bar(28, r, q, 11, { warn: q < 0.05 });
  });
  w.kv(0, 11, 'CRYO PRESS', d.b('CM.CW.CRYO_PRESS') ? 'LIGHT' : 'OFF', '', { lw: 11, warn: d.b('CM.CW.CRYO_PRESS') });
  w.kv(0, 12, 'O2 FLOW', w.num(d.t('CM.ECS.O2_FLOW_LBH'), 2, 6), 'LB/HR', { lw: 11, warn: d.b('CM.CW.O2_FLOW_HI') });
  w.kv(0, 13, 'FANS O2', `${d.tm['CM.CRYO.O2_FAN_1'] ?? '-'}/${d.tm['CM.CRYO.O2_FAN_2'] ?? '-'}`.slice(0, 18), '', { lw: 11 });
}

function ecs(w, d) {
  w.header('CSM ENVIRONMENT · EECOM', 'PG 23');
  const cp = d.t('CM.ECS.CABIN.P_PSI');
  w.kv(0, 1, 'CABIN P', w.num(cp, 2, 6), 'PSIA', { lw: 9, warn: cp < 4.5 && d.get > 600 });
  w.kv(0, 2, 'CABIN T', w.num(d.t('CM.ECS.CABIN.T_F'), 1, 6), 'F', { lw: 9, caution: d.t('CM.ECS.CABIN.T_F') < 50 });
  w.kv(0, 3, 'SUIT P', w.num(d.t('CM.ECS.SUIT.P_PSI'), 2, 6), 'PSIA', { lw: 9 });
  const co2 = d.t('CM.ECS.PPCO2_MMHG');
  w.kv(0, 4, 'PPCO2', w.num(co2, 1, 6), 'MMHG', { lw: 9, warn: co2 > 7.6 });
  w.bar(24, 4, co2 / 15, 15, { warn: co2 > 7.6 });
  w.kv(0, 5, 'O2 FLOW', w.num(d.t('CM.ECS.O2_FLOW_LBH'), 2, 6), 'LB/HR', { lw: 9 });
  w.kv(0, 7, 'GLYCOL T', w.num(d.t('CM.ECS.GLYCOL_T_F'), 1, 6), 'F', { lw: 9, caution: d.b('CM.CW.GLYCOL_TEMP_LOW') });
  w.kv(0, 8, 'H2O POT', w.num(pct(d.t('CM.ECS.H2O_POT_QTY')), 0, 6), '%', { lw: 9 });
  w.kv(0, 9, 'H2O WASTE', w.num(pct(d.t('CM.ECS.H2O_WASTE_QTY')), 0, 6), '%', { lw: 10 });
  const comp1 = d.sim.vehicle.sw.get?.('CM.ECS.SUIT_COMPR_1');
  const comp2 = d.sim.vehicle.sw.get?.('CM.ECS.SUIT_COMPR_2');
  w.kv(0, 11, 'SUIT COMP', `${comp1 ?? '-'} / ${comp2 ?? '-'}`, '', { lw: 10 });
  w.kv(0, 12, 'CO2 LIGHT', d.b('CM.CW.CO2_PP_HI') ? 'ON' : 'OFF', '', { lw: 10, warn: d.b('CM.CW.CO2_PP_HI') });
}

function gnc(w, d) {
  w.header('CSM GUIDANCE & CONTROL · GNC', 'PG 41');
  w.at(0, 1, 'ATTITUDE    ROLL    PITCH     YAW', DIM);
  w.at(0, 2, 'FDAI 1', DIM);
  w.at(10, 2, `${w.num(d.t('CM.FDAI1.ROLL'), 1, 7)} ${w.num(d.t('CM.FDAI1.PITCH'), 1, 7)} ${w.num(d.t('CM.FDAI1.YAW'), 1, 7)}`);
  w.at(0, 3, 'RATE', DIM);
  w.at(10, 3, `${w.num(d.t('CM.FDAI1.RATE_ROLL') * 5, 2, 7, true)} ${w.num(d.t('CM.FDAI1.RATE_PITCH') * 5, 2, 7, true)} ${w.num(d.t('CM.FDAI1.RATE_YAW') * 5, 2, 7, true)}`);
  const ig = d.t('CM.GNC.IMU.IGA');
  const og = d.t('CM.GNC.IMU.OGA');
  const mg = d.t('CM.GNC.IMU.MGA');
  w.at(0, 5, 'IMU GIMBALS  OGA     IGA     MGA', DIM);
  w.at(10, 6, `${w.num(og, 1, 7)} ${w.num(ig, 1, 7)}`);
  const mgs = w.num(Number.isNaN(mg) ? NaN : ((mg + 540) % 360) - 180, 1, 7);
  const lock = Math.abs(((mg + 540) % 360) - 180) > 70;
  if (lock && !w.los && w.blink) w.inv(26, 6, mgs);
  else w.at(26, 6, mgs);
  if (lock) w.at(0, 7, 'GIMBAL LOCK APPROACH', w.blink ? '#ffffff' : DIM);
  w.at(0, 8, 'SM RCS     A      B      C      D', DIM);
  w.at(0, 9, 'QTY %', DIM);
  ['A', 'B', 'C', 'D'].forEach((q, j) => w.at(8 + j * 7, 9, w.num(pct(d.t(`CM.RCS.QUAD_${q}.QTY`)), 0, 5)));
  w.kv(0, 11, 'SPS OX', w.num(pct(d.t('CM.SPS.OX_QTY')), 1, 6), '%', { lw: 8 });
  w.kv(20, 11, 'FUEL', w.num(pct(d.t('CM.SPS.FUEL_QTY')), 1, 6), '%', { lw: 5 });
  w.kv(0, 12, 'SPS PC', w.num(d.t('CM.SPS.PC_PSI'), 0, 6), 'PSI', { lw: 8 });
  w.kv(20, 12, 'THRUST', d.b('CM.SPS.THRUST') ? 'ON' : 'OFF', '', { lw: 7, caution: d.b('CM.SPS.THRUST') });
  w.kv(0, 13, 'CMC MODE', String(d.sim.vehicle.sw.get?.('CM.GNC.CMC_MODE') ?? '-'), '', { lw: 9 });
}

function agcBlock(w, col, label, agc) {
  const dsp = agc?.dsky?.display;
  w.at(col, 1, label, DIM);
  if (!agc || !dsp) {
    w.at(col, 2, 'NO DATA', DIM);
    return;
  }
  w.kv(col, 2, 'PROG', dsp.prog ?? '--', '', { lw: 5 });
  w.kv(col, 3, 'VERB', dsp.verb ?? '--', '', { lw: 5 });
  w.kv(col, 4, 'NOUN', dsp.noun ?? '--', '', { lw: 5 });
  w.kv(col, 5, 'R1', dsp.r1 ?? '', '', { lw: 3 });
  w.kv(col, 6, 'R2', dsp.r2 ?? '', '', { lw: 3 });
  w.kv(col, 7, 'R3', dsp.r3 ?? '', '', { lw: 3 });
  const L = dsp.lights ?? {};
  const lights = [['PROG', L.prog], ['RESTART', L.restart], ['GMBL LK', L.gimbalLock], ['OPR ERR', L.oprErr], ['UPLINK', L.uplinkActy], ['KEY REL', L.keyRel]];
  lights.forEach(([n, on], i) => {
    if (on) w.inv(col + (i % 2) * 9, 9 + Math.floor(i / 2), n);
    else w.at(col + (i % 2) * 9, 9 + Math.floor(i / 2), n, FAINT);
  });
  if (dsp.flashVN && w.blink) w.at(col + 12, 3, '<<', PHOSPHOR);
}

function agc(w, d) {
  w.header('COMPUTERS · GUIDO', 'PG 51');
  agcBlock(w, 0, 'CMC (COLOSSUS)', d.sim.gnc?.cmc);
  agcBlock(w, 20, 'LGC (LUMINARY)', d.v.hasLM ? d.sim.gnc?.lgc : null);
  const al = d.alarms.filter((a) => /PROG ALARM/.test(a.text)).slice(-2);
  al.forEach((a, i) => w.at(0, 12 + i, `${d.fmtShort(a.get)} ${a.text}`.slice(0, COLS), '#ffffff'));
  if (!al.length) w.at(0, 12, 'NO PROGRAM ALARMS', FAINT);
}

function lmEps(w, d) {
  w.header('LM ELECTRICAL · TELMU', 'PG 61');
  if (!d.v.hasLM && !d.sim.lm) {
    w.at(0, 2, 'LM NOT IN CONFIGURATION', DIM);
    return;
  }
  w.kv(0, 1, 'CDR BUS', w.num(d.t('LM.EPS.CDR_BUS.V'), 1, 6), 'V', { lw: 8, warn: d.t('LM.EPS.CDR_BUS.V') < 26.5 && d.t('LM.EPS.CDR_BUS.V') > 1 });
  w.kv(20, 1, 'LMP BUS', w.num(d.t('LM.EPS.LMP_BUS.V'), 1, 6), 'V', { lw: 8 });
  w.kv(0, 2, 'AC BUS', w.num(d.t('LM.EPS.AC.V'), 1, 6), 'V', { lw: 8 });
  const amps = d.t('LM.EPS.TOTAL_AMPS');
  w.kv(20, 2, 'AMPS', w.num(amps, 1, 6), 'A', { lw: 8, caution: amps > 60 });
  w.at(0, 3, 'BATT   VOLTS   AMP-HR', DIM);
  let ah = 0;
  for (let i = 1; i <= 6; i++) {
    const v = d.t(`LM.EPS.BAT${i}.V`);
    const a = d.t(`LM.EPS.BAT${i}.AH`);
    if (!Number.isNaN(a)) ah += a;
    w.at(0, 3 + i, `${i <= 4 ? 'DES' : 'ASC'} ${i}`, DIM);
    w.at(6, 3 + i, `${w.num(v, 1, 6)}  ${w.num(a, 0, 6)}`);
    w.bar(24, 3 + i, a / (i <= 4 ? 415 : 296), 15);
  }
  w.kv(0, 11, 'TOTAL AH', w.num(ah, 0, 6), '', { lw: 9 });
  if (amps > 1) w.kv(20, 11, 'LIFE', w.num(ah / amps, 1, 5), 'HRS', { lw: 5, caution: ah / amps < 60 && d.mission?.id === 'apollo13' });
  w.kv(0, 12, 'MASTER ALM', d.b('LM.CW.MASTER_ALARM') ? 'ON' : 'OFF', '', { lw: 11, warn: d.b('LM.CW.MASTER_ALARM') });
}

function lmEcs(w, d) {
  w.header('LM ENVIRONMENT · TELMU', 'PG 62');
  if (!d.v.hasLM && !d.sim.lm) {
    w.at(0, 2, 'LM NOT IN CONFIGURATION', DIM);
    return;
  }
  w.kv(0, 1, 'CABIN P', w.num(d.t('LM.ECS.CABIN.P_PSI'), 2, 6), 'PSIA', { lw: 9 });
  w.kv(0, 2, 'CABIN T', w.num(d.t('LM.ECS.CABIN.T_F'), 1, 6), 'F', { lw: 9 });
  w.kv(0, 3, 'SUIT P', w.num(d.t('LM.ECS.SUIT.P_PSI'), 2, 6), 'PSIA', { lw: 9 });
  const co2 = d.t('LM.ECS.PPCO2_MMHG');
  w.kv(0, 5, 'PPCO2', w.num(co2, 1, 6), 'MMHG', { lw: 9, warn: co2 > 7.6 });
  w.bar(24, 5, co2 / 15, 15, { warn: co2 > 7.6 });
  w.kv(0, 6, 'H2O DES', w.num(pct(d.t('LM.ECS.H2O_DES_QTY')), 1, 6), '%', { lw: 9 });
  w.kv(0, 7, 'O2 DES', w.num(pct(d.t('LM.ECS.O2_DES_QTY')), 1, 6), '%', { lw: 9 });
  const adapter = d.sim.lm?.ecs?.adapterInstalled;
  w.kv(0, 9, 'LIOH', adapter ? 'CM CANISTER ADAPTER' : 'LM PRIMARY', '', { lw: 5, caution: !!adapter });
  w.kv(0, 10, 'CO2 LIGHT', d.b('LM.CW.CO2_HI') ? 'ON' : 'OFF', '', { lw: 10, warn: d.b('LM.CW.CO2_HI') });
}

function lmProp(w, d) {
  w.header('LM PROPULSION & GNC · CONTROL', 'PG 63');
  if (!d.v.hasLM && !d.sim.lm) {
    w.at(0, 2, 'LM NOT IN CONFIGURATION', DIM);
    return;
  }
  const dq = d.t('LM.DPS.FUEL_QTY');
  w.kv(0, 1, 'DPS FUEL', w.num(pct(dq), 1, 6), '%', { lw: 9, warn: dq < 0.056 });
  w.bar(22, 1, dq, 17, { warn: dq < 0.056 });
  w.kv(0, 2, 'DPS OX', w.num(pct(d.t('LM.DPS.OX_QTY')), 1, 6), '%', { lw: 9 });
  w.kv(0, 3, 'THRUST', w.num(d.t('LM.DPS.THRUST_PCT'), 1, 6), '%', { lw: 9 });
  w.kv(20, 3, 'FIRING', d.b('LM.DPS.FIRING') ? 'YES' : 'NO', '', { lw: 7, caution: d.b('LM.DPS.FIRING') });
  w.kv(0, 4, 'APS FUEL', w.num(pct(d.t('LM.APS.FUEL_QTY')), 1, 6), '%', { lw: 9 });
  w.kv(0, 5, 'RCS A/B', `${w.num(pct(d.t('LM.RCS.A.QTY')), 0, 4)} /${w.num(pct(d.t('LM.RCS.B.QTY')), 0, 4)}`, '%', { lw: 9 });
  w.kv(0, 7, 'LR ALT', w.num(d.t('LM.GNC.ALT_FT'), 0, 7), 'FT', { lw: 9 });
  w.kv(0, 8, 'ALT RATE', w.num(d.t('LM.GNC.ALTRATE_FPS'), 1, 7, true), 'FPS', { lw: 9 });
  w.kv(0, 9, 'FWD VEL', w.num(d.t('LM.GNC.XPTR_FWD_FPS'), 1, 7, true), 'FPS', { lw: 9 });
  w.kv(0, 10, 'LAT VEL', w.num(d.t('LM.GNC.XPTR_LAT_FPS'), 1, 7, true), 'FPS', { lw: 9 });
  w.kv(0, 11, 'CONTACT', d.b('LM.GNC.CONTACT_LIGHT') ? 'LIGHT' : 'OFF', '', { lw: 9, caution: d.b('LM.GNC.CONTACT_LIGHT') });
  const lgc = d.sim.gnc?.lgc?.dsky?.display;
  w.kv(0, 12, 'LGC', lgc ? `P${lgc.prog} V${lgc.verb} N${lgc.noun}` : '--', '', { lw: 4 });
  w.kv(0, 13, 'DES QTY LT', dq < 0.056 ? 'ON' : 'OFF', '', { lw: 11, warn: dq < 0.056 });
}

// ECG: P-QRS-T complex as a function of phase 0..1
function ecg(ph) {
  const gauss = (x, m, s, a) => a * Math.exp(-((x - m) ** 2) / (2 * s * s));
  return gauss(ph, 0.18, 0.025, 0.12) - gauss(ph, 0.285, 0.008, 0.12) + gauss(ph, 0.3, 0.01, 1.0) - gauss(ph, 0.318, 0.009, 0.25) + gauss(ph, 0.52, 0.045, 0.28);
}

function biomed(w, d) {
  const g = w.g;
  w.header('BIOMEDICAL · SURGEON', 'PG 71');
  const crew = d.mission?.crew ?? {};
  const names = ['CDR', 'CMP', 'LMP'];
  names.forEach((c, i) => {
    const r0 = 1 + i * 4.6;
    const hr = d.hr[c];
    const name = up((crew[c] ?? c).split(' ').slice(-1)[0]).replace(/"/g, '');
    w.at(0, r0, `${c} ${name}`.slice(0, 18), DIM);
    w.kv(19, r0, 'HR', w.num(hr, 0, 4), 'BPM', { lw: 3, caution: hr > 130 });
    w.kv(31, r0, 'RR', w.num(d.resp[c], 0, 3), '', { lw: 3 });
    // trace
    const y0 = (r0 + 2.4) * RH;
    const amp = RH * 1.3;
    g.strokeStyle = PHOSPHOR;
    g.lineWidth = 1.6;
    g.beginPath();
    const beat = hr / 60;
    const tt = d.time * 1;
    for (let x = 0; x <= VW - 8; x += 3) {
      const ts = tt - (VW - x) / 170;
      const ph = (ts * beat + i * 0.31) % 1;
      const y = y0 - ecg(ph < 0 ? ph + 1 : ph) * amp + (w.los ? 0 : 0);
      if (x === 0) g.moveTo(4 + x, y);
      else g.lineTo(4 + x, y);
    }
    if (w.los) {
      g.strokeStyle = FAINT;
    }
    g.stroke();
  });
}

function comm(w, d) {
  w.header('COMMUNICATIONS · INCO', 'PG 81');
  const sv = d.stationInView();
  const dist = d.st.r.length();
  w.kv(0, 1, 'SITE', sv.station ? sv.station.name : '---', '', { lw: 5 });
  w.kv(22, 1, 'EL', w.num(sv.el, 1, 6, true), 'DEG', { lw: 3 });
  w.kv(0, 2, 'STATUS', d.los ? 'LOS' : sv.aos ? 'AOS · 2-WAY LOCK' : 'NO STATION', '', { lw: 7, warn: !sv.aos && !d.los && d.flying });
  const dbm = sv.aos && !d.los ? -95 - 20 * Math.log10(Math.max(1, dist / 1e7)) + Math.sin(d.time * 0.7) * 1.5 : NaN;
  w.kv(0, 3, 'SIG STR', w.num(dbm, 1, 7), 'DBM', { lw: 8 });
  w.bar(22, 3, (dbm + 140) / 50, 17);
  const far = dist > 6 * R_EARTH;
  w.kv(0, 4, 'ANTENNA', far ? (d.sim.vehicle.sw.get?.('CM.COMM.HGA_PWR') === 'ON' ? 'HIGH GAIN' : 'OMNI B') : 'S-BAND OMNI', '', { lw: 8 });
  w.kv(0, 5, 'DATA RATE', far ? '51.2 KBPS HBR' : '51.2 KBPS HBR', '', { lw: 10 });
  w.kv(0, 6, 'RANGE', w.num(dist / NMI, 0, 9), 'NM', { lw: 6 });
  w.kv(0, 7, 'LIGHT TIME', w.num((dist / 299792458) * 2, 2, 6), 'S RT', { lw: 11 });
  w.kv(0, 8, 'TLM QUAL', w.num(d.quality * 100, 0, 5), '%', { lw: 9, warn: d.quality < 0.98 });
  w.kv(0, 9, 'BLACKOUT', d.st.inBlackout ? 'YES' : 'NO', '', { lw: 9, warn: d.st.inBlackout });
  w.kv(0, 10, 'BEHIND MOON', d.st.losEarth ? 'YES' : 'NO', '', { lw: 12, caution: d.st.losEarth });
  w.at(0, 12, 'VOICE  S-BAND · VHF', DIM);
}

function network(w, d) {
  w.header('MANNED SPACE FLIGHT NETWORK', 'PG 82');
  const sv = d.stationInView();
  w.at(0, 1, 'STATION         STATUS', DIM);
  MSFN.forEach((s, i) => {
    if (i > 11) return;
    const prime = sv.station?.id === s.id && sv.aos && !d.los;
    w.at(0, 2 + i, s.name.padEnd(15), prime ? PHOSPHOR : DIM);
    if (prime) w.inv(16, 2 + i, ' PRIME AOS ');
    else w.at(16, 2 + i, s.deep ? 'STBY 85FT' : 'STBY', FAINT);
  });
}

function retro(w, d) {
  w.header('ABORT & ENTRY · RETRO', 'PG 91');
  const ph = d.phase;
  const g = d.get;
  const st = d.st;
  if (ph === 'PAD' || ph === 'ASCENT') {
    let mode = 'IA';
    if (g > 42) mode = 'IB';
    if (g > 110) mode = 'IC';
    if (!d.v.parts.les || g > 197) mode = 'II';
    if (g > 562) mode = 'III';
    if (g > 600) mode = 'IV';
    w.kv(0, 1, 'ABORT MODE', ph === 'PAD' ? 'IA (PAD)' : mode, '', { lw: 11, caution: true });
    w.kv(0, 2, 'LES', d.v.parts.les ? 'ATTACHED' : 'JETTISONED', '', { lw: 11 });
    w.kv(0, 3, 'MODE IV', g > 600 ? 'CAPABLE' : 'NO', '', { lw: 11 });
    w.kv(0, 4, 'S-IVB TO ORB', g > 500 ? 'CAPABLE' : 'NO', '', { lw: 13 });
    w.at(0, 6, 'ATLANTIC RECOVERY LINE', DIM);
    w.at(0, 7, 'CONTINGENCY · DD-A / DD-B', FAINT);
  } else if (ph === 'ENTRY' || ph === 'TEC' || ph === 'SPLASHED') {
    w.kv(0, 1, 'ALT', w.num(st.alt / FT, 0, 9), 'FT', { lw: 6 });
    w.kv(0, 2, 'VI', w.num(st.speed / FT, 0, 9), 'FPS', { lw: 6 });
    w.kv(0, 3, 'G', w.num(st.gLoad, 2, 9), '', { lw: 6, caution: st.gLoad > 6 });
    const gam = st.speed > 1 ? (Math.asin(Math.max(-1, Math.min(1, st.hdot / st.speed))) * 180) / Math.PI : NaN;
    w.kv(0, 4, 'GAMMA', w.num(gam, 2, 9, true), 'DEG', { lw: 6, caution: ph !== 'SPLASHED' && st.alt < 130000 && (gam < -7.4 || gam > -5.2) });
    w.kv(0, 5, 'EI 400K', st.alt > 121920 ? 'PENDING' : 'PASSED', '', { lw: 8 });
    w.kv(0, 6, 'BLACKOUT', st.inBlackout ? 'IN' : 'OUT', '', { lw: 9, caution: st.inBlackout });
    const ship = d.mission?.id === 'apollo13' ? 'USS IWO JIMA' : d.mission?.id === 'apollo12' ? 'USS HORNET' : d.mission?.id === 'apollo8' ? 'USS YORKTOWN' : 'USS HORNET';
    w.kv(0, 8, 'PRIME SHIP', ship, '', { lw: 11 });
    w.kv(0, 9, 'TARGET', d.mission?.id === 'apollo13' ? '21.6S 165.4W' : '13.3N 169.2W', '', { lw: 7 });
    w.kv(0, 10, 'DROGUES', d.v.parts.drogues ? 'DEPLOYED' : '--', '', { lw: 8 });
    w.kv(0, 11, 'MAINS', d.v.parts.mains ? 'DEPLOYED' : '--', '', { lw: 8 });
  } else {
    w.kv(0, 1, 'PHASE', ES(d.phaseEs), '', { lw: 6 });
    w.kv(0, 2, 'HP', w.num(st.periAlt / NMI, 1, 8), 'NM', { lw: 6 });
    w.kv(0, 3, 'HA', w.num(st.apoAlt / NMI, 1, 8), 'NM', { lw: 6 });
    w.at(0, 5, 'ABORT OPTIONS', DIM);
    if (st.primary === 'MOON') {
      w.at(0, 6, ' TEI-1 SPS DIRECT RETURN');
      w.at(0, 7, ' LM DPS BACKUP · PC+2', FAINT);
    } else if (ph === 'TLC') {
      w.at(0, 6, ' DIRECT ABORT · SPS');
      w.at(0, 7, ' CIRCUMLUNAR FREE RETURN', d.mission?.id === 'apollo13' ? PHOSPHOR : FAINT);
    } else {
      w.at(0, 6, ' NEXT BEST PTP · ATLANTIC');
      w.at(0, 7, ' CONTINGENCY DEORBIT', FAINT);
    }
  }
}

function lineLog(w, d, rows, title, code) {
  w.header(title, code);
  const out = [];
  for (const r of rows.slice(-10)) {
    const head = `${d.fmtShort(r.get).slice(-8)} ${up(r.label ?? r.who ?? '').slice(0, 10)}`;
    out.push({ s: head, c: DIM });
    for (const l of w.wrap(ES(r.es ?? r.text ?? ''), COLS - 1)) out.push({ s: ` ${l}`, c: PHOSPHOR });
  }
  const vis = out.slice(-(ROWS - 2));
  vis.forEach((o, i) => w.at(0, 1 + i, o.s.slice(0, COLS), o.c));
}

function agLog(w, d) {
  lineLog(w, d, d.agLog, 'AIR-TO-GROUND · CAPCOM', 'PG 02');
}

function loopLog(w, d) {
  lineLog(w, d, d.loopLog, 'FLIGHT DIRECTOR LOOP', 'PG 03');
}

function eventsPage(w, d) {
  w.header('EVENT & ALARM LOG', 'PG 04');
  const ev = d.events.slice(-(ROWS - 2));
  if (!ev.length) w.at(0, 2, 'NO EVENTS', FAINT);
  ev.forEach((e, i) => {
    const s = `${d.fmtShort(e.get)} ${ES(e.text)}`.slice(0, COLS);
    if (e.level === 'alarm') w.at(0, 1 + i, s, '#ffffff');
    else w.at(0, 1 + i, s, e.level === 'crew' ? DIM : PHOSPHOR);
  });
}

function flightPlan(w, d) {
  w.header('FLIGHT PLAN · OBJECTIVES', 'PG 05');
  const obj = [...d.objectives.values()];
  if (!obj.length) w.at(0, 2, 'AWAITING FLIGHT PLAN UPDATE', FAINT);
  let row = 1;
  for (const o of obj.slice(-7)) {
    const mark = o.state === 'done' ? '[X]' : o.state === 'failed' ? '[!]' : '[ ]';
    const lines = w.wrap(ES(o.text), COLS - 5);
    lines.slice(0, 2).forEach((l, i) => {
      if (row > ROWS - 2) return;
      w.at(0, row, i === 0 ? mark : '   ', o.state === 'active' ? PHOSPHOR : DIM);
      w.at(4, row, l, o.state === 'active' ? PHOSPHOR : DIM);
      row++;
    });
  }
}

function pollPage(w, d) {
  w.header('GO / NO-GO STATUS BOARD', 'PG 06');
  const p = d.poll;
  if (!p) {
    w.at(0, 2, 'NO POLL IN PROGRESS', FAINT);
    let row = 4;
    for (const [c, a] of d.pollLights) {
      if (row > 13) break;
      w.at(0, row++, `${c.padEnd(12)} ${a === 'GO' ? 'GO' : 'NO GO'}`, DIM);
    }
    return;
  }
  w.at(0, 1, ES(p.title).slice(0, COLS), PHOSPHOR);
  p.consoles.forEach((c, i) => {
    const row = 3 + (i % 11);
    const col = i < 11 ? 0 : 20;
    w.at(col, row, c.console.padEnd(11), c.isPlayer ? PHOSPHOR : DIM);
    if (c.answer === 'GO') w.inv(col + 12, row, ' GO ');
    else if (c.answer === 'NOGO') w.inv(col + 12, row, 'NOGO', '#ffffff');
    else w.at(col + 12, row, w.blink ? '....' : '', DIM);
  });
}

function msgPage(w, d, consoleId) {
  w.header(`MESSAGE · ${consoleId}`, 'PG 99');
  const t = d.tasks.get(consoleId);
  if (!t) {
    w.at(0, 2, 'NO MESSAGES', FAINT);
    return;
  }
  if (w.blink) w.inv(0, 1, ' ACTION REQUIRED ');
  else w.at(0, 1, ' ACTION REQUIRED ');
  let row = 3;
  for (const l of w.wrap(ES(t.title ?? ''), COLS)) if (row < 5) w.at(0, row++, l);
  row++;
  for (const l of w.wrap(ES(t.prompt ?? ''), COLS)) if (row < 10) w.at(0, row++, l, DIM);
  row = Math.max(row + 1, 10);
  (t.options ?? []).slice(0, 4).forEach((o, i) => {
    if (row > ROWS - 2) return;
    w.at(0, row++, `${i + 1} ${ES(o.label)}`.slice(0, COLS), PHOSPHOR);
  });
}

export const PAGES = {
  FLT: { name: 'FLT SUM', draw: flightSummary },
  TRAJ: { name: 'TRAJ', draw: traj },
  PLOT: { name: 'PLOT', draw: plot },
  BOOST: { name: 'S-V', draw: booster },
  EPS: { name: 'EPS', draw: eps },
  CRYO: { name: 'CRYO', draw: cryo },
  ECS: { name: 'ECS', draw: ecs },
  GNC: { name: 'GNC', draw: gnc },
  AGC: { name: 'CMPTR', draw: agc },
  LMEPS: { name: 'LM EPS', draw: lmEps },
  LMECS: { name: 'LM ECS', draw: lmEcs },
  LMPROP: { name: 'LM PROP', draw: lmProp },
  BIO: { name: 'BIOMED', draw: biomed },
  COMM: { name: 'COMM', draw: comm },
  NET: { name: 'MSFN', draw: network },
  RETRO: { name: 'RETRO', draw: retro },
  AG: { name: 'A/G', draw: agLog },
  LOOP: { name: 'LOOP', draw: loopLog },
  EVT: { name: 'EVENTS', draw: eventsPage },
  PLAN: { name: 'PLAN', draw: flightPlan },
  POLL: { name: 'POLL', draw: pollPage },
};

/** Console → its three CRTs' default pages and the pages its display-request keyboard offers. */
export const CONSOLE_PAGES = {
  BOOSTER: { crt: ['BOOST', 'TRAJ', 'RETRO'], keys: ['BOOST', 'TRAJ', 'RETRO', 'PLOT', 'EVT', 'AG', 'POLL', 'FLT'] },
  RETRO: { crt: ['RETRO', 'TRAJ', 'PLOT'], keys: ['RETRO', 'TRAJ', 'PLOT', 'BOOST', 'EVT', 'AG', 'POLL', 'NET'] },
  FIDO: { crt: ['TRAJ', 'PLOT', 'RETRO'], keys: ['TRAJ', 'PLOT', 'RETRO', 'BOOST', 'GNC', 'EVT', 'AG', 'POLL'] },
  GUIDO: { crt: ['AGC', 'TRAJ', 'LMPROP'], keys: ['AGC', 'TRAJ', 'LMPROP', 'GNC', 'EVT', 'AG', 'POLL', 'PLOT'] },
  SURGEON: { crt: ['BIO', 'ECS', 'AG'], keys: ['BIO', 'ECS', 'LMECS', 'AG', 'EVT', 'POLL', 'FLT', 'PLAN'] },
  CAPCOM: { crt: ['AG', 'PLAN', 'FLT'], keys: ['AG', 'PLAN', 'FLT', 'LOOP', 'EVT', 'POLL', 'TRAJ', 'BIO'] },
  EECOM: { crt: ['EPS', 'CRYO', 'ECS'], keys: ['EPS', 'CRYO', 'ECS', 'COMM', 'EVT', 'AG', 'POLL', 'FLT'] },
  GNC: { crt: ['GNC', 'AGC', 'TRAJ'], keys: ['GNC', 'AGC', 'TRAJ', 'PLOT', 'EVT', 'AG', 'POLL', 'FLT'] },
  TELMU: { crt: ['LMEPS', 'LMECS', 'EVT'], keys: ['LMEPS', 'LMECS', 'LMPROP', 'EVT', 'AG', 'POLL', 'FLT', 'PLAN'] },
  CONTROL: { crt: ['LMPROP', 'AGC', 'TRAJ'], keys: ['LMPROP', 'AGC', 'TRAJ', 'LMEPS', 'EVT', 'AG', 'POLL', 'PLOT'] },
  INCO: { crt: ['COMM', 'NET', 'EVT'], keys: ['COMM', 'NET', 'EVT', 'AG', 'TRAJ', 'POLL', 'FLT', 'PLOT'] },
  PROCEDURES: { crt: ['PLAN', 'EVT', 'FLT'], keys: ['PLAN', 'EVT', 'FLT', 'AG', 'LOOP', 'POLL', 'TRAJ', 'COMM'] },
  AFD: { crt: ['FLT', 'PLAN', 'LOOP'], keys: ['FLT', 'PLAN', 'LOOP', 'EVT', 'AG', 'POLL', 'TRAJ', 'EPS'] },
  FLIGHT: { crt: ['FLT', 'POLL', 'LOOP'], keys: ['FLT', 'POLL', 'LOOP', 'AG', 'PLAN', 'EVT', 'TRAJ', 'EPS'] },
  FAO: { crt: ['PLAN', 'TRAJ', 'EVT'], keys: ['PLAN', 'TRAJ', 'EVT', 'AG', 'FLT', 'POLL', 'PLOT', 'COMM'] },
  NETWORK: { crt: ['NET', 'COMM', 'EVT'], keys: ['NET', 'COMM', 'EVT', 'AG', 'TRAJ', 'POLL', 'FLT', 'PLOT'] },
  PAO: { crt: ['AG', 'FLT', 'EVT'], keys: ['AG', 'FLT', 'EVT', 'PLAN', 'LOOP', 'POLL', 'TRAJ', 'BIO'] },
  DOD: { crt: ['RETRO', 'PLOT', 'NET'], keys: ['RETRO', 'PLOT', 'NET', 'TRAJ', 'EVT', 'AG', 'POLL', 'FLT'] },
  MISSION_DIRECTOR: { crt: ['FLT', 'PLAN', 'POLL'], keys: ['FLT', 'PLAN', 'POLL', 'AG', 'LOOP', 'EVT', 'TRAJ', 'EPS'] },
};

/**
 * Draw a CRT page into a canvas context.
 * @param {CanvasRenderingContext2D} g
 * @param {string} pageId key of PAGES, or 'MSG'
 * @param {import('../MOCRData.js').MOCRData} d
 * @param {{ w: number, h: number, t: number, hi?: boolean, console?: string }} o
 */
export function drawPage(g, pageId, d, o) {
  w.begin(g, d, { w: o.w, h: o.h, t: o.t, hi: !!o.hi });
  try {
    if (pageId === 'MSG') msgPage(w, d, o.console);
    else (PAGES[pageId] ?? PAGES.FLT).draw(w, d);
  } catch (err) {
    w.at(0, 6, 'DISPLAY FAULT', '#ffffff');
    if (!drawPage._warned) {
      drawPage._warned = true;
      console.warn('[mocr] page draw failed', pageId, err);
    }
  }
  // scanlines + vignette (cheap: a few rects)
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowBlur = 0;
  if (o.hi) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < o.h; y += 3) g.fillRect(0, y, o.w, 1);
  }
  const grd = g.createRadialGradient(o.w / 2, o.h / 2, o.h * 0.3, o.w / 2, o.h / 2, o.w * 0.72);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, o.w, o.h);
}
