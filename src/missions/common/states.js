// Physically consistent starting states for chapters, generated with the same force model the game
// flies: the S-IVB TLI is flown headless by the real simulation, coasts and maneuvers use the RTCC
// propagator. Results are cached per session (the loading screen covers the first computation).
//
//   translunarState(atGET, { missionId })   after a real TLI (A11 TD&E, translunar coast)
//   apollo13State(atGET)                    A13: hybrid leg → free-return DPS burn → PC+2 → MCC-5
//                                           (each applied only when atGET is past it)
//   entryBackState(opts, atGET)             back-propagated from an entry-interface state

import { Vector3, Quaternion, Matrix4 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { MISSION_EPOCH } from '../../core/constants.js';
import { gmst } from '../../sim/physics/ephemeris.js';
import { planTLI, planMCC, planReturn, contextFromSim, coast, entryInterfaceState, designFreeReturn, periluneGradient, predictEntry } from '../../sim/physics/targeting.js';

export function basisQ(x, zRef) {
  const bx = x.clone().normalize();
  const bz = zRef.clone().addScaledVector(bx, -zRef.dot(bx)).normalize();
  const by = new Vector3().crossVectors(bz, bx);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(bx, by, bz));
}

const cache = new Map();
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
};
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/** Fly the TLI headless; returns the post-cutoff state { r, v, get, plan, mass }. */
function tliCutoff(missionId = 'apollo11') {
  return once(`tli:${missionId}`, async () => {
    const { Simulation } = await import('../../sim/Simulation.js');
    const sim = new Simulation({ chapter: { id: 'tli-gen', setup: { get: GET(2, 10), config: 'SIVB_STACK', state: 'EARTH_PARKING_ORBIT', csm: 'EARTH_ORBIT', lm: 'STOWED' } }, missionId, role: 'controller' });
    await sim.init();
    const plan = await planTLI(contextFromSim(sim));
    sim.saturn.startTB6({ c3: plan.c3, tb6: plan.tb6 });
    sim.clock.setLimit('dynamics', 1e9);
    let cut = false;
    sim.bus.on('vehicle:event', (e) => e.kind === 'TLI_CUTOFF' && (cut = true));
    let n = 0;
    // coast to just before TB6 quickly, then fly the burn in small steps
    sim.clock.setWarp(100);
    while (sim.clock.get < plan.tb6 - 30) {
      sim.step(Math.min(0.1, (plan.tb6 - 30 - sim.clock.get) / 100 + 1e-4));
      if (++n % 400 === 0) await yieldUI();
    }
    sim.clock.setWarp(1);
    while (!cut && sim.clock.get < plan.tig + 900) {
      sim.step(0.1);
      if (++n % 600 === 0) await yieldUI();
    }
    const st = sim.vehicle.state;
    const out = { r: st.r.clone(), v: st.v.clone(), get: sim.clock.get, plan, epochUTC: sim.clock.epochUTC };
    sim.dispose();
    return out;
  });
}

const ctxOf = (s, epochUTC, mass, engine = 'SPS') => ({
  r: s.r.clone(),
  v: s.v.clone(),
  get: s.get,
  epochUTC,
  mass,
  primary: 'EARTH',
  engine,
  thrust: engine === 'DPS' ? 45040 * 0.925 : 91190,
  propKg: engine === 'DPS' ? 8000 : 18000,
  isp: engine === 'DPS' ? 305 : 314,
});

function coastTo(s, epochUTC, get) {
  const { r, v } = coast(s.r, s.v, epochUTC + s.get * 1000, get - s.get);
  return { r, v, get };
}

/** State on the real translunar trajectory at `atGET` (at least 10 min after TLI cutoff). */
export async function translunarState(atGET, { missionId = 'apollo11' } = {}) {
  const c = await tliCutoff(missionId);
  const get = Math.max(atGET, c.get + 600);
  const s = coastTo(c, c.epochUTC, get);
  return { ...s, plan: c.plan, tliCutoff: c.get };
}

// ------------------------------------------------------------------ Apollo 13 trajectory chain

export const A13_EVENTS = {
  EXPLOSION: GET(55, 54, 53),
  FREE_RETURN: GET(61, 29, 43),
  PERILUNE: GET(77, 8, 35),
  PC2: GET(79, 27, 39),
  MCC5: GET(105, 18, 28),
  SM_JETT: GET(138, 1, 48),
  LM_JETT: GET(141, 30, 0),
  EI: GET(142, 40, 46),
  SPLASH: GET(142, 54, 41),
};

/** Apollo 13's trajectory at `atGET`, with every maneuver flown before that time applied.
 *  Designed from the historical far-side pass (254 km at 77:08): the free-return leg, the hybrid
 *  (non-free-return, 60 nmi perilune) leg before the DPS burn at 61:29, then PC+2 and MCC-5. */
export async function apollo13State(atGET) {
  const epochUTC = MISSION_EPOCH.apollo13;
  const E = A13_EVENTS;
  const base = await once('a13:base', async () => {
    const p = await designFreeReturn({ epochUTC, getPeri: E.PERILUNE, altKm: 254, entryGamma: -6.5 });
    const fr = coastTo({ r: p.r, v: p.v, get: E.PERILUNE }, epochUTC, E.FREE_RETURN);
    // hybrid trajectory = free return minus the burn that raised the perilune from 60 to 137 nmi
    const utc = epochUTC + E.FREE_RETURN * 1000;
    const { grad, periluneAlt } = periluneGradient(fr.r, fr.v, utc);
    const dir = grad.clone().normalize();
    const periOf = (m) => predictEntry({ r: fr.r, v: fr.v.clone().addScaledVector(dir, -m), get: E.FREE_RETURN, epochUTC }).periluneKm * 1000;
    // secant on the burn size so the hybrid perilune is 60 nmi
    let m0 = 0;
    let p0 = periluneAlt;
    let m1 = Math.min(25, Math.max(3, (periluneAlt - 111000) / Math.max(1, grad.length())));
    let p1 = periOf(m1);
    for (let i = 0; i < 5 && Math.abs(p1 - 111000) > 3000; i++) {
      const m2 = Math.min(40, Math.max(1, m1 + ((111000 - p1) * (m1 - m0)) / (p1 - p0 || 1)));
      m0 = m1;
      p0 = p1;
      m1 = m2;
      p1 = periOf(m1);
    }
    const hyb = { r: fr.r.clone(), v: fr.v.clone().addScaledVector(dir, -m1), get: E.FREE_RETURN };
    return { fr, hyb, dvFR: m1 };
  });
  if (atGET < E.FREE_RETURN) return { ...coastTo(base.hyb, epochUTC, atGET), freeReturn: false };
  if (atGET < E.PC2) return { ...coastTo(base.fr, epochUTC, atGET), freeReturn: true };
  const pc2 = await once('a13:pc2', async () => {
    const pre = coastTo(base.fr, epochUTC, E.PC2 - 1200);
    // PC+2 speeds the return up to a Pacific splashdown; leaves a slightly shallow entry for MCC-5
    const p = await planReturn(ctxOf(pre, epochUTC, 44000, 'DPS'), { tigGET: E.PC2, eiGET: E.EI, entryGamma: -5.0 });
    const at = coastTo(pre, epochUTC, E.PC2);
    at.v.add(p.dvECI);
    return at;
  });
  if (atGET < E.MCC5) return { ...coastTo(pc2, epochUTC, atGET), freeReturn: true, pc2: true };
  const mcc5 = await once('a13:mcc5', async () => {
    const pre = coastTo(pc2, epochUTC, E.MCC5 - 600);
    const p = await planMCC(ctxOf(pre, epochUTC, 40000, 'DPS'), { entryGamma: -6.3 });
    const at = coastTo(pre, epochUTC, pre.get + 600);
    at.v.add(p.dvECI);
    return at;
  });
  return { ...coastTo(mcc5, epochUTC, atGET), freeReturn: true, pc2: true, mcc5: true };
}

// ------------------------------------------------------------------ entry approach

/** Back-propagate from an entry-interface state to `atGET`. */
export function entryBackState(opts, atGET) {
  const ei = entryInterfaceState(opts);
  const { r, v } = coast(ei.r, ei.v, ei.utc, atGET - opts.getEI);
  return { r, v, get: atGET };
}

/** Attitude helpers for setups: +X along `fwd`, +Z toward `down`. */
export function attitude(fwd, down) {
  return basisQ(fwd, down);
}

/** Point reached from (lat, lon) going `distKm` along the initial bearing (deg). */
export function geoDestination(latDeg, lonDeg, bearingDeg, distKm) {
  const R = 6371;
  const d = distKm / R;
  const la = latDeg * (Math.PI / 180);
  const lo = lonDeg * (Math.PI / 180);
  const b = bearingDeg * (Math.PI / 180);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 * (180 / Math.PI), lon: ((lo2 * (180 / Math.PI) + 540) % 360) - 180 };
}

/** Great-circle distance (km) between two geographic points (deg). */
export function geoDistanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Entry approach state `minutesBefore` the entry interface, uprange of a recovery point. */
export function entryApproach({ epochUTC, getEI, splash, heading = 65, rangeKm = 2800, gammaDeg = -6.5, speed = 11030, atGET, ei: eiPoint = null }) {
  // `ei` (lat/lon) overrides the uprange point when it was calibrated against the flown entry
  const ei = eiPoint ?? geoDestination(splash.lat, splash.lon, heading + 180, rangeKm);
  return entryBackState({ epochUTC, getEI, latDeg: ei.lat, lonDeg: ei.lon, azimuthDeg: heading, gammaDeg, speed }, atGET);
}

/** Geographic latitude / longitude (deg) of an ECI position at utcMs. */
export function geoOf(r, utcMs) {
  const lat = Math.asin(r.z / r.length()) * (180 / Math.PI);
  const lon = ((((Math.atan2(r.y, r.x) - gmst(utcMs)) * 180) / Math.PI + 540) % 360) - 180;
  return { lat, lon };
}
