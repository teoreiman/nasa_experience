// Global audio engine (WebAudio). STUB by the architect with the final interface
// (docs/ARCHITECTURE.md §13). The "audio" agent implements synthesized SFX, loops, Quindar tones,
// radio filtering/static, speech synthesis (EN/ES voices per speaker), NASA clips, music, ducking.

import { store } from '../core/Store.js';

export const NASA_CLIPS = {
  a11_countdown_liftoff: 'audio/nasa/a11_countdown_liftoff.mp3',
  a11_eagle_has_landed: 'audio/nasa/a11_eagle_has_landed.mp3',
  a11_eagle_has_landed_ext: 'audio/nasa/a11_eagle_has_landed_ext.mp3',
  a11_one_small_step: 'audio/nasa/a11_one_small_step.mp3',
  a13_houston_problem: 'audio/nasa/a13_houston_problem.mp3',
  a08_merry_christmas: 'audio/nasa/a08_merry_christmas.mp3',
  jfk_we_choose_launch: 'audio/nasa/jfk_we_choose_launch.mp3',
  jfk_we_choose: 'audio/nasa/jfk_we_choose.mp3',
  jfk_return_safely: 'audio/nasa/jfk_return_safely.mp3',
};

class DummyLoop {
  setGain() {}
  setRate() {}
  setParam() {}
  stop() {}
}

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.unlocked = false;
  }

  /** Must be called from a user gesture (first click/tap/key). */
  unlock() {
    if (this.unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
      this.unlocked = true;
    } catch (err) {
      console.warn('[audio] WebAudio unavailable', err);
    }
  }

  /** One-shot effect by name (see ARCHITECTURE §13 for the list). */
  sfx(name, opts = {}) {}

  /** Continuous sound; returns a handle { setGain, setRate, setParam, stop }. */
  loop(name, opts = {}) {
    return new DummyLoop();
  }

  /** Radio line: Quindar + static + voice (NASA clip if line.clip, else speech synthesis). */
  radio(line) {
    const mode = store.settings.voiceMode;
    if (line.clip && NASA_CLIPS[line.clip]) return this.clip(line.clip);
    if (mode === 'text' || !('speechSynthesis' in window)) return new Promise((r) => setTimeout(r, (line.durationS ?? 2) * 1000));
    return new Promise((resolve) => {
      const text = mode === 'es' ? line.es ?? line.en : line.en ?? line.es;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = mode === 'es' ? 'es-ES' : 'en-US';
      u.rate = 1.05;
      u.volume = store.settings.volumeVoice * store.settings.volumeMaster;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  clip(name) {
    const url = NASA_CLIPS[name];
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const a = new Audio(`${import.meta.env.BASE_URL}${url}`);
      a.volume = store.settings.volumeVoice * store.settings.volumeMaster;
      a.onended = a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }

  music(name) {}

  duck(amount, seconds) {}

  setPaused(p) {}

  stopAll() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
