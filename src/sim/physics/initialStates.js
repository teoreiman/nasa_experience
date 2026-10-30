// Named initial states for chapter setups, consistent with the ephemeris and the Moon-fixed frame
// used by physics/guidance/rendering (prime meridian toward the Earth, rotation about ECI Z).
// getInitialState(name, { epochUTC, get, missionId }) → { r, v, q, w, mode, primary, bodies?, site? }

import { Matrix4, Quaternion, Vector3 } from 'three';
import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SITES_DEG } from '../../core/constants.js';
import { earthFixedToEci, moonPosition, moonVelocity } from './ephemeris.js';
import { SITES, siteDir } from '../terrain/lunarTerrain.js';

export const INITIAL_STATE_NAMES = [
  'PAD_39A', 'EARTH_PARKING_ORBIT', 'POST_TLI', 'TLC_COAST', 'PRE_LOI', 'LUNAR_ORBIT', 'PRE_UNDOCK',
  'PRE_PDI', 'LUNAR_SURFACE_TRANQUILITY', 'LUNAR_SURFACE_SURVEYOR', 'PRE_ASCENT', 'PRE_TEI', 'TEC_COAST', 'PRE_ENTRY',
  'A13_TLC_55H', 'A13_PRE_FREE_RETURN', 'A13_PRE_PC2', 'A13_PRE_MCC5', 'A13_PRE_SM_JETT', 'A13_PRE_ENTRY',
  'A8_PRE_LOI', 'A8_LUNAR_ORBIT', 'TRAINING_DOCKING', 'TRAINING_LANDING', 'PAD_39B_IB', 'IB_EARTH_ORBIT',
];

function basisQ(x, zRef) {
  const bx = x.clone().normalize();
  const bz = zRef.clone().addScaledVector(bx, -zRef.dot(bx)).normalize();
  const by = new Vector3().crossVectors(bz, bx);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(bx, by, bz));
}

function moonFrame(utc) {
  const mp = moonPosition(utc);
  const mv = moonVelocity(utc);
  const ang = Math.atan2(-mp.y, -mp.x);
  const toEci = (d) => new Vector3(d.x * Math.cos(ang) - d.y * Math.sin(ang), d.x * Math.sin(ang) + d.y * Math.cos(ang), d.z);
  return { mp, mv, ang, toEci };
}

/** Circular orbit around the Moon through a site, flying west (Apollo approaches from the east).
 *  The plane is the one through the site closest to the Moon's orbital plane — the plane Apollo
 *  arrived in from the Earth, so a ~1 km/s TEI can bring the spacecraft home. */
function lunarOrbitOverSite(utc, siteKey, alt, phase) {
  const { mp, mv, toEci } = moonFrame(utc);
  const s = toEci(siteDir(SITES[siteKey]));
  const hM = new Vector3().crossVectors(mp, mv).normalize();
  const east = hM.clone().cross(s).normalize();
  const west = east.clone().negate();
  const R = R_MOON + alt;
  const pos = s.clone().multiplyScalar(Math.cos(phase)).addScaledVector(west, Math.sin(phase)).multiplyScalar(R);
  const dir = s.clone().multiplyScalar(-Math.sin(phase)).addScaledVector(west, Math.cos(phase)).normalize();
  return { r: pos.add(mp), dirV: dir, mp, mv, up: pos.clone().normalize() };
}

/** Circular parking orbit in the plane of a launch from LC-39A at the mission epoch (azimuth 72°),
 *  at the position the spacecraft would have at `get` (insertion at T+11:49, ~1,700 km downrange). */
export function parkingOrbitState(epochUTC, get, alt = 185500, azDeg = 72.06) {
  const s = SITES_DEG.LC39A;
  const r0 = earthFixedToEci(s.lat * DEG, s.lon * DEG, 0, epochUTC, new Vector3());
  const up = r0.clone().normalize();
  const east = new Vector3(-up.y, up.x, 0).normalize();
  const north = new Vector3().crossVectors(up, east);
  const az = azDeg * DEG;
  // inertial direction of motion: ground-track azimuth plus the Earth's eastward rotation speed
  const vdir = north.clone().multiplyScalar(Math.cos(az) * 7400).addScaledVector(east, Math.sin(az) * 7400 + 408).normalize();
  const hdir = new Vector3().crossVectors(up, vdir).normalize();
  const R = R_EARTH + alt;
  const n = Math.sqrt(MU_EARTH / (R * R * R));
  const theta = 1700e3 / R_EARTH + n * (get - 709);
  const pos = up.clone().applyAxisAngle(hdir, theta).multiplyScalar(R);
  const vel = new Vector3().crossVectors(hdir, pos).normalize().multiplyScalar(Math.sqrt(MU_EARTH / R));
  return { r: pos, v: vel };
}

function earthOrbit(alt, phase, incl, speedFactor = 1) {
  const R = R_EARTH + alt;
  const r = new Vector3(Math.cos(phase), Math.sin(phase) * Math.cos(incl), Math.sin(phase) * Math.sin(incl)).multiplyScalar(R);
  const v = new Vector3(-Math.sin(phase), Math.cos(phase) * Math.cos(incl), Math.cos(phase) * Math.sin(incl)).multiplyScalar(Math.sqrt(MU_EARTH / R) * speedFactor);
  return { r, v };
}

/** Two-body propagation about the Moon (RK4), negative dt propagates backwards. */
function propagateMoon(r, v, mp, dt, steps = 400) {
  const h = dt / steps;
  const acc = (p) => {
    const d = p.clone().sub(mp);
    return d.multiplyScalar(-MU_MOON / Math.pow(d.lengthSq(), 1.5));
  };
  for (let i = 0; i < steps; i++) {
    const k1v = acc(r);
    const k1r = v.clone();
    const k2v = acc(r.clone().addScaledVector(k1r, h / 2));
    const k2r = v.clone().addScaledVector(k1v, h / 2);
    const k3v = acc(r.clone().addScaledVector(k2r, h / 2));
    const k3r = v.clone().addScaledVector(k2v, h / 2);
    const k4v = acc(r.clone().addScaledVector(k3r, h));
    const k4r = v.clone().addScaledVector(k3v, h);
    r.addScaledVector(k1r.add(k2r.multiplyScalar(2)).add(k3r.multiplyScalar(2)).add(k4r), h / 6);
    v.addScaledVector(k1v.add(k2v.multiplyScalar(2)).add(k3v.multiplyScalar(2)).add(k4v), h / 6);
  }
  return { r, v };
}

export function getInitialState(name, { epochUTC, get = 0 } = {}) {
  const utc = epochUTC + get * 1000;
  switch (name) {
    case 'PAD_39A':
    case 'PAD_39B_IB': {
      // ML deck at 29 m above sea level; the Saturn IB stands on the 38.7 m "milkstool" at 39B
      const ib = name === 'PAD_39B_IB';
      const s = ib ? SITES_DEG.LC39B : SITES_DEG.LC39A;
      const alt = ib ? 29 + 38.7 + 20 : 62;
      const r = new Vector3();
      const v = new Vector3();
      earthFixedToEci(s.lat * DEG, s.lon * DEG, alt, utc, r, v);
      return { r, v, q: basisQ(r, new Vector3(0, 0, 1)), w: new Vector3(), mode: 'PAD', primary: 'EARTH', pad: { id: ib ? 'B' : 'A', lat: s.lat, lon: s.lon, alt, milkstool: ib } };
    }
    case 'IB_EARTH_ORBIT': {
      const { r, v } = earthOrbit(232000, 0.25, 50 * DEG);
      return { r, v, q: basisQ(v.clone(), r.clone().normalize().negate()), w: new Vector3(), mode: 'SPACE', primary: 'EARTH' };
    }
    case 'PRE_PDI':
    case 'TRAINING_LANDING': {
      // LM at ~50,000 ft descent-orbit perilune, ~480 km uprange (east) of the site
      const lead = name === 'TRAINING_LANDING' ? 430e3 : 470e3;
      const o = lunarOrbitOverSite(utc, 'TRANQUILITY', 15240, -lead / R_MOON);
      const speed = Math.sqrt(MU_MOON * (2 / (R_MOON + 15240) - 1 / (R_MOON + (15240 + 110000) / 2)));
      const v = o.dirV.clone().multiplyScalar(speed).add(o.mv);
      // windows down, engine facing forward (retrograde): +X along −velocity, +Z toward the surface
      const q = basisQ(o.dirV.clone().negate(), o.up.clone().negate());
      return { r: o.r, v, q, w: new Vector3(), mode: 'SPACE', primary: 'MOON', site: 'TRANQUILITY' };
    }
    case 'LUNAR_SURFACE_TRANQUILITY':
    case 'LUNAR_SURFACE_SURVEYOR':
    case 'PRE_ASCENT': {
      const key = name === 'LUNAR_SURFACE_SURVEYOR' ? 'SURVEYOR' : 'TRANQUILITY';
      const { mp, mv, toEci } = moonFrame(utc);
      const up = toEci(siteDir(SITES[key]));
      const r = mp.clone().addScaledVector(up, R_MOON + 2.5);
      const west = new Vector3(0, 0, 1).cross(up).normalize().negate();
      return { r, v: mv.clone(), q: basisQ(up, west), w: new Vector3(), mode: 'LANDED', primary: 'MOON', site: key };
    }
    case 'LUNAR_ORBIT':
    case 'PRE_UNDOCK':
    case 'PRE_TEI':
    case 'A8_LUNAR_ORBIT': {
      const phase = name === 'PRE_TEI' ? Math.PI * 0.75 : name === 'A8_LUNAR_ORBIT' ? Math.PI * 0.62 : -0.9;
      const o = lunarOrbitOverSite(utc, 'TRANQUILITY', 111000, phase);
      const v = o.dirV.clone().multiplyScalar(Math.sqrt(MU_MOON / (R_MOON + 111000))).add(o.mv);
      return { r: o.r, v, q: basisQ(o.dirV, o.up.clone().negate()), w: new Vector3(), mode: 'SPACE', primary: 'MOON', site: 'TRANQUILITY' };
    }
    case 'PRE_LOI':
    case 'A8_PRE_LOI':
    case 'A13_PRE_PC2': {
      // perilune ~60 nmi over the far side, then back-propagate to the chapter start
      const back = name === 'A13_PRE_PC2' ? 900 : 1500;
      const { mp, mv } = moonFrame(utc + back * 1000);
      const away = mp.clone().normalize(); // far side = away from Earth
      const peri = mp.clone().addScaledVector(away, R_MOON + (name === 'A13_PRE_PC2' ? 254000 : 111000));
      const north = new Vector3(0, 0, 1);
      const dir = north.clone().cross(away).normalize();
      const vp = Math.sqrt(2 * MU_MOON / (R_MOON + 111000) + 800 * 800);
      const st = propagateMoon(peri.clone(), dir.multiplyScalar(vp), mp, -back);
      const v = st.v.add(mv);
      const r = st.r.add(mv.clone().multiplyScalar(-back));
      return { r, v, q: basisQ(v.clone().sub(mv).negate(), r.clone().sub(mp).negate()), w: new Vector3(), mode: 'SPACE', primary: 'MOON' };
    }
    case 'PRE_ENTRY':
    case 'A13_PRE_ENTRY': {
      // ~1 min before entry interface, at 140 km, on a lunar-return trajectory whose vacuum perigee
      // is 37 km (≈ −6.5° at 400,000 ft, 11 km/s)
      const R = R_EARTH + 140000;
      const rEI = R_EARTH + 121920;
      const v0 = Math.sqrt(11030 * 11030 + 2 * MU_EARTH * (1 / R - 1 / rEI));
      const perigee = (g) => {
        const hh = R * v0 * Math.cos(g);
        const E = (v0 * v0) / 2 - MU_EARTH / R;
        const a = -MU_EARTH / (2 * E);
        const p = (hh * hh) / MU_EARTH;
        const e = Math.sqrt(Math.max(0, 1 - p / a));
        return p / (1 + e) - R_EARTH;
      };
      let lo = -15 * DEG;
      let hi = 0;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (perigee(mid) > 37000) hi = mid;
        else lo = mid;
      }
      const gamma = (lo + hi) / 2;
      const lat = name === 'A13_PRE_ENTRY' ? -12 : 5;
      const r = new Vector3(Math.cos(lat * DEG), 0, Math.sin(lat * DEG)).multiplyScalar(R);
      const east = new Vector3(0, 1, 0);
      const up = r.clone().normalize();
      const v = east.clone().multiplyScalar(Math.cos(gamma)).addScaledVector(up, Math.sin(gamma)).multiplyScalar(v0);
      // heat shield forward: body −X along velocity → +X against it; crew heads-down
      return { r, v, q: basisQ(v.clone().negate(), up), w: new Vector3(), mode: 'SPACE', primary: 'EARTH' };
    }
    case 'TRAINING_DOCKING':
    case 'POST_TLI': {
      const { r, v } = earthOrbit(name === 'POST_TLI' ? 7000e3 : 185000, 0.3, 30 * DEG, name === 'POST_TLI' ? 1.32 : 1);
      const fwd = v.clone().normalize();
      const q = basisQ(fwd.clone().negate(), r.clone().normalize().negate()); // CSM turned around facing the S-IVB
      const tq = basisQ(fwd, r.clone().normalize().negate());
      const tr = r.clone().addScaledVector(fwd, -(name === 'POST_TLI' ? 40 : 26) - 12);
      return {
        r,
        v,
        q,
        w: new Vector3(),
        mode: 'SPACE',
        primary: 'EARTH',
        bodies: [{ id: 'SIVB_LM', config: 'SIVB_LM', r: tr, v: v.clone(), q: tq, label: 'S-IVB / Eagle' }],
      };
    }
    case 'TLC_COAST':
    case 'TEC_COAST':
    case 'A13_TLC_55H':
    case 'A13_PRE_FREE_RETURN':
    case 'A13_PRE_MCC5':
    case 'A13_PRE_SM_JETT': {
      // high elliptical cislunar coast toward/away from the Moon
      const { mp } = moonFrame(utc);
      const frac = { TLC_COAST: 0.35, TEC_COAST: 0.6, A13_TLC_55H: 0.82, A13_PRE_FREE_RETURN: 0.88, A13_PRE_MCC5: 0.55, A13_PRE_SM_JETT: 0.08 }[name];
      const outbound = ['TLC_COAST', 'A13_TLC_55H', 'A13_PRE_FREE_RETURN'].includes(name);
      const dist = mp.length() * frac + (name === 'A13_PRE_SM_JETT' ? 45000e3 : 0);
      const dir = mp.clone().normalize().applyAxisAngle(new Vector3(0, 0, 1), outbound ? -0.25 : 0.4);
      const r = dir.multiplyScalar(Math.max(dist, R_EARTH + 40000e3 * 0.2));
      const rr = r.length();
      const a = (rr + mp.length()) / 2 + (outbound ? 0 : -20000e3);
      const speed = Math.sqrt(MU_EARTH * (2 / rr - 1 / a));
      const radial = r.clone().normalize();
      const tang = new Vector3(0, 0, 1).cross(radial).normalize();
      const v = radial.clone().multiplyScalar(outbound ? speed * 0.97 : -speed * 0.97).addScaledVector(tang, speed * 0.24);
      return { r, v, q: basisQ(tang, new Vector3(0, 0, 1)), w: new Vector3(0, 0.3 * DEG, 0), mode: 'SPACE', primary: 'EARTH' };
    }
    case 'EARTH_PARKING_ORBIT':
    default: {
      const { r, v } = parkingOrbitState(epochUTC, get);
      return { r, v, q: basisQ(v.clone(), r.clone().normalize().negate()), w: new Vector3(), mode: 'SPACE', primary: 'EARTH' };
    }
  }
}
