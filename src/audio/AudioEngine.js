// Global audio engine (Web Audio). Everything is synthesised at runtime except the NASA clips:
//   sfx(name, {gain, pan, rate})  one-shots (switches, pyros, docking latches, alarms, UI)
//   loop(name, opts) → { setGain, setRate, setParam, stop }  engines, RCS, wind, plasma, fans…
//   radio(line) → Promise   Quindar in/out + static bed + voice (NASA clip or speech synthesis)
//   clip(name, {radio}) → Promise   NASA public-domain recordings
//   music(name|null)        generative ambient: menu, briefing, tension, triumph, sad
//   duck(amount, s), setPaused(p), stopAll()
// Buses: master → compressor → out; sfx / sim (pausable) / voice / music / ambience.

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

const GROUND = new Set(['CAPCOM', 'FLIGHT', 'EECOM', 'GNC', 'GUIDO', 'FIDO', 'RETRO', 'BOOSTER', 'TELMU', 'CONTROL', 'INCO', 'SURGEON', 'NETWORK', 'FAO', 'PROCEDURES', 'BACKROOM', 'RECOVERY']);

// Per-speaker voice character (pitch / rate) so the crew and Houston are distinguishable. Every
// speaker of 1968–70 Apollo radio was a man: synthesized lines use male voices only, pitched low.
const VOICE_STYLE = {
  CAPCOM: { pitch: 0.84, rate: 1.04, pref: 0 },
  CDR: { pitch: 0.8, rate: 1.0, pref: 1 },
  CMP: { pitch: 0.88, rate: 1.04, pref: 2 },
  LMP: { pitch: 0.82, rate: 1.03, pref: 3 },
  FLIGHT: { pitch: 0.74, rate: 1.0, pref: 4 },
  LCC: { pitch: 0.8, rate: 1.0, pref: 5 },
  PAO: { pitch: 0.82, rate: 0.98, pref: 5 },
  NARRATOR: { pitch: 0.86, rate: 0.98, pref: 6 },
};

// Voice names are the only gender hint the Web Speech API gives. Male names of the Windows/Edge
// (incl. "Online (Natural)"), macOS/iOS, Chrome and Android voices for English and Spanish.
// (tested on accent-stripped names: JS \b only knows ASCII letters, "Álvaro" would never match)
const MALE_VOICE = /\b(male|guy|davis|tony|jason|brian|andrew|christopher|eric|roger|steffan|ryan|thomas|george|james|richard|ravi|mark|david|alex|daniel|fred|tom|ralph|aaron|arthur|gordon|oliver|reed|rocko|eddy|grandpa|liam|william|connor|mitchell|luke|prabhat|jorge|juan|diego|carlos|pablo|raul|alvaro|tomas|gonzalo|gerardo|emilio|lorenzo|mateo|alonso|federico|roberto|manuel|andres|mario|luis|saul|sergio|rodrigo|cristian|enrique|jose|esd|eed|iol|iom|tpd)\b/i;
const FEMALE_VOICE = /\b(female|zira|aria|jenny|michelle|ana|emma|ava|sara|nancy|amber|ashley|cora|elizabeth|jane|monica|paulina|helena|laura|sabina|dalia|elvira|samantha|victoria|karen|moira|tessa|fiona|veena|kathy|princess|vicki|agnes|allison|susan|serena|kate|catherine|hazel|libby|maisie|sonia|natasha|clara|abril|beatriz|isabel|lucia|marta|paloma|renata|salome|valentina|elena|camila|catalina|karla|maria|margarita|marisol|paola|tania|teresa|ximena|yolanda|angelica|soledad|isabela|luciana|carmen|flo|grandma|sandy|shelley|esc|esf|eea|eec|iob|iog|tpc|tpf|sfg)\b/i;
const plainName = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const NOVELTY_VOICE = /Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Albert/i;
// Preferred locales: American English for the crews; Latin-American Spanish before Spain.
const EN_LOCALES = ['en-us', 'en-gb', 'en-au', 'en-ca', 'en'];
const ES_LOCALES = ['es-ar', 'es-mx', 'es-us', 'es-419', 'es-co', 'es-cl', 'es-es', 'es'];

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.unlocked = false;
    this.paused = false;
    this._loops = new Set();
    this._musicName = null;
    this._music = null;
    this._duckUntil = 0;
    this._voices = null;
    this._lastSfx = new Map();
    store.onChange(({ kind }) => kind === 'settings' && this._applyVolumes());
    if ('speechSynthesis' in window) {
      const load = () => (this._voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  /** Must be called from a user gesture (first click/tap/key). */
  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.ctx.resume();
      this.unlocked = true;
      this._build();
      if (this._pendingMusic !== undefined) this.music(this._pendingMusic);
    } catch (err) {
      console.warn('[audio] WebAudio unavailable', err);
    }
  }

  // ---------------------------------------------------------------- graph

  _build() {
    const c = this.ctx;
    this.out = c.createDynamicsCompressor();
    this.out.threshold.value = -14;
    this.out.knee.value = 12;
    this.out.ratio.value = 4;
    this.out.attack.value = 0.004;
    this.out.release.value = 0.25;
    this.out.connect(c.destination);
    this.master = c.createGain();
    this.master.connect(this.out);
    const bus = () => {
      const g = c.createGain();
      g.connect(this.master);
      return g;
    };
    this.sfxBus = bus();
    this.voiceBus = bus();
    this.musicBus = bus();
    this.ambBus = bus();
    this.simBus = c.createGain(); // engine/system sounds, muted while paused
    this.simBus.connect(this.sfxBus);
    this.simAmb = c.createGain();
    this.simAmb.connect(this.ambBus);
    this.duckGain = c.createGain(); // music + ambience ducking under voice
    this.musicBus.disconnect();
    this.musicBus.connect(this.duckGain);
    this.duckGain.connect(this.master);
    // shared buffers
    const sr = c.sampleRate;
    this.noise = { white: this._noiseBuf('white', 2), pink: this._noiseBuf('pink', 3), brown: this._noiseBuf('brown', 4) };
    this.crackleBuf = this._crackleBuf(4);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.2);
    this.reverbOut = c.createGain();
    this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.musicBus);
    this.roomVerb = c.createConvolver();
    this.roomVerb.buffer = this._impulse(0.35, 4);
    this.roomVerb.connect(this.sfxBus);
    void sr;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = store.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volumeMaster, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.volumeSfx, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(s.volumeVoice, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.volumeMusic * 0.55, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.volumeAmbience, t, 0.05);
  }

  _noiseBuf(kind, seconds) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  /** Sparse random pops (Saturn V crackle / RCS chatter). */
  _crackleBuf(seconds) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let i = 0;
    while (i < n) {
      i += Math.floor(c.sampleRate * (0.004 + Math.random() * 0.03));
      const len = Math.floor(c.sampleRate * (0.001 + Math.random() * 0.006));
      const a = Math.pow(Math.random(), 1.8) * (Math.random() < 0.5 ? -1 : 1);
      for (let k = 0; k < len && i + k < n; k++) d[i + k] += a * (Math.random() * 2 - 1) * Math.exp(-k / (len * 0.3));
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  _src(kind, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = kind === 'crackle' ? this.crackleBuf : this.noise[kind];
    s.loop = loop;
    s.loopStart = 0;
    s.playbackRate.value = 1;
    return s;
  }

  _filter(type, freq, q = 0.707) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  _env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }

  _tone(dest, type, freq, t, a, peak, d, { freqEnd = null, detune = 0 } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + a + d);
    o.detune.value = detune;
    const g = this._gain(0);
    this._env(g, t, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + d + 0.05);
    return o;
  }

  _burst(dest, kind, t, a, peak, d, filter = null, rate = 1) {
    const s = this._src(kind, false);
    s.playbackRate.value = rate;
    const g = this._gain(0);
    this._env(g, t, a, peak, d);
    let n = s;
    if (filter) {
      const f = this._filter(filter[0], filter[1], filter[2] ?? 0.707);
      if (filter[3]) f.frequency.exponentialRampToValueAtTime(filter[3], t + a + d);
      n.connect(f);
      n = f;
    }
    n.connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + a + d + 0.05);
    return s;
  }

  // ---------------------------------------------------------------- one-shots

  sfx(name, { gain = 1, pan = 0, rate = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const now = c.currentTime;
    // rate-limit identical UI sounds
    const last = this._lastSfx.get(name) ?? -1;
    if (now - last < (name === 'uiHover' ? 0.06 : 0.015)) return;
    this._lastSfx.set(name, now);
    const t = now + 0.005;
    const sim = !name.startsWith('ui');
    const out = this._gain(gain);
    let dest = out;
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      p.connect(sim ? this.simBus : this.sfxBus);
    } else out.connect(sim ? this.simBus : this.sfxBus);
    const r = rate * (0.94 + Math.random() * 0.12);
    switch (name) {
      case 'toggle':
      case 'toggleHeavy': {
        const k = name === 'toggleHeavy' ? 0.7 : 1;
        this._burst(dest, 'white', t, 0.0005, 0.9, 0.012, ['bandpass', 3800 * k * r, 1.4]);
        this._tone(dest, 'triangle', 2300 * k * r, t, 0.0005, 0.25, 0.03);
        this._tone(dest, 'sine', 190 * k, t, 0.001, 0.5, 0.05);
        this._burst(dest, 'white', t + 0.018, 0.0005, 0.35, 0.01, ['bandpass', 5200 * r, 2]);
        break;
      }
      case 'rotary':
        this._burst(dest, 'white', t, 0.0005, 0.8, 0.014, ['bandpass', 2400 * r, 1.6]);
        this._tone(dest, 'triangle', 1250 * r, t, 0.0005, 0.22, 0.04);
        this._tone(dest, 'sine', 240, t, 0.001, 0.3, 0.04);
        break;
      case 'cbIn':
        this._burst(dest, 'white', t, 0.0005, 0.7, 0.016, ['bandpass', 1800 * r, 1.2]);
        this._tone(dest, 'sine', 420 * r, t, 0.001, 0.35, 0.05);
        break;
      case 'cbOut':
        this._burst(dest, 'white', t, 0.0005, 0.8, 0.02, ['bandpass', 2600 * r, 1]);
        this._tone(dest, 'sine', 640 * r, t, 0.001, 0.3, 0.06, { freqEnd: 380 });
        break;
      case 'guardOpen':
      case 'guardClose':
        this._burst(dest, 'white', t, 0.0005, 0.5, 0.01, ['bandpass', 3000 * r, 1.2]);
        this._burst(dest, 'white', t + 0.03, 0.0005, 0.6, 0.014, ['bandpass', name === 'guardOpen' ? 2200 : 1700, 1.2]);
        this._tone(dest, 'sine', 300, t + 0.03, 0.001, 0.2, 0.04);
        break;
      case 'button':
        this._burst(dest, 'white', t, 0.0005, 0.6, 0.012, ['bandpass', 2900 * r, 1.4]);
        this._tone(dest, 'sine', 900 * r, t, 0.001, 0.18, 0.035);
        break;
      case 'dskyKey':
        this._burst(dest, 'white', t, 0.0005, 0.55, 0.009, ['bandpass', 4200 * r, 2]);
        this._tone(dest, 'square', 1800 * r, t, 0.0005, 0.04, 0.02);
        this._tone(dest, 'sine', 260, t, 0.001, 0.25, 0.03);
        break;
      case 'thumbwheel':
        for (let i = 0; i < 3; i++) this._burst(dest, 'white', t + i * 0.022, 0.0005, 0.35, 0.008, ['bandpass', 3400, 2]);
        break;
      case 'uiHover':
        this._tone(dest, 'sine', 5200 * r, t, 0.002, 0.02, 0.03);
        break;
      case 'uiClick':
        this._tone(dest, 'sine', 1150 * r, t, 0.002, 0.12, 0.05, { freqEnd: 900 });
        this._burst(dest, 'white', t, 0.001, 0.08, 0.01, ['highpass', 4000]);
        break;
      case 'uiConfirm':
        this._tone(dest, 'sine', 660, t, 0.004, 0.13, 0.18);
        this._tone(dest, 'sine', 990, t + 0.07, 0.004, 0.12, 0.3);
        this._tone(dest, 'triangle', 1980, t + 0.07, 0.004, 0.025, 0.25);
        break;
      case 'uiBack':
        this._tone(dest, 'sine', 700, t, 0.004, 0.12, 0.12, { freqEnd: 420 });
        break;
      case 'uiWarn':
        this._tone(dest, 'square', 440, t, 0.004, 0.05, 0.12);
        this._tone(dest, 'square', 440, t + 0.18, 0.004, 0.05, 0.12);
        break;
      case 'uiAttention':
        [784, 988, 1175].forEach((f, i) => this._tone(dest, 'sine', f, t + i * 0.07, 0.004, 0.08, 0.25));
        break;
      case 'pyro':
        this._burst(dest, 'white', t, 0.001, 1.4, 0.18, ['lowpass', 5000, 0.7, 300]);
        this._burst(dest, 'brown', t, 0.002, 1.8, 0.7, ['lowpass', 400]);
        this._tone(dest, 'sine', 62, t, 0.003, 1.2, 0.5, { freqEnd: 38 });
        break;
      case 'clunk':
        this._burst(dest, 'brown', t, 0.002, 1.2, 0.25, ['bandpass', 320, 1.2]);
        this._tone(dest, 'sine', 92, t, 0.002, 0.9, 0.22);
        this._tone(dest, 'triangle', 610, t, 0.001, 0.12, 0.2);
        break;
      case 'latch': {
        // capture latch: metallic clank with inharmonic partials
        this._burst(dest, 'white', t, 0.0005, 1.0, 0.04, ['bandpass', 2600, 1]);
        for (const [f, a, d] of [[523, 0.3, 0.5], [1270, 0.18, 0.35], [2310, 0.12, 0.25], [3640, 0.06, 0.18]]) this._tone(dest, 'sine', f * r, t, 0.001, a, d);
        this._tone(dest, 'sine', 110, t, 0.002, 0.6, 0.15);
        break;
      }
      case 'latchRipple':
        // the 12 docking-ring latches firing in a ripple (unmistakable bang-bang-bang)
        for (let i = 0; i < 12; i++) setTimeout(() => this.sfx('latch', { gain: 0.6 + Math.random() * 0.4, pan: Math.sin(i * 1.7) * 0.4 }), i * 55 + Math.random() * 40);
        break;
      case 'bang':
        this._burst(dest, 'white', t, 0.001, 1.8, 0.35, ['lowpass', 6000, 0.7, 200]);
        this._burst(dest, 'brown', t, 0.002, 2.4, 1.6, ['lowpass', 300]);
        this._tone(dest, 'sine', 48, t, 0.003, 1.6, 1.2, { freqEnd: 30 });
        for (let i = 0; i < 6; i++) this._burst(dest, 'white', t + 0.15 + i * 0.09 + Math.random() * 0.05, 0.001, 0.4, 0.06, ['bandpass', 1500 + Math.random() * 2500, 2]);
        break;
      case 'thud':
        this._burst(dest, 'brown', t, 0.003, 1.4, 0.5, ['lowpass', 220]);
        this._tone(dest, 'sine', 70, t, 0.003, 1.0, 0.35, { freqEnd: 45 });
        break;
      case 'quindarIn':
        this._tone(dest, 'sine', 2525, t, 0.004, 0.16, 0.24);
        break;
      case 'quindarOut':
        this._tone(dest, 'sine', 2475, t, 0.004, 0.16, 0.24);
        break;
      case 'squelch':
        // push-to-talk key click and the receiver's squelch tail, band-limited like the S-band voice
        this._burst(dest, 'white', t, 0.001, 0.5, 0.012, ['bandpass', 1800, 1.2]);
        this._burst(dest, 'white', t + 0.012, 0.004, 0.32, 0.11, ['bandpass', 1400, 0.8, 900]);
        this._tone(dest, 'sine', 120, t, 0.001, 0.12, 0.03);
        break;
      case 'shutter':
        this._burst(dest, 'white', t, 0.0005, 0.7, 0.02, ['bandpass', 3000, 1.5]);
        this._burst(dest, 'white', t + 0.06, 0.0005, 0.5, 0.03, ['bandpass', 2000, 1.2]);
        break;
      case 'paper':
        this._burst(dest, 'white', t, 0.03, 0.25, 0.3, ['bandpass', 3500, 0.8]);
        this._burst(dest, 'white', t + 0.12, 0.02, 0.18, 0.2, ['bandpass', 5000, 0.8]);
        break;
      case 'phoneRing':
        for (let i = 0; i < 2; i++) {
          this._tone(dest, 'sine', 440, t + i * 0.45, 0.005, 0.08, 0.35);
          this._tone(dest, 'sine', 480, t + i * 0.45, 0.005, 0.08, 0.35);
        }
        break;
      case 'tube':
        this._burst(dest, 'pink', t, 0.08, 0.4, 0.6, ['bandpass', 600, 0.8, 2400]);
        this._tone(dest, 'sine', 140, t + 0.6, 0.002, 0.5, 0.15);
        break;
      case 'footstep':
        this._burst(dest, 'brown', t, 0.002, 0.6, 0.08, ['lowpass', 500]);
        this._burst(dest, 'white', t, 0.001, 0.12, 0.04, ['bandpass', 2500, 1]);
        break;
      case 'chair':
        this._burst(dest, 'pink', t, 0.02, 0.3, 0.25, ['bandpass', 900, 3, 600]);
        break;
      case 'masterAlarm':
        for (let i = 0; i < 4; i++) {
          this._tone(dest, 'square', 1500, t + i * 0.25, 0.004, 0.06, 0.12);
          this._tone(dest, 'square', 750, t + i * 0.25 + 0.125, 0.004, 0.06, 0.12);
        }
        break;
      case 'cwTone':
        this._tone(dest, 'square', 1000, t, 0.004, 0.05, 0.3);
        break;
      case 'rcsPop':
        this._burst(dest, 'white', t, 0.0008, 0.5, 0.05, ['bandpass', 900 * r, 0.9]);
        this._tone(dest, 'sine', 120, t, 0.001, 0.35, 0.06);
        break;
      case 'splash':
        this._burst(dest, 'white', t, 0.01, 1.2, 1.4, ['lowpass', 3000, 0.7, 400]);
        this._burst(dest, 'brown', t, 0.01, 1.6, 1.0, ['lowpass', 250]);
        break;
      case 'chute':
        this._burst(dest, 'pink', t, 0.08, 0.9, 0.8, ['bandpass', 500, 0.6, 1600]);
        this._tone(dest, 'sine', 80, t + 0.7, 0.003, 0.8, 0.3);
        break;
      case 'ignition':
        this._burst(dest, 'brown', t, 0.05, 1.2, 1.5, ['lowpass', 180]);
        this._burst(dest, 'white', t, 0.002, 0.5, 0.2, ['bandpass', 800, 0.7]);
        break;
      default:
        break;
    }
    setTimeout(() => out.disconnect(), 4000);
  }

  // ---------------------------------------------------------------- loops

  loop(name, opts = {}) {
    if (!this.ctx) return new DummyLoop();
    const c = this.ctx;
    const out = this._gain(0);
    const amb = ['cabinFans', 'suitLoop', 'pumps', 'mocrRoom', 'static', 'breathing'].includes(name);
    out.connect(amb ? this.simAmb : this.simBus);
    const nodes = [];
    const params = {};
    const start = (s) => {
      s.start(0, Math.random() * 1.5);
      nodes.push(s);
      return s;
    };
    const chain = (...ns) => {
      for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
      return ns[ns.length - 1];
    };
    const master = this._filter('lowpass', 20000, 0.5);
    master.connect(out);
    params.muffle = master.frequency;
    switch (name) {
      case 'rumbleSIC':
      case 'rumbleSII':
      case 'rumbleSIVB': {
        const big = name === 'rumbleSIC';
        const base = start(this._src('brown'));
        const lp = this._filter('lowpass', big ? 160 : 220, 0.8);
        const bg = this._gain(big ? 1.4 : 0.9);
        chain(base, lp, bg, master);
        const roar = start(this._src('pink'));
        const bp = this._filter('bandpass', big ? 380 : 650, 0.45);
        const rg = this._gain(big ? 0.9 : 0.6);
        chain(roar, bp, rg, master);
        const cr = start(this._src('crackle'));
        const cbp = this._filter('bandpass', big ? 1100 : 1700, 0.5);
        const cg = this._gain(big ? 1.1 : 0.4);
        chain(cr, cbp, cg, master);
        params.crackle = cg.gain;
        const sub = c.createOscillator();
        sub.frequency.value = big ? 31 : 42;
        const sg = this._gain(big ? 0.55 : 0.3);
        const lfo = c.createOscillator();
        lfo.frequency.value = 3.3;
        const lg = this._gain(0.25);
        chain(lfo, lg);
        lg.connect(sg.gain);
        chain(sub, sg, master);
        sub.start();
        lfo.start();
        nodes.push(sub, lfo);
        params.sub = sg.gain;
        break;
      }
      case 'sps':
      case 'dps':
      case 'aps': {
        const base = start(this._src('brown'));
        const lp = this._filter('lowpass', name === 'sps' ? 140 : 180, 0.9);
        chain(base, lp, this._gain(1.2), master);
        const hiss = start(this._src('pink'));
        chain(hiss, this._filter('bandpass', name === 'aps' ? 900 : 600, 0.6), this._gain(0.35), master);
        const hum = c.createOscillator();
        hum.type = 'sawtooth';
        hum.frequency.value = name === 'sps' ? 55 : 63;
        chain(hum, this._filter('lowpass', 200), this._gain(0.08), master);
        hum.start();
        nodes.push(hum);
        params.rate = hum.frequency;
        break;
      }
      case 'rcs': {
        const s = start(this._src('crackle'));
        s.playbackRate.value = 0.5;
        chain(s, this._filter('bandpass', 700, 0.8), this._gain(1.6), master);
        const n = start(this._src('pink'));
        chain(n, this._filter('bandpass', 1400, 0.6), this._gain(0.25), master);
        break;
      }
      case 'wind': {
        const n = start(this._src('pink'));
        const bp = this._filter('bandpass', 500, 0.6);
        chain(n, bp, this._gain(1.4), master);
        params.pitch = bp.frequency;
        const b = start(this._src('brown'));
        chain(b, this._filter('lowpass', 200), this._gain(0.8), master);
        break;
      }
      case 'plasma': {
        const b = start(this._src('brown'));
        chain(b, this._filter('lowpass', 260, 0.9), this._gain(1.6), master);
        const cr = start(this._src('crackle'));
        cr.playbackRate.value = 0.7;
        chain(cr, this._filter('bandpass', 600, 0.6), this._gain(0.7), master);
        const p = start(this._src('pink'));
        chain(p, this._filter('bandpass', 1200, 0.5), this._gain(0.35), master);
        break;
      }
      case 'cabinFans': {
        const n = start(this._src('pink'));
        chain(n, this._filter('lowpass', 1600), this._gain(0.35), master);
        for (const [f, a] of [[400, 0.022], [800, 0.01], [1200, 0.004], [117, 0.02]]) {
          const o = c.createOscillator();
          o.frequency.value = f;
          chain(o, this._gain(a), master);
          o.start();
          nodes.push(o);
        }
        break;
      }
      case 'suitLoop':
      case 'pumps': {
        const n = start(this._src(name === 'pumps' ? 'brown' : 'pink'));
        chain(n, this._filter('bandpass', name === 'pumps' ? 160 : 900, 0.8), this._gain(0.5), master);
        const o = c.createOscillator();
        o.frequency.value = name === 'pumps' ? 98 : 233;
        chain(o, this._gain(0.015), master);
        o.start();
        nodes.push(o);
        break;
      }
      case 'static': {
        const n = start(this._src('white'));
        chain(n, this._filter('bandpass', 1800, 0.5), this._gain(0.12), master);
        const cr = start(this._src('crackle'));
        chain(cr, this._filter('highpass', 1200), this._gain(0.25), master);
        break;
      }
      case 'mocrRoom': {
        const n = start(this._src('pink'));
        chain(n, this._filter('lowpass', 900), this._gain(0.4), master);
        // distant murmur: band-limited noise with slow amplitude modulation
        const m = start(this._src('pink'));
        const bp = this._filter('bandpass', 420, 1.5);
        const ag = this._gain(0.2);
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.7;
        const lg = this._gain(0.18);
        lfo.connect(lg).connect(ag.gain);
        lfo.start();
        nodes.push(lfo);
        chain(m, bp, ag, master);
        const hum = c.createOscillator();
        hum.frequency.value = 60;
        chain(hum, this._gain(0.01), master);
        hum.start();
        nodes.push(hum);
        break;
      }
      case 'masterAlarmTone': {
        const o = c.createOscillator();
        o.type = 'square';
        const g = this._gain(0.06);
        // alternate 1.5 kHz / 750 Hz like the CM master alarm warble
        const lfo = c.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 4;
        const lg = this._gain(375);
        o.frequency.value = 1125;
        lfo.connect(lg).connect(o.frequency);
        chain(o, this._filter('lowpass', 4000), g, master);
        o.start();
        lfo.start();
        nodes.push(o, lfo);
        break;
      }
      case 'breathing': {
        const n = start(this._src('pink'));
        const bp = this._filter('bandpass', 1100, 0.7);
        const g = this._gain(0);
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.25;
        const lg = this._gain(0.25);
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        nodes.push(lfo);
        chain(n, bp, g, master);
        break;
      }
      default:
        break;
    }
    const handle = {
      name,
      setGain: (g, tc = 0.12) => out.gain.setTargetAtTime(Math.max(0, g), c.currentTime, tc),
      setRate: (r) => {
        for (const n of nodes) if (n.playbackRate) n.playbackRate.setTargetAtTime(r, c.currentTime, 0.1);
      },
      setParam: (k, v, tc = 0.1) => params[k]?.setTargetAtTime?.(v, c.currentTime, tc),
      stop: (fade = 0.3) => {
        out.gain.setTargetAtTime(0, c.currentTime, fade / 3);
        setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {
              /* already stopped */
            }
          }
          out.disconnect();
        }, fade * 1000 + 200);
        this._loops.delete(handle);
      },
    };
    if (opts.gain !== undefined) handle.setGain(opts.gain, 0.05);
    this._loops.add(handle);
    return handle;
  }

  // ---------------------------------------------------------------- radio & clips

  /** → { voice, male } — a male voice whenever the platform has one for `lang`; otherwise the
   *  voice that is not known to be female (Android names voices by locale only), flagged so the
   *  caller pitches it further down. Distinct speakers get distinct voices when there are several. */
  _pickVoice(who, lang) {
    const voices = (this._voices ?? []).filter((v) => v.lang?.toLowerCase().startsWith(lang) && !NOVELTY_VOICE.test(v.name));
    if (!voices.length) return { voice: null, male: false };
    const locales = lang === 'es' ? ES_LOCALES : EN_LOCALES;
    const locRank = (v) => {
      const l = v.lang.toLowerCase().replace('_', '-');
      const i = locales.findIndex((p) => l.startsWith(p));
      return i < 0 ? locales.length : i;
    };
    // neural "Natural" voices first, then the preferred locales
    const score = (v) => (/natural|neural|premium|enhanced/i.test(v.name) ? 0 : 10) + locRank(v);
    const isFemale = (v) => FEMALE_VOICE.test(plainName(v.name)) || FEMALE_VOICE.test(plainName(v.voiceURI));
    const isMale = (v) => !isFemale(v) && (MALE_VOICE.test(plainName(v.name)) || MALE_VOICE.test(plainName(v.voiceURI)));
    const pick = (list) => {
      const ranked = [...list].sort((a, b) => score(a) - score(b));
      // the best few, so CAPCOM, FLIGHT and each crewman sound different
      const pool = ranked.slice(0, Math.min(ranked.length, 4));
      return pool[(VOICE_STYLE[who]?.pref ?? who?.length ?? 0) % pool.length];
    };
    const males = voices.filter(isMale);
    if (males.length) return { voice: pick(males), male: true };
    const neutral = voices.filter((v) => !isFemale(v));
    return { voice: pick(neutral.length ? neutral : voices), male: false };
  }

  _speak(line, mode) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || mode === 'text') {
        setTimeout(resolve, (line.durationS ?? 2) * 1000);
        return;
      }
      const lang = mode === 'es' ? 'es' : 'en';
      const text = lang === 'es' ? line.es ?? line.en : line.en ?? line.es;
      const u = new SpeechSynthesisUtterance(text);
      const { voice: v, male } = this._pickVoice(line.who, lang);
      if (v) u.voice = v;
      u.lang = v?.lang ?? (lang === 'es' ? 'es-419' : 'en-US');
      const st = VOICE_STYLE[line.who] ?? { pitch: 0.8 + ((line.who?.length ?? 3) % 5) * 0.025, rate: 1.02 };
      // no male voice on this device: push the available one down to a baritone range
      u.pitch = male ? st.pitch : Math.max(0.5, st.pitch * 0.72);
      u.rate = st.rate * (line.urgent ? 1.12 : 1);
      u.volume = Math.min(1, store.settings.volumeVoice * store.settings.volumeMaster * 1.1);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      const timer = setTimeout(finish, ((line.durationS ?? 3) + 5) * 1000);
      speechSynthesis.speak(u);
    });
  }

  /** Radio line: Quindar + static + voice (NASA clip if line.clip, else speech synthesis). */
  async radio(line) {
    const mode = store.settings.voiceMode;
    const ground = GROUND.has(line.who);
    const ag = line.channel === 'ag';
    const useStatic = this.ctx && store.settings.radioStatic && (ag || line.channel === 'loop');
    let bed = null;
    this.duck(0.35, (line.durationS ?? 3) + 1);
    if (ag && ground && store.settings.quindar && this.ctx) {
      this.sfx('quindarIn');
      await new Promise((r) => setTimeout(r, 260));
    }
    const clip = line.clip && NASA_CLIPS[line.clip];
    if (useStatic) {
      // a synthesized voice is studio-clean: a denser bed sells the radio link (NASA clips carry their own)
      bed = this.loop('static');
      bed.setGain(ag ? (clip ? 0.4 : 0.62) : 0.22, 0.03);
      this.sfx('squelch', { gain: ag ? 0.9 : 0.45 });
    }
    try {
      if (clip) await this.clip(line.clip, { radio: false });
      else await this._speak(line, mode);
    } finally {
      if (useStatic) this.sfx('squelch', { gain: ag ? 0.8 : 0.4 });
      bed?.stop(0.15);
    }
    if (ag && ground && store.settings.quindar && this.ctx) this.sfx('quindarOut');
  }

  /** NASA public-domain recording. {radio: true} adds the air-to-ground band-pass. */
  clip(name, { radio = false } = {}) {
    const url = NASA_CLIPS[name];
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const a = new Audio(`${import.meta.env.BASE_URL}${url}`);
      a.crossOrigin = 'anonymous';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 45000);
      a.onended = finish;
      a.onerror = finish;
      if (this.ctx) {
        try {
          const src = this.ctx.createMediaElementSource(a);
          let n = src;
          if (radio) {
            const hp = this._filter('highpass', 300);
            const lp = this._filter('lowpass', 3400);
            n.connect(hp);
            hp.connect(lp);
            n = lp;
          }
          const g = this._gain(1.6);
          n.connect(g).connect(this.voiceBus);
        } catch {
          a.volume = store.settings.volumeVoice * store.settings.volumeMaster;
        }
      } else a.volume = store.settings.volumeVoice * store.settings.volumeMaster;
      this._clips ??= new Set();
      this._clips.add(a);
      a.addEventListener('ended', () => this._clips.delete(a));
      a.play().catch(finish);
    });
  }

  // ---------------------------------------------------------------- music

  music(name) {
    if (!this.ctx) {
      this._pendingMusic = name;
      return;
    }
    if (name === this._musicName) return;
    this._musicName = name;
    this._music?.stop();
    this._music = name ? this._startMusic(name) : null;
  }

  _startMusic(name) {
    const c = this.ctx;
    const out = this._gain(0);
    out.connect(this.musicBus);
    out.connect(this.reverb);
    const t0 = c.currentTime;
    out.gain.setTargetAtTime(1, t0, 2.5);
    const voices = new Set();
    let alive = true;
    const progressions = {
      menu: [[50, 57, 62, 66, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 62], [45, 52, 57, 61, 64]],
      briefing: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59]],
      tension: [[38, 45, 50, 51], [38, 44, 50, 53], [36, 43, 48, 51], [37, 44, 49, 52]],
      triumph: [[48, 55, 60, 64, 67, 74], [53, 60, 65, 69, 72], [55, 62, 67, 71, 74], [48, 55, 60, 64, 67, 76]],
      sad: [[45, 52, 57, 60], [41, 48, 53, 57], [38, 45, 50, 53], [40, 47, 52, 56]],
    };
    const prog = progressions[name] ?? progressions.menu;
    const dur = name === 'tension' ? 6 : name === 'triumph' ? 5 : 9;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const pad = (notes, t, d) => {
      for (const m of notes) {
        for (const det of [-7, 6]) {
          const o = c.createOscillator();
          o.type = name === 'tension' ? 'sawtooth' : 'triangle';
          o.frequency.value = mtof(m);
          o.detune.value = det;
          const f = this._filter('lowpass', name === 'tension' ? 500 : 1400, 0.6);
          const g = this._gain(0);
          const peak = 0.05 / notes.length;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(peak, t + d * 0.35);
          g.gain.linearRampToValueAtTime(peak * 0.8, t + d * 0.75);
          g.gain.linearRampToValueAtTime(0.0001, t + d * 1.15);
          o.connect(f).connect(g).connect(out);
          o.start(t);
          o.stop(t + d * 1.2);
          voices.add(o);
          o.onended = () => voices.delete(o);
        }
      }
    };
    const bell = (m, t, a = 0.05) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(m);
      const o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = mtof(m) * 2.76;
      const g = this._gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(a, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      const g2 = this._gain(0.25);
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(out);
      o.start(t);
      o2.start(t);
      o.stop(t + 3.6);
      o2.stop(t + 3.6);
    };
    let i = 0;
    let next = t0 + 0.1;
    const tick = () => {
      if (!alive) return;
      while (next < c.currentTime + 2) {
        const chord = prog[i % prog.length];
        pad(chord, next, dur);
        if (name !== 'tension') {
          const top = chord[chord.length - 1] + 12;
          for (let k = 0; k < 3; k++) if (Math.random() < 0.6) bell(top - [0, 3, 5, 7, 12][Math.floor(Math.random() * 5)], next + 1 + Math.random() * (dur - 2), 0.03);
        } else if (Math.random() < 0.7) {
          // low pulse
          for (let k = 0; k < 4; k++) bell(26, next + k * 1.5, 0.08);
        }
        next += dur;
        i++;
      }
      timer = setTimeout(tick, 500);
    };
    let timer = setTimeout(tick, 0);
    return {
      stop: () => {
        alive = false;
        clearTimeout(timer);
        out.gain.setTargetAtTime(0, c.currentTime, 0.8);
        setTimeout(() => {
          for (const v of voices) {
            try {
              v.stop();
            } catch {
              /* ok */
            }
          }
          out.disconnect();
        }, 4000);
      },
    };
  }

  // ---------------------------------------------------------------- mixing

  duck(amount = 0.4, seconds = 2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.setTargetAtTime(amount, t, 0.15);
    this.simAmb.gain.setTargetAtTime(Math.max(amount, 0.5), t, 0.15);
    clearTimeout(this._duckT);
    this._duckT = setTimeout(() => {
      const t2 = this.ctx.currentTime;
      this.duckGain.gain.setTargetAtTime(1, t2, 0.6);
      this.simAmb.gain.setTargetAtTime(1, t2, 0.6);
    }, seconds * 1000);
  }

  setPaused(p) {
    this.paused = p;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.simBus.gain.setTargetAtTime(p ? 0 : 1, t, 0.08);
      this.simAmb.gain.setTargetAtTime(p ? 0 : 1, t, 0.08);
    }
    if ('speechSynthesis' in window) {
      if (p) speechSynthesis.pause();
      else speechSynthesis.resume();
    }
    for (const a of this._clips ?? []) {
      if (p) a.pause();
      else a.play().catch(() => {});
    }
  }

  /** Stop everything that belongs to a scene (loops, voices, clips). Music keeps going. */
  stopAll() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    for (const l of [...this._loops]) l.stop(0.2);
    for (const a of this._clips ?? []) a.pause();
    this._clips?.clear();
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.simBus.gain.setTargetAtTime(1, t, 0.05);
      this.simAmb.gain.setTargetAtTime(1, t, 0.05);
    }
  }
}
