// Ground "RTCC": trajectory propagation and maneuver planning (Houston computes, the crew flies).
// Same force model as FlightDynamics (Earth + Moon point masses, ECI, RK4), so planned
// trajectories are what the simulation will actually fly.
//
//   propagate(r, v, utc0, dur, opts) → { r, v, t, moon: {d, t, alt, r, v}, earth: {d, t, alt, gammaEI} }
//   planTLI(ctx) · planMCC(ctx, target) · planLOI(ctx) · planTEI(ctx) · planCircularize(ctx)
//   planApsis(ctx, km) · planDeorbit(ctx) · planDOI(ctx) · planFreeReturn(ctx) · planReturn(ctx, …)
//   coast(r, v, utc0, dt) (either direction) · entryInterfaceState(…) (back-propagation seeds)
// ctx = { r, v, get, epochUTC, mass, thrust, isp } (see contextFromSim). Planners are async
// generators of work: they yield to the event loop so the UI keeps running ("Houston computing…").
// PAD: { name, tig, dvECI: Vector3, dvTotal, burnTime, engine, ha, hp, notes, extra }

import { Vector3 } from 'three';
import { MU_EARTH, MU_MOON, R_EARTH, R_MOON, ENTRY_INTERFACE_ALT, G0, NMI, DEG } from '../../core/constants.js';
import { moonPosition, earthFixedToEci } from './ephemeris.js';

const _a = new Vector3();
const _d = new Vector3();

/** Moon ephemeris sampled on a grid for fast interpolation. */
export class MoonTable {
  constructor(utc0, durS, step = 600) {
    this.utc0 = utc0;
    this.step = step;
    this.n = Math.ceil(durS / step) + 3;
    this.p = [];
    for (let i = 0; i < this.n; i++) this.p.push(moonPosition(utc0 + (i - 1) * step * 1000));
  }

  at(t, out) {
    const f = t / this.step + 1;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(f)));
    const k = f - i;
    return out.copy(this.p[i]).multiplyScalar(1 - k).addScaledVector(this.p[i + 1], k);
  }
}

function accel(r, m, out) {
  out.copy(r).multiplyScalar(-MU_EARTH / Math.pow(r.lengthSq(), 1.5));
  _d.subVectors(r, m);
  out.addScaledVector(_d, -MU_MOON / Math.pow(_d.lengthSq(), 1.5));
  out.addScaledVector(m, -MU_MOON / Math.pow(m.lengthSq(), 1.5));
  return out;
}

const _m0 = new Vector3();
const _m1 = new Vector3();
const _mh = new Vector3();
const _k = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const _rt = new Vector3();
const _vt = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _r0 = new Vector3();
const _vv0 = new Vector3();
const _extra = new Vector3();

function rk4(r, v, t, h, table, thrustFn) {
  table.at(t, _m0);
  table.at(t + h, _m1);
  _mh.addVectors(_m0, _m1).multiplyScalar(0.5);
  _r0.copy(r);
  _vv0.copy(v);
  const ex = thrustFn ? thrustFn(t, r, v, _extra) : null;
  const add = (a) => (ex ? a.add(ex) : a);
  const a1 = add(accel(_r0, _m0, _k[0]));
  _rt.copy(_vv0).multiplyScalar(h / 2).add(_r0);
  _v2.copy(a1).multiplyScalar(h / 2).add(_vv0);
  const a2 = add(accel(_rt, _mh, _k[1]));
  _rt.copy(_v2).multiplyScalar(h / 2).add(_r0);
  _v3.copy(a2).multiplyScalar(h / 2).add(_vv0);
  const a3 = add(accel(_rt, _mh, _k[2]));
  _rt.copy(_v3).multiplyScalar(h).add(_r0);
  _v4.copy(a3).multiplyScalar(h).add(_vv0);
  const a4 = add(accel(_rt, _m1, _k[3]));
  r.addScaledVector(_vv0, h / 6).addScaledVector(_v2, h / 3).addScaledVector(_v3, h / 3).addScaledVector(_v4, h / 6);
  v.addScaledVector(a1, h / 6).addScaledVector(a2, h / 3).addScaledVector(a3, h / 3).addScaledVector(a4, h / 6);
}

/**
 * Coast (or thrust with thrustFn) for `dur` seconds from t = 0 (utc0). Tracks the closest approach
 * to the Moon and to the Earth (with the flight-path angle at the entry interface).
 * opts: { table, maxStep, stopAtEI, thrustFn, stopFn(t, r, v) → bool }
 */
export function propagate(r0, v0, utc0, dur, opts = {}) {
  const table = opts.table ?? new MoonTable(utc0, dur + 600);
  const r = r0.clone();
  const v = v0.clone();
  let t = opts.t0 ?? 0;
  const tEnd = t + dur;
  const moon = { d: Infinity, t: 0, r: new Vector3(), v: new Vector3(), alt: Infinity };
  const earth = { d: Infinity, t: 0, alt: Infinity, gammaEI: NaN, tEI: NaN };
  const m = new Vector3();
  let prevE = r.length();
  // returnOnly: measure the Earth closest approach only after the lunar encounter (return leg)
  let inSoi = false;
  let pastMoon = !opts.returnOnly;
  while (t < tEnd) {
    table.at(t, m);
    const dE = r.length();
    const dM = _a.subVectors(r, m).length();
    if (dM < moon.d) {
      moon.d = dM;
      moon.t = t;
      moon.r.copy(r);
      moon.v.copy(v);
    }
    if (!pastMoon) {
      if (dM < 6.0e7) inSoi = true;
      else if (inSoi) pastMoon = true;
    }
    if (pastMoon && dE < earth.d) {
      earth.d = dE;
      earth.t = t;
    }
    // entry interface crossing (descending)
    if (opts.stopAtEI !== false && dE < R_EARTH + ENTRY_INTERFACE_ALT && prevE >= R_EARTH + ENTRY_INTERFACE_ALT) {
      earth.gammaEI = Math.asin(Math.max(-1, Math.min(1, r.dot(v) / (dE * v.length())))) / DEG;
      earth.tEI = t;
      break;
    }
    // vacuum trajectories may dip below the surface: keep going so the closest approach (negative
    // altitude) stays a smooth function for the targeting Newton iterations
    if (dE < R_EARTH * 0.3 || dM < R_MOON * 0.3) break;
    if (opts.stopFn?.(t, r, v)) break;
    prevE = dE;
    const TE = Math.sqrt((dE * dE * dE) / MU_EARTH);
    const TM = Math.sqrt((dM * dM * dM) / MU_MOON);
    let h = Math.min(opts.maxStep ?? 600, 0.012 * TE, 0.012 * TM);
    if (opts.thrustFn) h = Math.min(h, 2);
    h = Math.max(0.5, Math.min(h, tEnd - t));
    rk4(r, v, t, h, table, opts.thrustFn);
    t += h;
  }
  moon.alt = moon.d - R_MOON;
  earth.alt = earth.d - R_EARTH;
  return { r, v, t, moon, earth, table };
}

// ------------------------------------------------------------------ helpers

export function contextFromSim(sim) {
  const v = sim.vehicle;
  const st = v.state;
  const lm = v.station === 'LM';
  const sat = v.modules.saturn && v.isAttached('saturn') ? v.modules.saturn : null;
  return {
    r: st.r.clone(),
    v: st.v.clone(),
    get: sim.clock.get,
    epochUTC: sim.clock.epochUTC,
    mass: st.mass > 1000 ? st.mass : sim.dyn._massProps().mass,
    primary: st.primary,
    // engine for SPS / DPS / APS / S-IVB
    engine: sat ? 'SIVB' : lm ? (v.config === 'LM_ASC' ? 'APS' : 'DPS') : 'SPS',
    thrust: sat ? 1.0e6 : lm ? (v.config === 'LM_ASC' ? 15570 : 45040 * 0.925) : 91190,
    propKg: sat ? sat.sivbProp : lm ? (v.config === 'LM_ASC' ? v.modules.lm.apsProp : v.modules.lm.dpsProp) : v.modules.csm?.spsProp ?? 0,
    isp: sat ? 421 : lm ? (v.config === 'LM_ASC' ? 311 : 305) : 314,
  };
}

function burnTime(ctx, dv) {
  const mdot = ctx.thrust / (ctx.isp * G0);
  const mf = ctx.mass * Math.exp(-Math.abs(dv) / (ctx.isp * G0));
  return (ctx.mass - mf) / mdot;
}

function orbitAbout(r, v, center, centerV, mu) {
  const rr = r.clone().sub(center);
  const vv = v.clone().sub(centerV);
  const R = rr.length();
  const E = vv.lengthSq() / 2 - mu / R;
  const h = new Vector3().crossVectors(rr, vv);
  if (E >= 0) return { a: Infinity, e: 1, rr, vv, h };
  const a = -mu / (2 * E);
  const e = Math.sqrt(Math.max(0, 1 - h.lengthSq() / (mu * a)));
  return { a, e, ra: a * (1 + e), rp: a * (1 - e), rr, vv, h, T: 2 * Math.PI * Math.sqrt((a * a * a) / mu) };
}

function primaryOf(ctx, table) {
  const m = table.at(0, new Vector3());
  const moonDist = ctx.r.clone().sub(m).length();
  return moonDist < 6.6e7 ? 'MOON' : 'EARTH';
}

function moonVelAt(table, t, out = new Vector3()) {
  const a = table.at(t - 30, new Vector3());
  const b = table.at(t + 30, new Vector3());
  return out.subVectors(b, a).multiplyScalar(1 / 60);
}

/** Next time (s from now) when the radius about the primary reaches an extremum (apo/peri). */
function nextApsis(ctx, which, table, primary) {
  const r = ctx.r.clone();
  const v = ctx.v.clone();
  const m = new Vector3();
  const mv = new Vector3();
  let prevRdot = null;
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    table.at(t, m);
    const c = primary === 'MOON' ? m : new Vector3();
    const cv = primary === 'MOON' ? moonVelAt(table, t, mv) : new Vector3();
    const rr = r.clone().sub(c);
    const rdot = rr.dot(v.clone().sub(cv));
    if (prevRdot !== null && t > 60) {
      if (which === 'apo' && prevRdot > 0 && rdot <= 0) return { t, r: r.clone(), v: v.clone(), center: c.clone(), centerV: cv.clone() };
      if (which === 'peri' && prevRdot < 0 && rdot >= 0) return { t, r: r.clone(), v: v.clone(), center: c.clone(), centerV: cv.clone() };
    }
    prevRdot = rdot;
    rk4(r, v, t, 10, table, null);
    t += 10;
  }
  return null;
}

const yieldUI = () => new Promise((res) => setTimeout(res, 0));

function pad(ctx, name, t, dvVec, engine, extra = {}) {
  const dvTotal = dvVec.length();
  const bt = burnTime(ctx, dvTotal);
  return {
    name,
    tig: ctx.get + t - bt / 2,
    dvECI: dvVec.clone(),
    dvTotal,
    burnTime: bt,
    engine,
    ...extra,
  };
}

// ------------------------------------------------------------------ TLI (S-IVB restart)

const TB6 = 578;

function simulateTLI(ctx, table, tig, c3) {
  // coast to ignition, then finite J-2 burn prograde (slight pitch-down, like the IU) to the C3 target
  const c = propagate(ctx.r, ctx.v, ctx.epochUTC + ctx.get * 1000, tig, { table, stopAtEI: false });
  let mass = ctx.mass;
  const mdot = ctx.thrust / (ctx.isp * G0);
  const up = new Vector3();
  let t0 = tig;
  const r = c.r;
  const v = c.v;
  const thrustFn = (t, rr, vv, out) => {
    up.copy(rr).normalize();
    out.copy(vv).normalize().addScaledVector(up, -0.05).normalize().multiplyScalar(ctx.thrust / mass);
    return out;
  };
  let used = 0;
  for (let i = 0; i < 4000; i++) {
    const e = v.lengthSq() - (2 * MU_EARTH) / r.length();
    if (e >= c3 || used >= (ctx.propKg ?? Infinity)) break;
    // fine steps near cutoff so the planned energy matches the IU's exact cutoff
    const rate = 2 * v.length() * (ctx.thrust / mass);
    const h = c3 - e < rate * 1.5 ? 0.05 : 1;
    rk4(r, v, t0, h, table, thrustFn);
    mass -= mdot * h;
    used += mdot * h;
    t0 += h;
  }
  return { r, v, t: t0, burn: t0 - tig, mass, short: used >= (ctx.propKg ?? Infinity) };
}

/** Evaluate a TLI (ignition at t s from now, cutoff energy c3): closest approach to the Moon. */
function evalTLI(ctx, table, tig, c3) {
  const b = simulateTLI(ctx, table, tig, c3);
  const p = propagate(b.r, b.v, 0, 5.5 * 86400, { table, t0: b.t, stopAtEI: false });
  return { ...p.moon, cut: b };
}

export async function planTLI(ctx, { periluneKm = 150, flightHours = 73, revs = 1.0, onProgress } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 7.5 * 86400, 900);
  const orbit = orbitAbout(ctx.r, ctx.v, new Vector3(), new Vector3(), MU_EARTH);
  const period = orbit.T ?? 5300;
  const target = R_MOON + periluneKm * 1000;
  let best = null;
  let n = 0;
  // perilune miss (m) + flight-time miss (25 m per s: Apollo flew ~73 h from TLI to the Moon)
  const flightS = flightHours ? flightHours * 3600 : 0;
  const score = (e) => Math.abs(e.d - target) + (flightS ? 25 * Math.abs(e.t - e.cut.t - flightS) : 0);
  const f = (e) => score(e);
  for (let tig = TB6 + 30; tig < TB6 + 30 + period * revs; tig += 40) {
    for (const c3 of [-1.68e6, -1.6e6, -1.53e6, -1.47e6, -1.42e6, -1.37e6]) {
      const e = evalTLI(ctx, table, tig, c3);
      if (!best || f(e) < f(best)) best = { ...e, tig, c3 };
      if (++n % 24 === 0) {
        onProgress?.(n / 1300);
        await yieldUI();
      }
    }
  }
  // refine: alternate golden-section searches on C3 and ignition time
  const golden = async (lo, hi, fn) => {
    const g = 0.618;
    let a = lo;
    let b = hi;
    let x1 = b - g * (b - a);
    let x2 = a + g * (b - a);
    let f1 = fn(x1);
    let f2 = fn(x2);
    for (let i = 0; i < 16; i++) {
      if (f1 < f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - g * (b - a);
        f1 = fn(x1);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + g * (b - a);
        f2 = fn(x2);
      }
      if (i % 4 === 3) await yieldUI();
    }
    return (a + b) / 2;
  };
  for (let round = 0; round < 3; round++) {
    const span = round === 0 ? 1.4e5 : 4e4;
    best.c3 = await golden(best.c3 - span, best.c3 + span, (c3) => f(evalTLI(ctx, table, best.tig, c3)));
    const tspan = round === 0 ? 150 : 40;
    best.tig = await golden(Math.max(TB6 + 5, best.tig - tspan), best.tig + tspan, (tig) => f(evalTLI(ctx, table, tig, best.c3)));
    onProgress?.(0.8 + round * 0.06);
  }
  const fin = evalTLI(ctx, table, best.tig, best.c3);
  return {
    name: 'TLI',
    engine: 'SIVB',
    tig: ctx.get + best.tig,
    tb6: ctx.get + best.tig - TB6,
    c3: best.c3,
    burnTime: fin.cut.burn,
    dvTotal: fin.cut.v.length() - ctx.v.length(),
    perilune: fin.d - R_MOON,
    arrivalGET: ctx.get + fin.t,
    notes: `Perilunio previsto ${(Math.max(0, fin.d - R_MOON) / NMI).toFixed(0)} nmi a GET ${fmtGET(ctx.get + fin.t)}`,
  };
}

// ------------------------------------------------------------------ midcourse corrections

/** Impulsive ΔV (ECI) at now+lead that drives f(state) to 0, minimum norm (Newton). */
async function solveImpulse(ctx, table, lead, fn, { iters = 6, guess = new Vector3() } = {}) {
  const c = propagate(ctx.r, ctx.v, 0, lead, { table, stopAtEI: false });
  const r0 = c.r.clone();
  const v0 = c.v.clone();
  const dv = guess.clone();
  const evalF = (d) => fn(r0, v0.clone().add(d), lead);
  let fv = evalF(dv);
  for (let i = 0; i < iters && Math.abs(fv) > 1e-3; i++) {
    const J = new Vector3();
    const eps = 0.5;
    for (const ax of ['x', 'y', 'z']) {
      const d2 = dv.clone();
      d2[ax] += eps;
      J[ax] = (evalF(d2) - fv) / eps;
    }
    const jj = J.lengthSq();
    if (jj < 1e-12) break;
    dv.addScaledVector(J, -fv / jj);
    if (dv.length() > 600) dv.setLength(600);
    fv = evalF(dv);
    await yieldUI();
  }
  return { dv, f: fv, r0, v0 };
}

export async function planMCC(ctx, { periluneKm = 110, entryGamma = -6.5 } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 6 * 86400, 900);
  const lead = 600;
  const toMoon = propagate(ctx.r, ctx.v, 0, 4 * 86400, { table, stopAtEI: false });
  const outbound = toMoon.moon.d < 3e7 && toMoon.moon.t > 0;
  if (outbound) {
    const target = (periluneKm * 1000 + R_MOON) / 1e6;
    const res = await solveImpulse(ctx, table, lead, (r, v, t0) => propagate(r, v, 0, 4.5 * 86400, { table, t0, stopAtEI: false }).moon.d / 1e6 - target);
    const after = propagate(res.r0, res.v0.clone().add(res.dv), 0, 4.5 * 86400, { table, t0: lead, stopAtEI: false });
    return pad(ctx, 'MCC', lead, res.dv, ctx.engine, { notes: `Corrección translunar: perilunio ${(after.moon.alt / NMI).toFixed(0)} nmi`, perilune: after.moon.alt });
  }
  // vacuum perigee ≈ 37 km ↔ entry flight-path angle ≈ −6.5° for a lunar return (continuous target)
  const perigeeTarget = 37000 + (entryGamma + 6.5) * 9000;
  const res = await solveImpulse(ctx, table, lead, (r, v, t0) => (propagate(r, v, 0, 4.5 * 86400, { table, t0, stopAtEI: false }).earth.alt - perigeeTarget) / 1e6, { iters: 10 });
  const after = propagate(res.r0, res.v0.clone().add(res.dv), 0, 4.5 * 86400, { table, t0: lead });
  return pad(ctx, 'MCC', lead, res.dv, ctx.engine, { notes: `Corrección transterrestre: ángulo de reentrada ${Number.isFinite(after.earth.gammaEI) ? after.earth.gammaEI.toFixed(2) + '°' : '—'}`, gammaEI: after.earth.gammaEI });
}

// ------------------------------------------------------------------ lunar orbit insertion / circularize / apsis

export async function planLOI(ctx, { apoKm = 315, periKm = null } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 4 * 86400, 600);
  const p = propagate(ctx.r, ctx.v, 0, 4 * 86400, { table, stopAtEI: false });
  if (p.moon.d > 2e7) return null;
  await yieldUI();
  const t = p.moon.t;
  const mv = moonVelAt(table, t);
  const vrel = p.moon.v.clone().sub(mv);
  const rp = periKm ? R_MOON + periKm * 1000 : p.moon.d;
  const ra = Math.max(rp, R_MOON + apoKm * 1000);
  const vNeed = Math.sqrt(MU_MOON * (2 / p.moon.d - 2 / (p.moon.d + ra)));
  const dv = vrel.clone().normalize().multiplyScalar(vNeed - vrel.length());
  // the burn lasts minutes: re-target it with a simulation of exactly that burn (constant LVLH
  // direction, like the CMC flies it), solving start time, retro and radial components by Newton
  const m0 = dv.length();
  const bt = burnTime(ctx, m0);
  const orbitAfter = (x) => {
    const tStart = x.x * 10;
    const u = new Vector3(-x.y, x.z, 0);
    const b = simulateFiniteBurn(ctx, table, tStart, u, 'MOON');
    const o = orbitAbout(b.r, b.v, table.at(b.t, new Vector3()), moonVelAt(table, b.t), MU_MOON);
    return o;
  };
  const fn = (x) => {
    const o = orbitAfter(x);
    if (!Number.isFinite(o.ra)) return [(o.rp - rp) / 1e5, 1];
    return [(o.rp - rp) / 1e5, (o.ra - ra) / 1e6];
  };
  const res = await newtonN(fn, new Vector3((t - bt / 2) / 10, m0, 0), { iters: 12, eps: 0.5, tol: 2e-4, maxStep: 40 });
  const x = res.dv;
  const u = new Vector3(-x.y, x.z, 0);
  const mag = u.length();
  const fin = orbitAfter(x);
  const tStart = x.x * 10;
  return {
    name: 'LOI',
    engine: ctx.engine,
    tig: ctx.get + tStart,
    dvECI: dv.clone().setLength(mag),
    dvTotal: mag,
    burnTime: burnTime(ctx, mag),
    steer: 'lvlh',
    lvlh: { v: u.x / mag, r: u.y / mag, h: 0 },
    ha: Number.isFinite(fin.ra) ? (fin.ra - R_MOON) / NMI : NaN,
    hp: (fin.rp - R_MOON) / NMI,
    notes: `Inserción en órbita lunar detrás de la Luna (sin señal con Houston): ${Number.isFinite(fin.ra) ? ((fin.ra - R_MOON) / NMI).toFixed(0) : '—'} × ${((fin.rp - R_MOON) / NMI).toFixed(0)} nmi`,
  };
}

export async function planCircularize(ctx) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 2 * 86400, 600);
  const prim = primaryOf(ctx, table);
  const ap = nextApsis(ctx, 'apo', table, prim);
  if (!ap) return null;
  await yieldUI();
  const mu = prim === 'MOON' ? MU_MOON : MU_EARTH;
  const rr = ap.r.clone().sub(ap.center);
  const vv = ap.v.clone().sub(ap.centerV);
  const h = new Vector3().crossVectors(rr, vv).normalize();
  const dir = new Vector3().crossVectors(h, rr).normalize();
  const vNeed = dir.multiplyScalar(Math.sqrt(mu / rr.length()));
  const dv = vNeed.sub(vv);
  const R0 = prim === 'MOON' ? R_MOON : R_EARTH;
  return pad(ctx, 'CIRC', ap.t, dv, ctx.engine, { steer: dv.dot(vv) >= 0 ? 'pro' : 'retro', ha: (rr.length() - R0) / NMI, hp: (rr.length() - R0) / NMI, notes: `Circularizar a ${((rr.length() - R0) / 1000).toFixed(0)} km` });
}

/** Burn at the next periapsis to set the apoapsis altitude (km). */
export async function planApsis(ctx, apoKm) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 2 * 86400, 600);
  const prim = primaryOf(ctx, table);
  const pe = nextApsis(ctx, 'peri', table, prim);
  if (!pe) return null;
  await yieldUI();
  const mu = prim === 'MOON' ? MU_MOON : MU_EARTH;
  const R0 = prim === 'MOON' ? R_MOON : R_EARTH;
  const rr = pe.r.clone().sub(pe.center);
  const vv = pe.v.clone().sub(pe.centerV);
  const rp = rr.length();
  const ra = R0 + apoKm * 1000;
  const vNeed = Math.sqrt(mu * (2 / rp - 2 / (rp + ra)));
  const dv = vv.clone().normalize().multiplyScalar(vNeed - vv.length());
  return pad(ctx, 'APSIS', pe.t, dv, ctx.engine, { steer: vNeed >= vv.length() ? 'pro' : 'retro', ha: apoKm / 1.852, hp: (rp - R0) / NMI, notes: `Nuevo ${prim === 'MOON' ? 'apolunio' : 'apogeo'}: ${apoKm.toFixed(0)} km` });
}

/** Descent Orbit Insertion: lower the perilune to 50,000 ft half an orbit later. */
export async function planDOI(ctx, periKm = 15.2) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 86400, 600);
  const t = 300;
  const c = propagate(ctx.r, ctx.v, 0, t, { table, stopAtEI: false });
  await yieldUI();
  const m = table.at(t, new Vector3());
  const mv = moonVelAt(table, t);
  const rr = c.r.clone().sub(m);
  const vv = c.v.clone().sub(mv);
  const ra = rr.length();
  const rp = R_MOON + periKm * 1000;
  const vNeed = Math.sqrt(MU_MOON * (2 / ra - 2 / (ra + rp)));
  const dv = vv.clone().normalize().multiplyScalar(vNeed - vv.length());
  return pad(ctx, 'DOI', t, dv, ctx.engine, { steer: 'retro', ha: (ra - R_MOON) / NMI, hp: periKm / 1.852, notes: 'Perilunio a 50.000 pies ~media órbita después (inicio del descenso)' });
}

// ------------------------------------------------------------------ TEI

export async function planTEI(ctx, { entryGamma = -6.5, eiGET = null, returnHours = 60, minLead = 300, onProgress } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 5 * 86400, 900);
  const orbit = orbitAbout(ctx.r, ctx.v, table.at(0, new Vector3()), moonVelAt(table, 0), MU_MOON);
  const period = Number.isFinite(orbit.T) ? orbit.T : 7200;
  const coastTo = (t) => propagate(ctx.r, ctx.v, 0, t, { table, stopAtEI: false });
  const perigeeTarget = perigeeFor(entryGamma);
  const vacuum = (rr, vv, t) => propagate(rr, vv, 0, 4.5 * 86400, { table, t0: t, stopAtEI: false });
  // time of the Earth closest approach we aim for (Apollo: ~60 h from TEI to entry)
  const tTarget = (t) => (eiGET !== null ? eiGET - ctx.get : t + returnHours * 3600);
  // 1) coarse scan: for each prograde ΔV the ignition time with the lowest perigee; then the ΔV
  //    whose return time is closest to the target among the near-corridor candidates
  const perDv = new Map();
  let n = 0;
  for (let t = minLead; t < minLead + period; t += 60) {
    const c = coastTo(t);
    const dir = c.v.clone().sub(moonVelAt(table, t)).normalize();
    for (let dvMag = 800; dvMag <= 1300; dvMag += 50) {
      const p = vacuum(c.r, c.v.clone().addScaledVector(dir, dvMag), t);
      const miss = Math.abs(p.earth.alt - perigeeTarget);
      const cur = perDv.get(dvMag);
      if (!cur || miss < cur.miss) perDv.set(dvMag, { miss, t, tp: p.earth.t, dv: dir.clone().multiplyScalar(dvMag), r: c.r.clone(), v: c.v.clone() });
    }
    if (++n % 6 === 0) {
      onProgress?.(0.5 * ((t - minLead) / period));
      await yieldUI();
    }
  }
  const cands = [...perDv.values()];
  const near = cands.filter((c) => c.miss < 40e6);
  const pool = near.length ? near : cands;
  let best = pool.reduce((a, c) => {
    const sc = (x) => Math.abs(x.tp - tTarget(x.t)) / 3600 + x.miss / 4e6;
    return !a || sc(c) < sc(a) ? c : a;
  }, null);
  best = { ...best };
  const T = tTarget(best.t);
  // 2) impulsive Newton (minimum-norm 3-D ΔV, adds the out-of-plane part): perigee first, then
  //    perigee + arrival time when that converges
  const fPer = (dv) => [(vacuum(best.r, best.v.clone().add(dv), best.t).earth.alt - perigeeTarget) / 1e6];
  const fBoth = (dv) => {
    const p = vacuum(best.r, best.v.clone().add(dv), best.t);
    return [(p.earth.alt - perigeeTarget) / 1e6, (p.earth.t - T) / 2e5];
  };
  const a = await newtonN(fPer, best.dv, { iters: 16, eps: 0.5, maxStep: 120 });
  best.dv.copy(a.dv);
  let useTime = false;
  const b2 = await newtonN(fBoth, best.dv, { iters: 12, eps: 0.5, maxStep: 80 });
  if (Math.abs(b2.f[0]) < 0.01 && Math.abs(b2.f[1]) < 0.1) {
    best.dv.copy(b2.dv);
    useTime = true;
  }
  onProgress?.(0.7);
  // 3) the burn is finite (minutes) and flown in the local orbital frame: re-target with a
  //    simulation of exactly that burn, varying the LVLH ΔV vector u (m/s)
  const mvc = moonVelAt(table, best.t);
  const rc = best.r.clone().sub(table.at(best.t, new Vector3()));
  const l0 = lvlhOf(best.dv, rc, best.v.clone().sub(mvc));
  const u0 = new Vector3(l0.v, l0.r, l0.h).multiplyScalar(best.dv.length());
  const tStart = best.t - burnTime(ctx, u0.length()) / 2;
  // the arrival time is already right from the impulsive solution: trim only the perigee here
  const fFin = (uu) => {
    const b = simulateFiniteBurn(ctx, table, tStart, uu, 'MOON');
    return [(vacuum(b.r, b.v, b.t).earth.alt - perigeeTarget) / 1e6];
  };
  const fin = await newtonN(fFin, u0, { iters: 16, eps: 0.1, tol: 2e-4, maxStep: 30 });
  const u = fin.dv;
  onProgress?.(1);
  const b = simulateFiniteBurn(ctx, table, tStart, u, 'MOON');
  const ret = propagate(b.r, b.v, 0, 4.5 * 86400, { table, t0: b.t });
  const m = u.length();
  return {
    name: 'TEI',
    engine: ctx.engine,
    tig: ctx.get + tStart,
    dvECI: best.dv.clone().setLength(m),
    dvTotal: m,
    burnTime: burnTime(ctx, m),
    steer: 'lvlh',
    lvlh: { v: u.x / m, r: u.y / m, h: u.z / m },
    notes: Number.isFinite(ret.earth.gammaEI) ? `Reentrada a GET ${fmtGET(ctx.get + ret.earth.tEI)} con γ ${ret.earth.gammaEI.toFixed(2)}°` : `Perigeo ${(ret.earth.alt / 1000).toFixed(0)} km: hará falta una corrección`,
    gammaEI: ret.earth.gammaEI,
    tEI: Number.isFinite(ret.earth.tEI) ? ctx.get + ret.earth.tEI : NaN,
  };
}

/** Simulate a finite burn flown with constant LVLH components u (m/s total) about `primary`. */
function simulateFiniteBurn(ctx, table, tStart, u, primary = 'MOON') {
  const c = propagate(ctx.r, ctx.v, 0, tStart, { table, stopAtEI: false });
  const r = c.r;
  const v = c.v;
  let mass = ctx.mass;
  const mdot = ctx.thrust / (ctx.isp * G0);
  const dvMag = u.length();
  const dir = u.clone().normalize();
  let gained = 0;
  let t = tStart;
  const m = new Vector3();
  const mv = new Vector3();
  const ev = new Vector3();
  const eh = new Vector3();
  const er = new Vector3();
  const thrustFn = (tt, rr, vv, out) => {
    if (primary === 'MOON') {
      table.at(tt, m);
      moonVelAt(table, tt, mv);
    } else {
      m.set(0, 0, 0);
      mv.set(0, 0, 0);
    }
    const rRel = _d.subVectors(rr, m);
    ev.copy(vv).sub(mv).normalize();
    eh.crossVectors(rRel, ev).normalize();
    er.crossVectors(ev, eh).negate().normalize();
    return out.copy(ev).multiplyScalar(dir.x).addScaledVector(er, dir.y).addScaledVector(eh, dir.z).normalize().multiplyScalar(ctx.thrust / mass);
  };
  while (gained < dvMag) {
    const a = ctx.thrust / mass;
    const h = Math.min(1, (dvMag - gained) / a);
    rk4(r, v, t, h, table, thrustFn);
    mass -= mdot * h;
    gained += a * h;
    t += h;
    if (h < 1e-3) break;
  }
  return { r, v, t };
}

/** Components of a ΔV in the local orbital frame (along v, along r, along r × v). */
export function lvlhOf(dv, rRel, vRel) {
  const ev = vRel.clone().normalize();
  const eh = new Vector3().crossVectors(rRel, vRel).normalize();
  const er = new Vector3().crossVectors(ev, eh).negate().normalize();
  const m = dv.length() || 1;
  return { v: dv.dot(ev) / m, r: dv.dot(er) / m, h: dv.dot(eh) / m };
}

// ------------------------------------------------------------------ deorbit

export async function planDeorbit(ctx, { lead = 900, perigeeKm = 20 } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 86400, 600);
  const c = propagate(ctx.r, ctx.v, 0, lead, { table, stopAtEI: false });
  await yieldUI();
  const R = c.r.length();
  const ra = R;
  const rp = R_EARTH + perigeeKm * 1000;
  const vNeed = Math.sqrt(MU_EARTH * (2 / ra - 2 / (ra + rp)));
  const dv = c.v.clone().normalize().multiplyScalar(vNeed - c.v.length());
  return pad(ctx, 'DEORBIT', lead, dv, ctx.engine, { steer: 'retro', ha: (R - R_EARTH) / NMI, hp: perigeeKm / 1.852, notes: 'Desorbitado: perigeo dentro de la atmósfera' });
}

// ------------------------------------------------------------------ coasting both ways / return targeting

/** Coast dt seconds (negative = backwards in time) from utc0. Returns new { r, v }. */
export function coast(r0, v0, utc0, dt, { table = null } = {}) {
  const back = dt < 0;
  const dur = Math.abs(dt);
  const tab = table ?? new MoonTable(utc0 + (back ? dt * 1000 : 0), dur + 1200, 600);
  const r = r0.clone();
  const v = v0.clone();
  // table time origin is the earliest instant
  let t = back ? dur : 0;
  const tEnd = back ? 0 : dur;
  const m = new Vector3();
  while (back ? t > tEnd : t < tEnd) {
    tab.at(t, m);
    const dE = r.length();
    const dM = _a.subVectors(r, m).length();
    const TE = Math.sqrt((dE * dE * dE) / MU_EARTH);
    const TM = Math.sqrt((dM * dM * dM) / MU_MOON);
    let h = Math.max(0.5, Math.min(600, 0.01 * TE, 0.01 * TM, Math.abs(tEnd - t)));
    if (back) h = -h;
    rk4(r, v, t, h, tab, null);
    t += h;
  }
  return { r, v };
}

/** Inertial state at the entry interface (400,000 ft) over a geographic point, for back-propagation.
 *  azimuthDeg: inertial heading (0 = north, 90 = east); gammaDeg < 0 descending. */
export function entryInterfaceState({ epochUTC, getEI, latDeg, lonDeg, azimuthDeg = 65, gammaDeg = -6.5, speed = 11030 }) {
  const utc = epochUTC + getEI * 1000;
  const r = earthFixedToEci(latDeg * DEG, lonDeg * DEG, ENTRY_INTERFACE_ALT, utc, new Vector3());
  const up = r.clone().normalize();
  const east = new Vector3(-up.y, up.x, 0).normalize();
  const north = new Vector3().crossVectors(up, east);
  const az = azimuthDeg * DEG;
  const hor = north.multiplyScalar(Math.cos(az)).addScaledVector(east, Math.sin(az));
  const g = gammaDeg * DEG;
  const v = hor.multiplyScalar(Math.cos(g)).addScaledVector(up, Math.sin(g)).multiplyScalar(speed);
  return { r, v, utc };
}

/** Minimum-norm Newton on a vector target f(dv) → number[] (k ≤ 3 constraints). */
async function newtonN(fn, dv0, { iters = 8, eps = 0.5, tol = 1e-4, maxStep = 150 } = {}) {
  const dv = dv0.clone();
  let f = fn(dv);
  const k = f.length;
  for (let i = 0; i < iters && Math.max(...f.map(Math.abs)) > tol; i++) {
    // Jacobian rows (k × 3)
    const J = [];
    for (let a = 0; a < k; a++) J.push(new Vector3());
    for (const ax of ['x', 'y', 'z']) {
      const d2 = dv.clone();
      d2[ax] += eps;
      const f2 = fn(d2);
      for (let a = 0; a < k; a++) J[a][ax] = (f2[a] - f[a]) / eps;
    }
    // step = −Jᵀ (J Jᵀ)⁻¹ f
    let step;
    if (k === 1) {
      const jj = J[0].lengthSq();
      if (jj < 1e-14) break;
      step = J[0].clone().multiplyScalar(-f[0] / jj);
    } else {
      const a11 = J[0].dot(J[0]);
      const a12 = J[0].dot(J[1]);
      const a22 = J[1].dot(J[1]);
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-18) break;
      const y1 = (a22 * f[0] - a12 * f[1]) / det;
      const y2 = (-a12 * f[0] + a11 * f[1]) / det;
      step = J[0].clone().multiplyScalar(-y1).addScaledVector(J[1], -y2);
    }
    if (!Number.isFinite(step.x + step.y + step.z)) break;
    if (step.length() > maxStep) step.setLength(maxStep);
    // backtracking: never accept a step that makes the residual worse
    const norm = (ff) => Math.hypot(...ff);
    let trial = dv.clone().add(step);
    let ft = fn(trial);
    for (let k = 0; k < 4 && !(norm(ft) < norm(f)); k++) {
      step.multiplyScalar(0.4);
      trial = dv.clone().add(step);
      ft = fn(trial);
    }
    if (!(norm(ft) < norm(f))) break;
    dv.copy(trial);
    f = ft;
    await yieldUI();
  }
  return { dv, f };
}

const perigeeFor = (gammaDeg) => 37000 + (gammaDeg + 6.5) * 9000;

/** Return the spacecraft to a free-return trajectory (Apollo 13, GET 61:29): after the lunar flyby
 *  the vacuum perigee lands in the entry corridor. Impulsive at now + lead. */
export async function planFreeReturn(ctx, { lead = 600, entryGamma = -6.5 } = {}) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 7 * 86400, 900);
  const c = propagate(ctx.r, ctx.v, 0, lead, { table, stopAtEI: false });
  const r0 = c.r.clone();
  const v0 = c.v.clone();
  const target = perigeeFor(entryGamma);
  // perigee after the lunar flyby (ignore the departure leg: start measuring past the Moon)
  const returnPerigee = (vv) => propagate(r0, vv, 0, 6.5 * 86400, { table, t0: lead, stopAtEI: false, returnOnly: true });
  // vacuum trajectories may pass "through" the Moon: keep the flyby above 100 km (continuous penalty)
  const fn = (dv) => {
    const p = returnPerigee(v0.clone().add(dv));
    const moonPen = p.moon.alt < 100e3 ? (100e3 - p.moon.alt) / 2e4 : 0;
    return [Number.isFinite(p.earth.alt) ? (p.earth.alt - target) / 1e6 + Math.sign(p.earth.alt - target || 1) * moonPen : 10];
  };
  // coarse scan in the local frame (along-track × out-of-plane, then radial) for the lowest return
  // perigee: the return leg is only smooth near the corridor
  const ev = v0.clone().normalize();
  const eh = new Vector3().crossVectors(r0, v0).normalize();
  const er = new Vector3().crossVectors(ev, eh).negate().normalize();
  let best = { dv: new Vector3(), s: Math.abs(fn(new Vector3())[0]) };
  for (const span of [40, 12]) {
    const c0 = best.dv.clone();
    for (let a = -span; a <= span + 1e-9; a += span / 6) {
      for (let b = -span; b <= span + 1e-9; b += span / 6) {
        for (const c of span > 20 ? [0] : [-span / 3, 0, span / 3]) {
          const dv = c0.clone().addScaledVector(ev, a).addScaledVector(eh, b).addScaledVector(er, c);
          const sc = Math.abs(fn(dv)[0]);
          if (sc < best.s) best = { dv, s: sc };
        }
      }
      await yieldUI();
    }
  }
  const res = await newtonN(fn, best.dv, { iters: 12, eps: 0.2, maxStep: 15 });
  const after = propagate(r0, v0.clone().add(res.dv), 0, 6.5 * 86400, { table, t0: lead });
  return pad(ctx, 'RETORNO LIBRE', lead, res.dv, ctx.engine, {
    notes: Number.isFinite(after.earth.gammaEI) ? `Retorno libre: reentrada a GET ${fmtGET(ctx.get + after.earth.tEI)} con γ ${after.earth.gammaEI.toFixed(2)}°` : 'Retorno libre aproximado',
    gammaEI: after.earth.gammaEI,
    tEI: Number.isFinite(after.earth.tEI) ? ctx.get + after.earth.tEI : NaN,
  });
}

/** Earth-return burn with a fixed ignition time: entry flight-path angle and time of entry
 *  (Apollo 13 PC+2: "speed up the return"). tigGET / eiGET are mission GETs. */
export async function planReturn(ctx, { tigGET, eiGET, entryGamma = -6.5, name = 'PC+2' }) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 7 * 86400, 900);
  const lead = Math.max(60, tigGET - ctx.get);
  const c = propagate(ctx.r, ctx.v, 0, lead, { table, stopAtEI: false });
  const r0 = c.r.clone();
  const v0 = c.v.clone();
  const target = perigeeFor(entryGamma);
  const tTarget = eiGET - ctx.get;
  const fn = (dv) => {
    const p = propagate(r0, v0.clone().add(dv), 0, 6.5 * 86400, { table, t0: lead, stopAtEI: false, returnOnly: true });
    return [(p.earth.alt - target) / 1e6, (p.earth.t - tTarget) / 2e5];
  };
  // start along the velocity (the burn mostly speeds the spacecraft up)
  const mv = moonVelAt(table, lead);
  const guess = v0.clone().sub(mv).normalize().multiplyScalar(150);
  const res = await newtonN(fn, guess, { iters: 14, eps: 0.5, maxStep: 120 });
  const after = propagate(r0, v0.clone().add(res.dv), 0, 6.5 * 86400, { table, t0: lead });
  const bt = burnTime(ctx, res.dv.length());
  return {
    ...pad(ctx, name, lead + bt / 2, res.dv, ctx.engine),
    notes: Number.isFinite(after.earth.gammaEI) ? `Reentrada a GET ${fmtGET(ctx.get + after.earth.tEI)} con γ ${after.earth.gammaEI.toFixed(2)}°` : 'Trayectoria de regreso aproximada',
    gammaEI: after.earth.gammaEI,
    tEI: Number.isFinite(after.earth.tEI) ? ctx.get + after.earth.tEI : NaN,
  };
}

/** Closest approach to the Earth going backwards in time (up to dur s) from (r, v) at utc0. */
export function earthApproachBackward(r0, v0, utc0, dur) {
  const tab = new MoonTable(utc0 - dur * 1000, dur + 1200, 600);
  const r = r0.clone();
  const v = v0.clone();
  let t = dur;
  const m = new Vector3();
  let best = { d: Infinity, t: 0 };
  while (t > 0) {
    tab.at(t, m);
    const dE = r.length();
    if (dE < best.d) best = { d: dE, t: t - dur };
    if (dE < R_EARTH * 0.6) break;
    const dM = _a.subVectors(r, m).length();
    const TE = Math.sqrt((dE * dE * dE) / MU_EARTH);
    const TM = Math.sqrt((dM * dM * dM) / MU_MOON);
    const h = Math.max(0.5, Math.min(600, 0.01 * TE, 0.01 * TM, t));
    rk4(r, v, t, -h, tab, null);
    t -= h;
  }
  return { alt: best.d - R_EARTH, t: best.t };
}

/** Circumlunar free-return trajectory designed from its perilune: far-side pass at altKm at getPeri,
 *  returning to the entry corridor and traceable back to a ~185 km Earth departure.
 *  Returns the perilune state { r, v } (ECI) at getPeri. */
export async function designFreeReturn({ epochUTC, getPeri, altKm = 254, entryGamma = -6.5, departureKm = 185, tilt = 0.08 }) {
  const utcP = epochUTC + getPeri * 1000;
  const table = new MoonTable(utcP, 7 * 86400, 900);
  const mp = table.at(0, new Vector3());
  const mv = moonVelAt(table, 0);
  const away = mp.clone().normalize();
  const vm = mv.clone().normalize();
  const nrm = new Vector3().crossVectors(away, vm).normalize();
  const target = perigeeFor(entryGamma);
  const build = (x) => {
    // x = (speed − 2400 m/s, ψ out-of-plane heading (mrad), τ out-of-plane position tilt (mrad))
    const tau = tilt + x.z / 1000;
    const u = away.clone().multiplyScalar(Math.cos(tau)).addScaledVector(nrm, Math.sin(tau));
    const r = mp.clone().addScaledVector(u, R_MOON + altKm * 1000);
    const back = vm.clone().negate();
    const side = new Vector3().crossVectors(u, back).normalize();
    const tdir = new Vector3().crossVectors(side, u).normalize(); // ⟂ u, mostly along −v_moon
    const psi = x.y / 1000;
    const dir = tdir.multiplyScalar(Math.cos(psi)).addScaledVector(side, Math.sin(psi));
    const v = mv.clone().addScaledVector(dir, 2400 + x.x);
    return { r, v };
  };
  const fn = (x) => {
    const { r, v } = build(x);
    const fwd = propagate(r, v, 0, 6 * 86400, { table, stopAtEI: false, returnOnly: true });
    const bk = earthApproachBackward(r, v, utcP, 4.2 * 86400);
    return [Number.isFinite(fwd.earth.alt) ? (fwd.earth.alt - target) / 1e6 : 10, (bk.alt - departureKm * 1000) / 1e6];
  };
  // 1-D scan on speed for a sane start, then 2-constraint Newton on (speed, ψ, τ)
  let best = null;
  for (let dvs = -400; dvs <= 400; dvs += 25) {
    const x = new Vector3(dvs, 0, 0);
    const f = fn(x);
    const sc = Math.hypot(...f);
    if (!best || sc < best.sc) best = { x, sc };
    if (dvs % 100 === 0) await yieldUI();
  }
  const res = await newtonN(fn, best.x, { iters: 20, eps: 0.5, tol: 2e-5, maxStep: 60 });
  return { ...build(res.dv), residual: res.f };
}

/** Gradient (per m/s) of the perilune altitude for an impulse applied to (r, v) at utc0. */
export function periluneGradient(r, v, utc0) {
  const table = new MoonTable(utc0, 5 * 86400, 900);
  const peri = (vv) => propagate(r, vv, 0, 4.5 * 86400, { table, stopAtEI: false }).moon.d;
  const p0 = peri(v);
  const g = new Vector3();
  for (const ax of ['x', 'y', 'z']) {
    const v2 = v.clone();
    v2[ax] += 0.2;
    g[ax] = (peri(v2) - p0) / 0.2;
  }
  return { grad: g, periluneAlt: p0 - R_MOON };
}

/** Predicted entry flight-path angle (deg) and EI time (GET) of the current coast. */
export function predictEntry(ctx) {
  const table = new MoonTable(ctx.epochUTC + ctx.get * 1000, 7 * 86400, 900);
  let p = propagate(ctx.r, ctx.v, 0, 6.5 * 86400, { table });
  // still outbound (or inside the Moon's sphere): look at the return leg
  if (p.moon.d < 6.0e7 && (p.moon.t > 60 || ctx.r.clone().sub(table.at(0, new Vector3())).length() < 6.0e7)) p = propagate(ctx.r, ctx.v, 0, 6.5 * 86400, { table, returnOnly: true });
  return { gammaEI: p.earth.gammaEI, tEI: Number.isFinite(p.earth.tEI) ? ctx.get + p.earth.tEI : NaN, perigeeKm: p.earth.alt / 1000, periluneKm: p.moon.alt / 1000, tPerilune: ctx.get + p.moon.t };
}

export function fmtGET(t) {
  const s = Math.max(0, t);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export { orbitAbout };
