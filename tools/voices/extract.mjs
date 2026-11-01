#!/usr/bin/env node
// Collects every radio line the mission scripts can say (src/missions/**) into tools/voices/lines.json,
// the script of the voice recorder (tools/voices/record.mjs).
//
// A line is found as:
//   - a call with three consecutive arguments (who, en, es) where `who` is a speaker of SPEAKERS
//     (ctx.say, radio(ctx, …), local helpers such as at(t, who, en, es)), optionally followed by an
//     options object with voiceEn / voiceEs (the words spoken when the subtitle carries live numbers);
//   - an object literal with en + es (+ who, voiceEn, voiceEs): ground-task answers, poll intro/outro.
// Template literals whose placeholders are known finite sets (callsigns, alarm codes, consoles) are
// expanded; other live text must carry voiceEn / voiceEs or it is listed as "dynamic" (subtitles only).
//
//   node tools/voices/extract.mjs            → writes tools/voices/lines.json and prints a summary

import { parseAst } from 'rollup/parseAst';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { speechText, voiceKey } from '../../src/audio/voiceKey.js';
import { VOCABULARY } from '../../src/missions/common/callouts.js';

// the mission runner reads the saved settings on import: node has no localStorage
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { SPEAKERS, MOCR_CONSOLES } = await import('../../src/missions/MissionRunner.js');

const root = resolve(import.meta.dirname, '../..');
const SPEAKER_IDS = new Set(Object.keys(SPEAKERS));

// placeholders that only take a few values: expanded into one recording each
const KNOWN_VARS = {
  callsign: ['Apollo 11', 'Apollo', 'Thirteen', 'Apollo 12'],
  es: ['Apolo 11', 'Apolo', 'Trece', 'Apolo 12'],
  code: ['1201', '1202'],
  c: MOCR_CONSOLES.filter((c) => SPEAKER_IDS.has(c)),
};
// speaker placeholders: `who` defaults to CAPCOM in the kit helpers, `c` is the polled console
const WHO_VARS = { who: ['CAPCOM'], c: KNOWN_VARS.c };

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Possible string values of an expression: [{ text, dyn }] (dyn = has live, unknown parts). */
function strings(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [{ text: node.value, dyn: false }] : [];
    case 'TemplateLiteral': {
      let acc = [{ text: node.quasis[0].value.cooked, dyn: false }];
      node.expressions.forEach((ex, i) => {
        const tail = node.quasis[i + 1].value.cooked;
        const vals = ex.type === 'Identifier' && KNOWN_VARS[ex.name] ? KNOWN_VARS[ex.name].map((v) => ({ text: v, dyn: false })) : [{ text: '{…}', dyn: true }];
        acc = acc.flatMap((a) => vals.map((v) => ({ text: a.text + v.text + tail, dyn: a.dyn || v.dyn })));
      });
      return acc;
    }
    case 'ConditionalExpression':
      return [...strings(node.consequent), ...strings(node.alternate)];
    case 'LogicalExpression':
      return [...strings(node.left), ...strings(node.right)];
    case 'BinaryExpression':
      if (node.operator === '+') {
        const l = strings(node.left);
        const r = strings(node.right);
        if (l.length && r.length) return l.flatMap((a) => r.map((b) => ({ text: a.text + b.text, dyn: a.dyn || b.dyn })));
      }
      return [{ text: '{…}', dyn: true }];
    default:
      return [{ text: '{…}', dyn: true }];
  }
}

function speakersOf(node) {
  if (!node) return [];
  if (node.type === 'Literal' && SPEAKER_IDS.has(node.value)) return [node.value];
  if (node.type === 'Identifier' && WHO_VARS[node.name]) return WHO_VARS[node.name];
  if (node.type === 'ConditionalExpression') return [...speakersOf(node.consequent), ...speakersOf(node.alternate)];
  return [];
}

/** Phrases of a voiceEn / voiceEs override: a string, or a list of phrases built with the callouts
 *  helpers (their words come from VOCABULARY; only the literal phrases passed to them are new). */
function phrases(node) {
  if (!node) return [];
  if (node.type === 'ArrayExpression') return node.elements.flatMap((el) => (el?.type === 'SpreadElement' ? phrases(el.argument) : phrases(el)));
  if (node.type === 'CallExpression') return node.arguments.flatMap((a) => (a.type === 'Literal' && typeof a.value === 'string' ? strings(a) : a.type === 'ArrayExpression' ? phrases(a) : []));
  if (node.type === 'ConditionalExpression') return [...phrases(node.consequent), ...phrases(node.alternate)];
  return isStringy(node) ? strings(node) : [];
}

const isStringy = (n) => n && ['Literal', 'TemplateLiteral', 'ConditionalExpression', 'BinaryExpression', 'LogicalExpression'].includes(n.type) && (n.type !== 'Literal' || typeof n.value === 'string');
const prop = (obj, name) => obj?.type === 'ObjectExpression' ? obj.properties.find((p) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === name)?.value ?? null : null;

const found = []; // { who, en: [...], es: [...], voiceEn, voiceEs, src }

function visit(node, parentKey, file, src) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) visit(n, parentKey, file, src);
    return;
  }
  const at = () => `${relative(root, file)}:${src.slice(0, node.start).split('\n').length}`;
  if (node.type === 'CallExpression') {
    const a = node.arguments;
    for (let i = 0; i + 2 < a.length + 0 && i < a.length - 2; i++) {
      const who = speakersOf(a[i]);
      if (!who.length || !isStringy(a[i + 1]) || !isStringy(a[i + 2])) continue;
      const opts = a[i + 3];
      if (prop(opts, 'clip')) break; // a real NASA recording plays instead
      for (const w of who) found.push({ who: w, en: strings(a[i + 1]), es: strings(a[i + 2]), voiceEn: prop(opts, 'voiceEn'), voiceEs: prop(opts, 'voiceEs'), src: at() });
      break;
    }
  }
  if (node.type === 'ObjectExpression') {
    const en = prop(node, 'en');
    const es = prop(node, 'es');
    if (isStringy(en) && isStringy(es) && !prop(node, 'clip')) {
      const whoNode = prop(node, 'who');
      let who = speakersOf(whoNode);
      if (!whoNode && (parentKey === 'intro' || parentKey === 'outro')) who = ['FLIGHT'];
      if (who.length) for (const w of who) found.push({ who: w, en: strings(en), es: strings(es), voiceEn: prop(node, 'voiceEn'), voiceEs: prop(node, 'voiceEs'), src: at() });
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'start' || k === 'end' || k === 'type') continue;
    if (node.type === 'Property' && k === 'value') visit(v, node.key?.name ?? node.key?.value ?? null, file, src);
    else if (v && typeof v === 'object') visit(v, node.type === 'Property' ? parentKey : null, file, src);
  }
}

for (const file of walkFiles(join(root, 'src/missions'))) {
  const src = readFileSync(file, 'utf8');
  visit(parseAst(src), null, file, src);
}

// one recording per (speaker, language, words)
const out = new Map();
const dynamic = [];
// spoken numbers and stock callouts for the speakers that read them
for (const [who, vocab] of Object.entries(VOCABULARY)) {
  for (const lang of ['en', 'es']) for (const w of vocab[lang]) found.push({ who, en: [], es: [], src: 'src/missions/common/callouts.js', [`voice${lang === 'en' ? 'En' : 'Es'}`]: { type: 'Literal', value: w } });
}
for (const f of found) {
  for (const lang of ['en', 'es']) {
    const override = lang === 'en' ? f.voiceEn : f.voiceEs;
    const texts = override ? phrases(override) : f[lang];
    for (const t of texts) {
      if (t.dyn) {
        dynamic.push(`${f.src}  ${f.who} [${lang}]  ${t.text}`);
        continue;
      }
      const text = speechText(t.text);
      if (!text) continue;
      const key = voiceKey(f.who, lang, text);
      if (!out.has(key)) out.set(key, { key, who: f.who, lang, text, src: [] });
      const rec = out.get(key);
      if (!rec.src.includes(f.src)) rec.src.push(f.src);
    }
  }
}
const lines = [...out.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.who.localeCompare(b.who) || a.text.localeCompare(b.text));
writeFileSync(join(root, 'tools/voices/lines.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), lines }, null, 1));
const bySpeaker = {};
for (const l of lines) bySpeaker[l.who] = (bySpeaker[l.who] ?? 0) + 1;
console.log(`lines: ${lines.length} (${lines.filter((l) => l.lang === 'en').length} en · ${lines.filter((l) => l.lang === 'es').length} es)`);
console.log('by speaker:', bySpeaker);
if (dynamic.length) {
  console.log(`\n${dynamic.length} live lines without a fixed spoken version (add voiceEn / voiceEs):`);
  for (const d of [...new Set(dynamic)]) console.log('  ' + d);
}
