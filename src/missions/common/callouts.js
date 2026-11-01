// Radio lines with live numbers, spoken the way Apollo crews and CAPCOMs read them: digit by digit
// ("one zero two, three three, zero five") or as stock callouts ("400 feet, down 9").
// Every word or phrase here is pre-recorded for the speakers that read numbers (tools/voices records
// VOCABULARY); a line built with these helpers carries `voiceEn` / `voiceEs` as a list of phrases
// that the radio plays back to back, while the subtitle shows the exact figures.

const DIGITS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
};

const WORDS = {
  en: { point: 'point', plus: 'plus', minus: 'minus', tig: 'TIG', dv: 'delta V', fps: 'feet per second', burnTime: 'burn time', seconds: 'seconds', roll: 'roll', pitch: 'pitch', yaw: 'yaw', loaded: 'Loaded in your computer.' },
  es: { point: 'coma', plus: 'más', minus: 'menos', tig: 'TIG', dv: 'delta ve', fps: 'pies por segundo', burnTime: 'tiempo de encendido', seconds: 'segundos', roll: 'alabeo', pitch: 'cabeceo', yaw: 'guiñada', loaded: 'Cargado en el ordenador.' },
};

// maneuver PADs read up by Houston (names from sim/physics/targeting.js and the chapters)
const PAD_NAMES = {
  TLI: ['TLI PAD.', 'PAD de la TLI.'],
  LOI: ['LOI PAD.', 'PAD de la LOI.'],
  TEI: ['TEI PAD.', 'PAD de la TEI.'],
  DOI: ['DOI PAD.', 'PAD de la DOI.'],
  MCC: ['Midcourse correction PAD.', 'PAD de la corrección de medio curso.'],
  'MCC-5': ['MCC-5 PAD.', 'PAD de la MCC-5.'],
  CIRC: ['Circularization PAD.', 'PAD de circularización.'],
  APSIS: ['Apsis change PAD.', 'PAD de cambio de órbita.'],
  DEORBIT: ['Deorbit PAD.', 'PAD de desorbitado.'],
  'RETORNO LIBRE': ['Free return PAD.', 'PAD de retorno libre.'],
  'PC+2': ['PC plus 2 PAD.', 'PAD del PC más 2.'],
};
const GENERIC_PAD = ['Maneuver PAD.', 'PAD de la maniobra.'];

// landing callouts (LMP during P64 / P66): altitude marks and rounded rates
export const ALT_MARKS = [2000, 1000, 750, 600, 500, 400, 300, 220, 200, 160, 100, 75, 60, 50, 40, 30, 20, 10];
export const RATE_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 150];
const nearestRate = (v) => RATE_STEPS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 0);

const altPhrase = (ft, lang) => (lang === 'en' ? `${ft} feet,` : `${ft} pies,`);
const downPhrase = (r, lang) => (lang === 'en' ? `down ${r}` : `bajando a ${r}`);
const fwdPhrase = (r, lang) => (lang === 'en' ? `${r} forward.` : `${r} adelante.`);

/** Digits of a number as spoken words ("3182.6" → three one eight two point six). */
export function readDigits(value, lang, { decimals = 0, sign = false } = {}) {
  const out = [];
  const v = Number(value);
  if (sign) out.push(v < 0 ? WORDS[lang].minus : WORDS[lang].plus);
  const txt = Math.abs(v).toFixed(decimals);
  for (const ch of txt) out.push(ch === '.' ? WORDS[lang].point : DIGITS[lang][Number(ch)]);
  return out;
}

/** GET as read on the loop: hours, minutes, seconds digit groups ("one zero two, three three, zero five"). */
export function readGET(t, lang) {
  const s = Math.max(0, t);
  const hh = String(Math.floor(s / 3600)).padStart(3, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return [...hh, ...mm, ...ss].map((d) => DIGITS[lang][Number(d)]);
}

/** Spoken parts of a maneuver PAD readup (name, TIG, ΔV, burn time). */
export function padReadout(pad, lang, { burn = true, loaded = false } = {}) {
  const w = WORDS[lang];
  const name = (PAD_NAMES[pad.name] ?? GENERIC_PAD)[lang === 'en' ? 0 : 1];
  const parts = [name, w.tig, ...readGET(pad.tig, lang), w.dv, ...readDigits(pad.dvTotal / 0.3048, lang, { decimals: 1 }), w.fps];
  if (burn && Number.isFinite(pad.burnTime)) parts.push(w.burnTime, ...readDigits(Math.round(pad.burnTime), lang), w.seconds);
  if (loaded) parts.push(w.loaded);
  return parts;
}

/** Aldrin-style altitude callout parts ("400 feet, down 9, 4 forward"). */
export function altitudeCallout(mark, rate, fwd, lang) {
  const parts = [altPhrase(mark, lang), downPhrase(nearestRate(Math.abs(rate)), lang)];
  if (fwd > 1) parts.push(fwdPhrase(nearestRate(Math.abs(fwd)), lang));
  return parts;
}

/** Gimbal angles read digit by digit (Apollo 13 alignment transfer). */
export function anglesReadout(intro, [r, p, y], lang) {
  const w = WORDS[lang];
  const ang = (x) => readDigits(((x % 360) + 360) % 360, lang, { decimals: 1 });
  return [intro, w.roll, ...ang(r), w.pitch, ...ang(p), w.yaw, ...ang(y)];
}

const numberWords = (lang) => [...DIGITS[lang], WORDS[lang].point, WORDS[lang].plus, WORDS[lang].minus];
const padWords = (lang) => [...Object.values(WORDS[lang]), ...Object.values(PAD_NAMES).map((p) => p[lang === 'en' ? 0 : 1]), GENERIC_PAD[lang === 'en' ? 0 : 1]];
const landingWords = (lang) => [...ALT_MARKS.map((m) => altPhrase(m, lang)), ...RATE_STEPS.map((r) => downPhrase(r, lang)), ...RATE_STEPS.filter((r) => r > 1).map((r) => fwdPhrase(r, lang))];

/** Every phrase the helpers above can produce, by speaker and language (the recorder's word list):
 *  CAPCOM reads the PADs, the CMP the gimbal angles and orbits, the LMP the landing callouts. */
export const VOCABULARY = {
  CAPCOM: { en: [...numberWords('en'), ...padWords('en')], es: [...numberWords('es'), ...padWords('es')] },
  CMP: { en: [...numberWords('en'), WORDS.en.roll, WORDS.en.pitch, WORDS.en.yaw], es: [...numberWords('es'), WORDS.es.roll, WORDS.es.pitch, WORDS.es.yaw] },
  LMP: { en: landingWords('en'), es: landingWords('es') },
};
