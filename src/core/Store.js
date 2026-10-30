// Persistent settings + progress (localStorage) and the per-launch session (role, mission).
// The session is NOT persisted: the player chooses role and mission every time the game starts.

const KEY = 'proyecto-apolo/v1';

export const DEFAULT_SETTINGS = {
  volumeMaster: 0.9,
  volumeSfx: 0.9,
  volumeVoice: 1.0,
  volumeMusic: 0.5,
  volumeAmbience: 0.7,
  voiceMode: 'en-sub', // 'en-sub' original English radio + Spanish subtitles | 'es' Spanish voice | 'text' no speech
  quindar: true, // Quindar tones around CAPCOM transmissions
  radioStatic: true,
  subtitles: true,
  showOriginal: true, // show the English original under the Spanish subtitle
  graphics: 'auto', // 'auto' | 'low' | 'medium' | 'high'
  renderScale: 1.0,
  fov: 70,
  difficulty: 'astronaut', // 'cadet' | 'astronaut' | 'realistic'
  hints: true,
  highlightControls: true,
  mouseSensitivity: 1.0,
  invertY: false,
  units: 'imperial', // HUD units: 'imperial' (authentic) | 'metric'
  unlockAll: true, // every chapter playable from the start (no level gating)
  showFps: false,
  cameraShake: true,
};

const DEFAULT_PROGRESS = {
  chapters: {}, // [chapterId]: { astronaut?: Result, controller?: Result }  Result = { completed, bestScore, bestGrade, date }
  achievements: {}, // [id]: ISO date
  stats: { playTimeS: 0, launches: 0, landings: 0, splashdowns: 0, alarmsHandled: 0 },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

class Store {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.progress = deepMerge(DEFAULT_PROGRESS, {});
    this.session = { role: null, missionId: null, chapterId: null };
    this._listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.settings = deepMerge(DEFAULT_SETTINGS, data.settings);
      this.progress = deepMerge(DEFAULT_PROGRESS, data.progress);
    } catch (err) {
      console.warn('[store] could not load saved data', err);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: this.settings, progress: this.progress }));
    } catch (err) {
      console.warn('[store] could not save', err);
    }
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(kind, key, value) {
    for (const fn of this._listeners) fn({ kind, key, value });
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.save();
    this._emit('settings', key, value);
  }

  resetSettings() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
    this._emit('settings', '*', null);
  }

  resetProgress() {
    this.progress = deepMerge(DEFAULT_PROGRESS, {});
    this.save();
    this._emit('progress', '*', null);
  }

  chapterResult(chapterId, role) {
    return this.progress.chapters[chapterId]?.[role] ?? null;
  }

  isChapterCompleted(chapterId, role = null) {
    const c = this.progress.chapters[chapterId];
    if (!c) return false;
    return role ? !!c[role]?.completed : !!(c.astronaut?.completed || c.controller?.completed);
  }

  /** Records a chapter outcome; keeps the best score. */
  recordChapterResult(chapterId, role, { completed, score = 0, grade = '-' }) {
    const c = (this.progress.chapters[chapterId] ??= {});
    const prev = c[role];
    const better = !prev || score > (prev.bestScore ?? -1);
    c[role] = {
      completed: completed || !!prev?.completed,
      bestScore: better ? score : prev.bestScore,
      bestGrade: better ? grade : prev.bestGrade,
      date: new Date().toISOString(),
    };
    this.save();
    this._emit('progress', chapterId, c[role]);
  }

  hasAchievement(id) {
    return !!this.progress.achievements[id];
  }

  /** @returns {boolean} true if newly unlocked */
  unlockAchievement(id) {
    if (this.progress.achievements[id]) return false;
    this.progress.achievements[id] = new Date().toISOString();
    this.save();
    this._emit('achievement', id, true);
    return true;
  }

  addStat(key, amount = 1) {
    this.progress.stats[key] = (this.progress.stats[key] ?? 0) + amount;
    this.save();
  }
}

export const store = new Store();
