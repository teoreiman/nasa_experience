// The player's own soundtrack — e.g. their copy of James Horner's "Apollo 13" score. Audio files
// loaded in Ajustes → Banda sonora stay in this browser (IndexedDB) and play at their moments of the
// mission; nothing is uploaded, and the game itself ships no copyrighted music.

/** Mission moments that take a track, with the Apollo 13 (1995) cue that fits each one. */
export const MUSIC_CUES = [
  { id: 'menu', label: 'Menú principal', hint: 'Main Title', match: [/main.?title/i, /^menu/i] },
  { id: 'briefing', label: 'Sesión informativa y cuenta atrás', hint: 'Launch Control', match: [/launch.?control/i, /^briefing/i] },
  { id: 'launch', label: 'Lanzamiento e inyección translunar', hint: 'All Systems Go – The Launch', match: [/all.?systems.?go/i, /the.?launch/i, /lift.?off/i, /^launch/i] },
  { id: 'tension', label: 'Emergencia', hint: 'Master Alarm', match: [/master.?alarm/i, /^tension/i] },
  { id: 'lifeboat', label: 'Aquarius, bote salvavidas', hint: 'Into the L.E.M.', match: [/into.?the.?l\.?e\.?m/i, /lifeboat/i] },
  { id: 'darkside', label: 'Detrás de la Luna', hint: 'Darkside of the Moon', match: [/dark.?side/i] },
  { id: 'reentry', label: 'Reentrada y amerizaje', hint: 'Re-Entry & Splashdown', match: [/re.?entry/i, /splash.?down/i] },
  { id: 'triumph', label: 'Éxito y final', hint: 'End Titles', match: [/end.?titles?/i, /finale/i, /^triumph/i] },
];

/** Cue that a file name suggests ("11 All Systems Go - The Launch.mp3" → 'launch'), or null. */
export function guessCue(fileName) {
  const n = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/^[\d\s._-]+/, '');
  return MUSIC_CUES.find((c) => c.match.some((re) => re.test(n)))?.id ?? null;
}

const DB_NAME = 'proyecto-apolo-music';
const STORE = 'tracks';
let dbp = null;
const urls = new Map();

function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(() => null);
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result ?? null);
    t.onerror = t.onabort = () => res(null);
  });
}

/** Keep `file` as the track of `cue`. Resolves true when stored. */
export async function saveTrack(cue, file) {
  forget(cue);
  const ok = await tx('readwrite', (s) => s.put({ name: file.name, type: file.type, blob: file }, cue));
  return ok !== null;
}

export async function removeTrack(cue) {
  forget(cue);
  await tx('readwrite', (s) => s.delete(cue));
}

/** { cue: fileName } of the stored tracks. */
export async function listTracks() {
  const out = {};
  const d = await db();
  if (!d) return out;
  await new Promise((res) => {
    const t = d.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res();
      out[c.key] = c.value?.name ?? '';
      c.continue();
    };
    req.onerror = () => res();
  });
  return out;
}

/** Object URL of the stored track for `cue`, or null. */
export async function userTrackURL(cue) {
  if (urls.has(cue)) return urls.get(cue);
  const rec = typeof indexedDB === 'undefined' ? null : await tx('readonly', (s) => s.get(cue));
  const url = rec?.blob ? URL.createObjectURL(rec.blob) : null;
  urls.set(cue, url);
  return url;
}

function forget(cue) {
  const u = urls.get(cue);
  if (u) URL.revokeObjectURL(u);
  urls.delete(cue);
}
