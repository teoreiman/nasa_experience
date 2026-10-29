// Named initial states for chapter setups. STUB by the architect: crude circular orbits so the
// skeleton runs. The "physics" agent implements real mission-consistent states (Apollo 11/13
// trajectories, backward-propagated from known arrival conditions, ephemeris-consistent).
//
// getInitialState(name, { epochUTC, get, missionId }) → { r, v, q, w, mode, config?, primary }
//   mode: FlightDynamics mode ('PAD' | 'SPACE' | 'LANDED' | 'ENTRY' ...)

import { Quaternion, Vector3 } from 'three';
import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SITES_DEG } from '../../core/constants.js';
import { earthFixedToEci, moonPosition, moonVelocity } from './ephemeris.js';

export const INITIAL_STATE_NAMES = [
  'PAD_39A', 'EARTH_PARKING_ORBIT', 'POST_TLI', 'TLC_COAST', 'PRE_LOI', 'LUNAR_ORBIT', 'PRE_UNDOCK',
  'PRE_PDI', 'LUNAR_SURFACE_TRANQUILITY', 'LUNAR_SURFACE_SURVEYOR', 'PRE_ASCENT', 'PRE_TEI', 'TEC_COAST', 'PRE_ENTRY',
  'A13_TLC_55H', 'A13_PRE_FREE_RETURN', 'A13_PRE_PC2', 'A13_PRE_MCC5', 'A13_PRE_SM_JETT', 'A13_PRE_ENTRY',
  'A8_PRE_LOI', 'A8_LUNAR_ORBIT', 'TRAINING_DOCKING', 'TRAINING_LANDING',
];

function upQuat(r) {
  // body +X along local vertical
  return new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), r.clone().normalize());
}

function circular(center, centerVel, mu, radius, phase, incl = 0) {
  const r = new Vector3(Math.cos(phase), Math.sin(phase) * Math.cos(incl), Math.sin(phase) * Math.sin(incl)).multiplyScalar(radius);
  const vmag = Math.sqrt(mu / radius);
  const v = new Vector3(-Math.sin(phase), Math.cos(phase) * Math.cos(incl), Math.cos(phase) * Math.sin(incl)).multiplyScalar(vmag);
  return { r: r.add(center), v: v.add(centerVel) };
}

export function getInitialState(name, { epochUTC, get = 0 } = {}) {
  const utc = epochUTC + get * 1000;
  const zero = new Vector3();
  switch (name) {
    case 'PAD_39A': {
      const s = SITES_DEG.LC39A;
      const r = new Vector3();
      const v = new Vector3();
      earthFixedToEci(s.lat * DEG, s.lon * DEG, 33, utc, r, v);
      return { r, v, q: upQuat(r), w: new Vector3(), mode: 'PAD', primary: 'EARTH' };
    }
    case 'PRE_PDI':
    case 'LUNAR_ORBIT':
    case 'PRE_UNDOCK':
    case 'PRE_TEI':
    case 'A8_LUNAR_ORBIT':
    case 'PRE_LOI':
    case 'A8_PRE_LOI': {
      const mp = moonPosition(utc);
      const mv = moonVelocity(utc);
      const alt = name === 'PRE_PDI' ? 15000 : 111000;
      const { r, v } = circular(mp, mv, MU_MOON, R_MOON + alt, 0.3, 1.2 * DEG);
      const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), v.clone().sub(mv).normalize());
      return { r, v, q, w: new Vector3(), mode: 'SPACE', primary: 'MOON' };
    }
    case 'LUNAR_SURFACE_TRANQUILITY':
    case 'LUNAR_SURFACE_SURVEYOR':
    case 'PRE_ASCENT': {
      const mp = moonPosition(utc);
      const mv = moonVelocity(utc);
      const dir = mp.clone().multiplyScalar(-1).normalize(); // near side faces Earth
      const r = mp.clone().addScaledVector(dir, R_MOON);
      return { r, v: mv.clone(), q: upQuat(dir), w: new Vector3(), mode: 'LANDED', primary: 'MOON' };
    }
    case 'PRE_ENTRY':
    case 'A13_PRE_ENTRY': {
      const { r, v } = circular(zero, zero, MU_EARTH, R_EARTH + 300000, 0, 30 * DEG);
      v.multiplyScalar(1.37);
      return { r, v, q: upQuat(r), w: new Vector3(), mode: 'SPACE', primary: 'EARTH' };
    }
    default: {
      // Earth parking orbit (100 nmi) as a generic fallback.
      const { r, v } = circular(zero, zero, MU_EARTH, R_EARTH + 185000, 0, 32.5 * DEG);
      const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), v.clone().normalize());
      return { r, v, q, w: new Vector3(), mode: 'SPACE', primary: 'EARTH' };
    }
  }
}
