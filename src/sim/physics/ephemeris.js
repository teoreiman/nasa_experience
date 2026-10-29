// Low-precision Sun/Moon ephemeris and Earth rotation (Astronomical Almanac formulas, ~0.3° Moon).
// Frame: Earth-centred inertial (ECI), equatorial of date, X → vernal equinox, Z → north pole.
// Three.js world axes are ECI axes (rendering is camera-relative, metres).

import { Vector3 } from 'three';
import { DEG, R_EARTH } from '../../core/constants.js';

export const jdFromUtc = (utcMs) => utcMs / 86400000 + 2440587.5;

/** Greenwich mean sidereal time (rad). */
export function gmst(utcMs) {
  const d = jdFromUtc(utcMs) - 2451545.0;
  const deg = 280.46061837 + 360.98564736629 * d;
  return (((deg % 360) + 360) % 360) * DEG;
}

export function obliquity(utcMs) {
  const d = jdFromUtc(utcMs) - 2451545.0;
  return (23.439 - 0.0000004 * d) * DEG;
}

function eclipticToEci(lambda, beta, dist, eps, out) {
  const cb = Math.cos(beta);
  const x = dist * cb * Math.cos(lambda);
  const y = dist * cb * Math.sin(lambda);
  const z = dist * Math.sin(beta);
  return out.set(x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps));
}

/** Unit vector from Earth to Sun (ECI). */
export function sunDirection(utcMs, out = new Vector3()) {
  const n = jdFromUtc(utcMs) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  return eclipticToEci(lambda, 0, 1, obliquity(utcMs), out).normalize();
}

/** Earth–Sun distance (m). */
export function sunDistance(utcMs) {
  const n = jdFromUtc(utcMs) - 2451545.0;
  const g = (357.528 + 0.9856003 * n) * DEG;
  return (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * 1.495978707e11;
}

/** Geocentric Moon position (ECI, m). */
export function moonPosition(utcMs, out = new Vector3()) {
  const T = (jdFromUtc(utcMs) - 2451545.0) / 36525;
  const s = (a, b) => Math.sin((a + b * T) * DEG);
  const c = (a, b) => Math.cos((a + b * T) * DEG);
  const lambda =
    (218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
      0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03)) * DEG;
  const beta = (5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21)) * DEG;
  const parallax =
    (0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74)) * DEG;
  const dist = R_EARTH / Math.sin(parallax);
  return eclipticToEci(lambda, beta, dist, obliquity(utcMs), out);
}

const _a = new Vector3();
const _b = new Vector3();
/** Geocentric Moon velocity (ECI, m/s) by central difference. */
export function moonVelocity(utcMs, out = new Vector3()) {
  const dt = 60;
  moonPosition(utcMs + dt * 1000, _a);
  moonPosition(utcMs - dt * 1000, _b);
  return out.subVectors(_a, _b).multiplyScalar(1 / (2 * dt));
}

/** Earth-fixed geodetic (spherical) → ECI position & velocity (rotating with the Earth). */
export function earthFixedToEci(latRad, lonRad, alt, utcMs, outR = new Vector3(), outV = null) {
  const theta = gmst(utcMs) + lonRad;
  const rr = R_EARTH + alt;
  const cl = Math.cos(latRad);
  outR.set(rr * cl * Math.cos(theta), rr * cl * Math.sin(theta), rr * Math.sin(latRad));
  if (outV) outV.set(-7.2921159e-5 * outR.y, 7.2921159e-5 * outR.x, 0);
  return outR;
}

/** Moon-fixed frame approximation: the Moon is tidally locked; its prime meridian faces the Earth
 *  on average. Returns the rotation angle about the Moon's spin axis (taken ≈ ECI-ecliptic normal). */
export function moonRotationAngle(utcMs) {
  // Mean longitude of the Moon (rad) + 180°: the sub-Earth point (lon 0) faces Earth.
  const T = (jdFromUtc(utcMs) - 2451545.0) / 36525;
  return ((218.32 + 481267.881 * T + 180) % 360) * DEG;
}
