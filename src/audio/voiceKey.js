// Name of a pre-recorded radio line: speaker + language + the words spoken (whitespace-normalised).
// Shared by the game (AudioEngine) and the recorder (tools/voices), so both name a line the same way.

/** The words as spoken: single spaces, no leading/trailing blanks. */
export function speechText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 52-bit FNV-1a hash of `who|lang|text` in base 36 (two 26-bit halves, collision-safe for thousands of lines). */
export function voiceKey(who, lang, text) {
  const s = `${who}|${lang}|${speechText(text)}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return ((a & 0x3ffffff) * 0x4000000 + (b & 0x3ffffff)).toString(36);
}

/** Key of the same words regardless of the speaker (fallback when one speaker has no recording). */
export function textKey(lang, text) {
  return voiceKey('*', lang, text);
}
