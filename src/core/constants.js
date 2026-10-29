// Physical constants, unit conversions and mission epochs.
// Simulation code works in SI units (m, kg, s, N, rad). Imperial units are for display only
// (Apollo displays used ft, ft/s, nmi, lb, psi, °F).

export const G0 = 9.80665;

export const FT = 0.3048;
export const NMI = 1852;
export const MI = 1609.344;
export const LBM = 0.45359237;
export const LBF = 4.4482216152605;
export const PSI = 6894.757293168;
export const MMHG = 133.322387415;
export const KM = 1000;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;

export const fToC = (f) => (f - 32) * 5 / 9;
export const cToF = (c) => c * 9 / 5 + 32;
export const kToF = (k) => (k - 273.15) * 9 / 5 + 32;

// Earth
export const MU_EARTH = 3.986004418e14;
export const R_EARTH = 6378137;
export const OMEGA_EARTH = 7.2921159e-5;
export const J2_EARTH = 1.08262668e-3;
export const ENTRY_INTERFACE_ALT = 121920; // 400,000 ft

// Moon
export const MU_MOON = 4.9048695e12;
export const R_MOON = 1737400;
export const MOON_SOI = 6.61e7;
export const MOON_MEAN_DIST = 3.844e8;

// Sun
export const MU_SUN = 1.32712440018e20;
export const AU = 1.495978707e11;
export const R_SUN = 6.957e8;

// Liftoff epochs (ms since 1970-01-01 UTC). GET 0 = liftoff.
export const MISSION_EPOCH = {
  apollo8: Date.UTC(1968, 11, 21, 12, 51, 0),
  apollo11: Date.UTC(1969, 6, 16, 13, 32, 0),
  apollo12: Date.UTC(1969, 10, 14, 16, 22, 0),
  apollo13: Date.UTC(1970, 3, 11, 19, 13, 0),
  training: Date.UTC(1969, 6, 16, 13, 32, 0),
};

// Geodetic sites (degrees). Convert with DEG when used in sim code.
export const SITES_DEG = {
  LC39A: { lat: 28.60822, lon: -80.60411, alt: 0, name: 'Complejo de Lanzamiento 39A' },
  HOUSTON_MSC: { lat: 29.5593, lon: -95.0907, alt: 0, name: 'Centro de Naves Tripuladas, Houston' },
  TRANQUILITY: { lat: 0.67408, lon: 23.47297, name: 'Base Tranquilidad (Apolo 11)' },
  SURVEYOR_III_A12: { lat: -3.01239, lon: -23.42157, name: 'Océano de las Tormentas (Apolo 12)' },
  FRA_MAURO: { lat: -3.64530, lon: -17.47136, name: 'Fra Mauro (Apolo 13, planificado)' },
  HADLEY: { lat: 26.13222, lon: 3.63386, name: 'Hadley-Apeninos (Apolo 15)' },
  DESCARTES: { lat: -8.97301, lon: 15.50019, name: 'Descartes (Apolo 16)' },
  TAURUS_LITTROW: { lat: 20.19080, lon: 30.77168, name: 'Taurus-Littrow (Apolo 17)' },
  SPLASH_A11: { lat: 13.3, lon: -169.15, name: 'Océano Pacífico — USS Hornet' },
  SPLASH_A13: { lat: -21.63, lon: -165.37, name: 'Océano Pacífico — USS Iwo Jima' },
};

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
