#!/usr/bin/env node
// Voice recorder (macOS): reads tools/voices/lines.json (made by extract.mjs) and records every radio
// line with a male voice per speaker, then runs it through an Apollo air-to-ground chain — S-band
// voice band 300–3000 Hz, a hard radio compressor, transmitter saturation — and encodes AAC (.m4a)
// into public/audio/voice/<lang>/<key>.m4a with public/audio/voice/index.json as the index.
// The game plays these files on every device (same voices in every mode); a line missing here falls
// back to the device's speech synthesis.
//
//   node tools/voices/record.mjs [--force] [--only CAPCOM] [--lang en|es] [--jobs 8] [--sample N]
//
// Uses only what macOS ships: `say` (the US English / Mexican Spanish voices Reed, Eddy, Rocko and
// Grandpa, pitched to a natural 110–140 Hz with [[pbas]]) and `afconvert`. Better voices installed in
// System Settings → Accessibility → Spoken Content (e.g. "Evan (Enhanced)", "Juan (Enhanced)") can be
// cast in VOICES below. Re-running only records lines that are new or changed (--force: all).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { textKey } from '../../src/audio/voiceKey.js';

const root = resolve(import.meta.dirname, '../..');
const outDir = join(root, 'public/audio/voice');
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const force = args.includes('--force');
const JOBS = Number(opt('jobs', '8'));
const SR = 16000;

// ---------------------------------------------------------------- cast

const VOICES = {
  en: { reed: 'Reed (English (US))', eddy: 'Eddy (English (US))', rocko: 'Rocko (English (US))', grandpa: 'Grandpa (English (US))' },
  es: { reed: 'Reed (Spanish (Mexico))', eddy: 'Eddy (Spanish (Mexico))', rocko: 'Rocko (Spanish (Mexico))', grandpa: 'Grandpa (Spanish (Mexico))' },
};

// f0: speaking pitch in Hz (adult men ~100–150; nobody below 110 so the radio never sounds boomy)
// rate: words per minute (Apollo radio was brisk); style: 'radio' (S-band / loops) or 'broadcast' (PAO)
const CAST = {
  CAPCOM: { voice: 'reed', f0: 128, rate: 192 },
  CDR: { voice: 'eddy', f0: 120, rate: 184 },
  CMP: { voice: 'rocko', f0: 132, rate: 194 },
  LMP: { voice: 'grandpa', f0: 126, rate: 200 },
  FLIGHT: { voice: 'rocko', f0: 116, rate: 182 },
  LCC: { voice: 'reed', f0: 118, rate: 186 },
  PAO: { voice: 'eddy', f0: 124, rate: 178, style: 'broadcast' },
  NARRATOR: { voice: 'reed', f0: 122, rate: 172, style: 'broadcast' },
  RECOVERY: { voice: 'grandpa', f0: 118, rate: 190 },
  BOOSTER: { voice: 'eddy', f0: 138, rate: 196 },
  RETRO: { voice: 'grandpa', f0: 132, rate: 192 },
  FIDO: { voice: 'reed', f0: 140, rate: 198 },
  GUIDO: { voice: 'rocko', f0: 124, rate: 196 },
  EECOM: { voice: 'eddy', f0: 130, rate: 196 },
  GNC: { voice: 'grandpa', f0: 120, rate: 190 },
  TELMU: { voice: 'reed', f0: 120, rate: 190 },
  CONTROL: { voice: 'rocko', f0: 140, rate: 196 },
  INCO: { voice: 'eddy', f0: 114, rate: 188 },
  SURGEON: { voice: 'grandpa', f0: 112, rate: 182 },
  NETWORK: { voice: 'reed', f0: 134, rate: 194 },
  FAO: { voice: 'rocko', f0: 130, rate: 192 },
  PROCEDURES: { voice: 'eddy', f0: 126, rate: 192 },
  BACKROOM: { voice: 'grandpa', f0: 128, rate: 194 },
};

// ---------------------------------------------------------------- pronunciation

const SAY_EN = [
  [/\bS-IVB\b/g, 'S four B'], [/\bS-II\b/g, 'S two'], [/\bS-IC\b/g, 'S one C'], [/\bS-IB\b/g, 'S one B'],
  [/\bCM\/SM\b/g, 'C M, S M'], [/\bPC\+2\b/g, 'P C plus two'], [/\bMCC-5\b/g, 'M C C five'], [/\bPC plus 2\b/g, 'P C plus two'],
  [/\b1202\b/g, 'twelve oh two'], [/\b1201\b/g, 'twelve oh one'], [/\b61:30\b/g, 'sixty-one thirty'],
  [/\bP(\d\d)\b/g, (m, n) => `P ${n.split('').join(' ')}`], [/\bV(\d\d)\b/g, 'verb $1'], [/\bN(\d\d)\b/g, 'noun $1'],
  [/\bTB6\b/g, 'T B six'], [/\bT1\b/g, 'T one'], [/\bCO2\b/g, 'C O two'], [/\bO2\b/g, 'O two'], [/\bH2\b/g, 'H two'],
  [/\bLM\b/g, 'lem'], [/\bDSKY\b/g, 'disky'], [/\bEECOM\b/g, 'ee-com'], [/\bGUIDO\b/g, 'guy-doe'], [/\bFIDO\b/g, 'fy-doe'],
  [/\bTELMU\b/g, 'tell-moo'], [/\bCAPCOM\b/g, 'cap-com'], [/\bINCO\b/g, 'in-co'], [/\bMOCR\b/g, 'moh-ker'], [/\bPGNS\b/g, 'pings'],
  [/\bTIG\b/g, 'tig'], [/\bPADs\b/g, 'pads'], [/\bPAD\b/g, 'pad'], [/\bAUX\b/gi, 'awks'], [/\bSTAY\b/g, 'stay'],
  [/\bNO GO\b/g, 'no go'], [/\bGO\b/g, 'go'], [/\bOK\b/g, 'okay'], [/\bΔV\b|\bdelta-V\b|\bdelta V\b/g, 'delta vee'],
  [/\bpsi\b/g, 'P S I'], [/\bnmi\b/g, 'nautical miles'], [/\bft\/s\b/g, 'feet per second'], [/\bmmHg\b/g, 'millimeters of mercury'],
  [/γ/g, 'gamma'], [/\bLiOH\b/g, 'lithium hydroxide'],
  [/\b([A-Z]{2,5})\b/g, (m) => (['NASA', 'BOOSTER', 'RETRO', 'FLIGHT', 'CONTROL', 'NETWORK', 'SURGEON', 'PROCEDURES', 'ENTR', 'VERB', 'NOUN', 'ARM', 'ENG'].includes(m) ? m.toLowerCase() : m.split('').join(' '))],
];
const SAY_ES = [
  [/\bS-IVB\b/g, 'ese cuatro be'], [/\bS-II\b/g, 'ese dos'], [/\bS-IC\b/g, 'ese uno ce'], [/\bS-IB\b/g, 'ese uno be'],
  [/\bCM\/SM\b/g, 'ce eme, ese eme'], [/\bPC\+2\b/g, 'pe ce más dos'], [/\bPC más 2\b/g, 'pe ce más dos'], [/\bMCC-5\b/g, 'eme ce ce cinco'],
  [/\b1202\b/g, 'doce cero dos'], [/\b1201\b/g, 'doce cero uno'], [/\b61:30\b/g, 'sesenta y uno treinta'],
  [/\bP(\d\d)\b/g, (m, n) => `pe ${n.split('').join(' ')}`], [/\bVERB\b/g, 'verbo'], [/\bENTR\b/g, 'enter'], [/\bENG ARM\b/g, 'eng arm'],
  [/\bTB6\b/g, 'te be seis'], [/\bT1\b/g, 'te uno'], [/\bCO2\b|\bCO₂\b/g, 'ce o dos'], [/\bO2\b/g, 'o dos'], [/\bH2\b/g, 'hache dos'],
  [/\bLM\b/g, 'lem'], [/\bDSKY\b/g, 'disqui'], [/\bEECOM\b/g, 'i com'], [/\bGUIDO\b/g, 'gáido'], [/\bFIDO\b/g, 'fáido'],
  [/\bTELMU\b/g, 'tel mu'], [/\bCAPCOM\b/g, 'cap com'], [/\bINCO\b/g, 'inco'], [/\bMOCR\b/g, 'mócer'], [/\bBOOSTER\b/g, 'búster'],
  [/\bSURGEON\b/g, 'sérchon'], [/\bNETWORK\b/g, 'nétuork'], [/\bPROCEDURES\b/g, 'procídiurs'], [/\bRETRO\b/g, 'retro'], [/\bCONTROL\b/g, 'control'],
  [/\bFLIGHT\b|\bFlight\b/g, 'fláit'], [/\bNO GO\b/g, 'nou gou'], [/\bGO\b/g, 'gou'], [/\bSTAY\b/g, 'estéi'], [/\bAUX\b/g, 'aux'],
  [/\bHouston\b/g, 'Jiúston'], [/\bEagle\b/g, 'Íguel'], [/\bAquarius\b/g, 'Akuárius'], [/\bOdyssey\b/g, 'Ódisi'], [/\bColumbia\b/g, 'Colúmbia'],
  [/\bYankee Clipper\b/g, 'Yanqui Clíper'], [/\bIntrepid\b/g, 'Intrépid'], [/\bHornet\b/g, 'Jórnet'], [/\bIwo Jima\b/g, 'Iuo Yima'],
  [/\bCharlie\b/g, 'Chárli'], [/\bBravo\b/g, 'Bravo'], [/\bBingo\b/g, 'Bingo'], [/\bJack\b/g, 'Yak'], [/\bJoe\b/g, 'Yóu'], [/\bFred\b/g, 'Fred'],
  [/\bTIG\b/g, 'tig'], [/\bPADs\b/g, 'pads'], [/\bPAD\b/g, 'pad'], [/\bOK\b/g, 'okey'], [/ΔV|\bdelta ve\b/g, 'delta ve'],
  [/\bpsi\b/g, 'pe ese i'], [/\bnmi\b/g, 'millas náuticas'], [/\bpies\/s\b/g, 'pies por segundo'], [/\bkm\/h\b/g, 'kilómetros por hora'],
  [/\bmmHg\b/g, 'milímetros de mercurio'], [/γ/g, 'gama'], [/\bLiOH\b/g, 'hidróxido de litio'],
  [/(\d)\.(\d{3})\b/g, '$1$2'],
  [/\b([A-Z]{2,5})\b/g, (m) => m.split('').map((c) => SPELL_ES[c] ?? c).join(' ')],
];
const SPELL_ES = { A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'efe', G: 'ge', H: 'hache', I: 'i', J: 'jota', K: 'ka', L: 'ele', M: 'eme', N: 'ene', O: 'o', P: 'pe', Q: 'cu', R: 'erre', S: 'ese', T: 'te', U: 'u', V: 've', W: 'doble ve', X: 'equis', Y: 'ye', Z: 'zeta' };

function pronounce(text, lang) {
  let s = text;
  for (const [re, to] of lang === 'en' ? SAY_EN : SAY_ES) s = s.replace(re, to);
  return s.replace(/[¡¿«»"]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- processes

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${code}: ${err}`))));
  });
}

async function sayToWav(voice, pbas, rate, text, path) {
  await run('say', ['-v', voice, '-r', String(rate), '-o', path, `--data-format=LEI16@${SR}`, `[[pbas ${Math.round(pbas)}]] ${text}`]);
}

function readWav(path) {
  const b = readFileSync(path);
  let o = 12;
  let sr = SR;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = b.readUInt32LE(o + 12);
    if (id === 'data') {
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + n));
      return { sr, x: Float32Array.from(pcm, (v) => v / 32768) };
    }
    o += 8 + n + (n & 1);
  }
  throw new Error(`no data in ${path}`);
}

function writeWav(path, x, sr) {
  const n = x.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}

// ---------------------------------------------------------------- DSP

function biquad(type, f0, q, gainDb, sr) {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') [b0, b1, b2, a0, a1, a2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al];
  else if (type === 'highpass') [b0, b1, b2, a0, a1, a2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al];
  else [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A];
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function filt(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b0 * v + z1;
    z1 = b1 * v - a1 * o + z2;
    z2 = b2 * v - a2 * o;
    y[i] = o;
  }
  return y;
}

/** Feed-forward compressor with a soft knee (dB domain, peak detector). */
function compress(x, sr, { threshold, ratio, attack, release, knee = 6, makeup = 0 }) {
  const ga = Math.exp(-1 / (attack * sr));
  const gr = Math.exp(-1 / (release * sr));
  const y = new Float32Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? ga * env + (1 - ga) * a : gr * env + (1 - gr) * a;
    const db = 20 * Math.log10(env + 1e-9);
    const over = db - threshold;
    let red = 0;
    if (over >= knee / 2) red = over * (1 - 1 / ratio);
    else if (over > -knee / 2) red = ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / ratio);
    y[i] = x[i] * Math.pow(10, (makeup - red) / 20);
  }
  return y;
}

function peakNormalize(x, peakDb) {
  let p = 1e-9;
  for (const v of x) p = Math.max(p, Math.abs(v));
  const g = Math.pow(10, peakDb / 20) / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Cut the TTS lead-in / tail silence, keeping a short breath of air on both ends. */
function trim(x, sr) {
  const th = 0.012;
  let a = 0;
  let b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < th) a++;
  while (b > a && Math.abs(x[b]) < th) b--;
  return x.slice(Math.max(0, a - Math.round(0.035 * sr)), Math.min(x.length, b + Math.round(0.07 * sr)));
}

/** Apollo S-band air-to-ground voice: band-limited, squashed and slightly overdriven. */
function radioChain(x, sr) {
  let y = peakNormalize(trim(x, sr), -3);
  for (const c of [biquad('highpass', 330, 0.71, 0, sr), biquad('highpass', 330, 0.71, 0, sr), biquad('lowpass', 2900, 0.71, 0, sr), biquad('lowpass', 2900, 0.71, 0, sr)]) y = filt(y, c);
  y = filt(y, biquad('peak', 1750, 1.1, 5, sr)); // the nasal "tin can" presence of the headset mics
  y = filt(y, biquad('peak', 800, 1.4, 2, sr));
  y = compress(y, sr, { threshold: -26, ratio: 8, attack: 0.002, release: 0.07, makeup: 16 });
  // transmitter / receiver overdrive: soft clip with a touch of even harmonics
  const drive = 2.6;
  const norm = Math.tanh(drive);
  for (let i = 0; i < y.length; i++) y[i] = Math.tanh(drive * (y[i] + 0.12 * y[i] * y[i])) / norm;
  for (const c of [biquad('highpass', 280, 0.71, 0, sr), biquad('lowpass', 3300, 0.71, 0, sr)]) y = filt(y, c);
  return peakNormalize(y, -1);
}

/** Public-affairs commentary: broadcast quality of 1969 (wider band, gentle compression). */
function broadcastChain(x, sr) {
  let y = peakNormalize(trim(x, sr), -3);
  for (const c of [biquad('highpass', 140, 0.71, 0, sr), biquad('lowpass', 5200, 0.71, 0, sr), biquad('peak', 2500, 1.0, 3, sr)]) y = filt(y, c);
  y = compress(y, sr, { threshold: -22, ratio: 3.5, attack: 0.004, release: 0.12, makeup: 9 });
  const norm = Math.tanh(1.4);
  for (let i = 0; i < y.length; i++) y[i] = Math.tanh(1.4 * y[i]) / norm;
  return peakNormalize(y, -1);
}

// ---------------------------------------------------------------- pitch calibration

function medianF0(x, sr) {
  const N = Math.round(sr * 0.04);
  const hop = Math.round(sr * 0.02);
  const f0s = [];
  for (let s = 0; s + N < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    if (e / N < 2e-4) continue;
    let best = 0;
    let bl = 0;
    for (let lag = Math.round(sr / 320); lag < Math.round(sr / 60); lag++) {
      let c = 0;
      for (let i = 0; i < N - lag; i++) c += x[s + i] * x[s + i + lag];
      c /= e;
      if (c > best) {
        best = c;
        bl = lag;
      }
    }
    if (best > 0.5) f0s.push(sr / bl);
  }
  f0s.sort((a, b) => a - b);
  return f0s.length ? f0s[f0s.length >> 1] : NaN;
}

const tmp = join(tmpdir(), `apolo-voices-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const calPath = join(root, 'tools/voices/calibration.json');
const calibration = existsSync(calPath) ? JSON.parse(readFileSync(calPath, 'utf8')) : {};

/** [[pbas]] value that puts this voice at `f0` Hz (measured at two settings, log-linear in between). */
async function pbasFor(lang, voiceId, f0) {
  const name = VOICES[lang][voiceId];
  if (!calibration[name]) {
    const phrase = lang === 'en' ? 'Houston, this is Apollo. We read you loud and clear, over.' : 'Houston, aquí Apolo. Los escuchamos fuerte y claro, cambio.';
    const m = {};
    for (const p of [40, 52]) {
      const f = join(tmp, `cal-${voiceId}-${lang}-${p}.wav`);
      await sayToWav(name, p, 180, phrase, f);
      m[p] = medianF0(readWav(f).x, SR);
    }
    calibration[name] = { p40: m[40], p52: m[52] };
    writeFileSync(calPath, JSON.stringify(calibration, null, 1));
  }
  const { p40, p52 } = calibration[name];
  const perUnit = Math.log2(p52 / p40) / 12;
  return Math.max(30, Math.min(66, 40 + Math.log2(f0 / p40) / perUnit));
}

// ---------------------------------------------------------------- main

const { lines } = JSON.parse(readFileSync(join(root, 'tools/voices/lines.json'), 'utf8'));
const indexPath = join(outDir, 'index.json');
const prev = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { en: {}, es: {} };
const index = { v: 1, en: {}, es: {}, text: {} };
let todo = lines.filter((l) => (!opt('only') || l.who === opt('only')) && (!opt('lang') || l.lang === opt('lang')));
if (opt('sample')) todo = todo.filter((_, i) => i % Math.ceil(todo.length / Number(opt('sample'))) === 0);
for (const lang of ['en', 'es']) mkdirSync(join(outDir, lang), { recursive: true });

let done = 0;
let skipped = 0;
const failed = [];
async function record(l) {
  const file = join(outDir, l.lang, `${l.key}.m4a`);
  if (!force && prev[l.lang]?.[l.key] && existsSync(file)) {
    index[l.lang][l.key] = prev[l.lang][l.key];
    skipped++;
    return;
  }
  const c = CAST[l.who] ?? CAST.CAPCOM;
  const voiceName = VOICES[l.lang][c.voice];
  const pbas = await pbasFor(l.lang, c.voice, c.f0);
  const raw = join(tmp, `${l.lang}-${l.key}.raw.wav`);
  const fx = join(tmp, `${l.lang}-${l.key}.fx.wav`);
  await sayToWav(voiceName, pbas, c.rate, pronounce(l.text, l.lang), raw);
  const { x } = readWav(raw);
  const y = c.style === 'broadcast' ? broadcastChain(x, SR) : radioChain(x, SR);
  writeWav(fx, y, SR);
  await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', c.style === 'broadcast' ? '32000' : '24000', fx, file]);
  rmSync(raw, { force: true });
  rmSync(fx, { force: true });
  index[l.lang][l.key] = Math.round((y.length / SR) * 100) / 100;
  done++;
  if (done % 50 === 0) console.log(`  ${done} recorded…`);
}

// calibrate first (sequential: shared cache), then record in parallel
for (const lang of ['en', 'es']) for (const v of Object.keys(VOICES[lang])) await pbasFor(lang, v, 120);
const queue = [...todo];
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      try {
        await record(l);
      } catch (err) {
        failed.push(`${l.who} [${l.lang}] ${l.text}: ${err.message}`);
      }
    }
  }),
);
// keep earlier recordings of lines outside this run (--only / --lang / --sample)
for (const lang of ['en', 'es']) for (const [k, d] of Object.entries(prev[lang] ?? {})) if (!(k in index[lang]) && lines.some((l) => l.key === k && !todo.includes(l))) index[lang][k] = d;
for (const l of lines) if (index[l.lang][l.key] !== undefined) index.text[textKey(l.lang, l.text)] ??= l.key;
writeFileSync(indexPath, JSON.stringify(index));
rmSync(tmp, { recursive: true, force: true });
// recordings of lines that no longer exist in the scripts
let removed = 0;
if (!opt('only') && !opt('lang') && !opt('sample')) {
  for (const lang of ['en', 'es']) {
    for (const f of readdirSync(join(outDir, lang))) {
      if (f.endsWith('.m4a') && index[lang][f.slice(0, -4)] === undefined) {
        rmSync(join(outDir, lang, f));
        removed++;
      }
    }
  }
}
if (removed) console.log(`removed ${removed} unused recordings`);
console.log(`recorded ${done}, unchanged ${skipped}, failed ${failed.length} → ${Object.keys(index.en).length} en · ${Object.keys(index.es).length} es`);
for (const f of failed) console.log('  FAIL', f);
