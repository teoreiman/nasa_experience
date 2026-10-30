// Game shell: one WebGLRenderer, the HTML UI root, global services, scene switching and the loop.
// Scenes are classes with: async enter(params), exit(), update(dt), render(), resize(w, h).

import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { store } from './Store.js';
import { h } from './dom.js';
import { randomFacts } from '../data/facts.js';

// Saturn V side profile (LES → S-IC), viewBox 0 0 40 230, used by the loading screen.
const SATURN_PATH =
  'M20 0 L20.6 7 L21 18 L22.4 18 L22.4 21 L25 33 L25 40 L28.6 40 L28.6 42 L27.4 42 L30.6 60 L30.6 61 ' +
  'L30.6 94 L33 98 L35.3 101 L35.3 126 L35.3 128 L35.3 158 L35.3 160 L35.3 204 L38.5 208 L39.5 221 L35.5 221 ' +
  'L34.6 226 L30.2 226 L29.4 221 L24.2 221 L23.4 228 L16.6 228 L15.8 221 L10.6 221 L9.8 226 L5.4 226 L4.5 221 ' +
  'L0.5 221 L1.5 208 L4.7 204 L4.7 160 L4.7 128 L4.7 101 L7 98 L9.4 94 L9.4 61 L12.6 42 L11.4 42 L11.4 40 ' +
  'L15 40 L15 33 L17.6 21 L17.6 18 L19 18 L19.4 7 Z';

export const QUALITY_PROFILES = {
  low: { name: 'low', pixelRatio: 0.85, antialias: false, shadows: false, textures: '2k', particles: 0.45, bloom: false, anisotropy: 2, panelPxPerMm: 1.6, terrainDetail: 0.5 },
  medium: { name: 'medium', pixelRatio: 1, antialias: true, shadows: true, textures: '2k', particles: 0.75, bloom: false, anisotropy: 4, panelPxPerMm: 2.0, terrainDetail: 0.75 },
  high: { name: 'high', pixelRatio: 1.5, antialias: true, shadows: true, textures: '4k', particles: 1, bloom: true, anisotropy: 8, panelPxPerMm: 2.5, terrainDetail: 1 },
};

function detectGpuTier(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const s = String(name);
    // Desktop Macs report "Apple M1…M4" (Chrome) or just "Apple GPU" (Safari): all are fast.
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(s)) return { tier: 'low', gpu: s };
    if (/Apple (M\d|GPU)/i.test(s) && !mobile) return { tier: 'high', gpu: s };
    if (/Apple GPU/i.test(s)) return { tier: 'medium', gpu: s };
    if (/Intel.*(UHD|HD) Graphics|Mali|Adreno|PowerVR/i.test(s)) return { tier: 'low', gpu: s };
    if (/Iris|Radeon\(TM\) Graphics|Vega [0-9]/i.test(s)) return { tier: 'medium', gpu: s };
    return { tier: 'high', gpu: s };
  } catch {
    return { tier: 'medium', gpu: 'unknown' };
  }
}

/** Shared texture cache. */
class Assets {
  constructor(game) {
    this.game = game;
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();
  }

  /** Loads /textures/<name>; `{srgb: true}` for colour maps. Honours the quality tier for *_4k/_2k pairs:
   *  texture('earth_day', {sizes: ['4k','2k']}) → earth_day_4k.jpg on high, earth_day_2k.jpg otherwise. */
  texture(name, { srgb = true, sizes = null, ext = 'jpg' } = {}) {
    let file = name;
    if (sizes) {
      const want = this.game.quality.textures;
      const size = sizes.includes(want) ? want : sizes[sizes.length - 1];
      file = `${name}_${size}.${ext}`;
    } else if (!/\.[a-z0-9]+$/i.test(name)) file = `${name}.${ext}`;
    const url = `${import.meta.env.BASE_URL}textures/${file}`;
    if (this.cache.has(url)) return this.cache.get(url);
    const p = new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = Math.min(this.game.quality.anisotropy, this.game.renderer.capabilities.getMaxAnisotropy());
          resolve(tex);
        },
        undefined,
        (err) => reject(new Error(`No se pudo cargar la textura ${url}: ${err?.message ?? err}`)),
      );
    });
    this.cache.set(url, p);
    return p;
  }
}

export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.bus = new EventBus();
    this.store = store;
    this.input = new Input(window);
    this.scenes = new Map();
    this.scene = null;
    this.sceneName = null;
    this.audio = null; // set in main.js (AudioEngine)
    this.time = 0;
    this.fps = 60;
    this._last = performance.now();
    this._switching = false;

    const probe = document.createElement('canvas').getContext('webgl2');
    const { tier, gpu } = probe ? detectGpuTier(probe) : { tier: 'low', gpu: 'no-webgl2' };
    this.gpuName = gpu;
    this.detectedTier = tier;
    this.quality = this._resolveQuality();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.assets = new Assets(this);

    this.fpsEl = h('div', { class: 'fps-counter', hidden: !store.settings.showFps });
    document.body.append(this.fpsEl);

    store.onChange(({ kind, key }) => {
      if (kind !== 'settings') return;
      if (key === 'graphics' || key === 'renderScale' || key === '*') {
        this.quality = this._resolveQuality();
        this.renderer.shadowMap.enabled = this.quality.shadows;
        this.resize();
      }
      if (key === 'showFps' || key === '*') this.fpsEl.hidden = !store.settings.showFps;
      this.bus.emit('settings:changed', { key });
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _resolveQuality() {
    const pref = store.settings.graphics;
    const tier = pref === 'auto' ? this.detectedTier : pref;
    const q = { ...(QUALITY_PROFILES[tier] ?? QUALITY_PROFILES.medium) };
    q.pixelRatio = Math.min(q.pixelRatio, window.devicePixelRatio || 1) * (store.settings.renderScale || 1);
    return q;
  }

  get width() {
    return window.innerWidth;
  }

  get height() {
    return window.innerHeight;
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.scene?.resize?.(this.width, this.height);
  }

  /** @param {string} name @param {() => Promise<{default: any}>} loader */
  registerScene(name, loader) {
    this.scenes.set(name, loader);
  }

  async goto(name, params = {}) {
    if (this._switching) return;
    this._switching = true;
    const loading = this.showLoading(params.loadingText ?? 'Cargando…', { patch: params.loadingPatch });
    try {
      const loader = this.scenes.get(name);
      if (!loader) throw new Error(`Escena desconocida: ${name}`);
      const mod = await loader();
      if (this.scene) {
        try {
          await this.scene.exit?.();
        } catch (err) {
          console.error('[game] scene exit failed', err);
        }
      }
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.input.exitPointerLock();
      const SceneClass = mod.default;
      const scene = new SceneClass(this);
      this.scene = scene;
      this.sceneName = name;
      await scene.enter?.(params);
      scene.resize?.(this.width, this.height);
      this.bus.emit('scene:changed', { name, params });
    } catch (err) {
      console.error(`[game] failed to enter scene "${name}"`, err);
      this.showError(err);
    } finally {
      loading.remove();
      this._switching = false;
    }
  }

  /** Mission-style loading screen. Returns { remove() } (fades out). opts: { patch?: svgMarkup } */
  showLoading(text, opts = {}) {
    const facts = randomFacts(6);
    const factEl = h('span', null, facts[0]);
    const countEl = h('div', { class: 'ls-count' }, 'T−00:00:10');
    const svg = (cls) => `<svg class="${cls}" viewBox="0 0 40 230" xmlns="http://www.w3.org/2000/svg"><path d="${SATURN_PATH}"/></svg>`;
    const el = h(
      'div',
      { class: 'loading-screen' },
      h('div', { class: 'ls-stars' }),
      h('div', { class: 'ls-earth' }),
      h(
        'div',
        { class: 'ls-center' },
        h('div', { class: 'ls-rocket', html: svg('base') + `<div class="fill">${svg('lit')}</div>` }),
        h(
          'div',
          { class: 'ls-info' },
          opts.patch ? h('div', { class: 'ls-patch', html: opts.patch }) : null,
          h('div', { class: 'ls-kicker' }, 'Preparando la misión'),
          h('div', { class: 'ls-title' }, text),
          countEl,
          h('div', { class: 'ls-bar' }, h('i')),
        ),
      ),
      h('div', { class: 'ls-fact' }, h('b', null, '¿Sabías que…? '), factEl),
    );
    document.body.append(el);
    let n = 10;
    let k = 0;
    const tick = setInterval(() => {
      if (n > 1) n--;
      countEl.textContent = n > 1 ? `T−00:00:${String(n).padStart(2, '0')}` : 'T−00:00:01 · HOLD';
    }, 650);
    const rot = setInterval(() => {
      k = (k + 1) % facts.length;
      factEl.style.opacity = '0';
      setTimeout(() => {
        factEl.textContent = facts[k];
        factEl.style.opacity = '1';
      }, 350);
    }, 4600);
    return {
      remove: () => {
        clearInterval(tick);
        clearInterval(rot);
        countEl.textContent = 'IGNICIÓN';
        el.classList.add('done');
        setTimeout(() => el.remove(), 650);
      },
    };
  }

  showError(err) {
    const el = h(
      'div',
      { class: 'error-overlay' },
      h('h2', null, 'Algo salió mal'),
      h('pre', null, String(err?.stack ?? err)),
      h('button', { class: 'btn', on: { click: () => { el.remove(); this.goto('menu'); } } }, 'Volver al menú'),
    );
    document.body.append(el);
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      this.time += dt;
      this.fps += (1 / dt - this.fps) * 0.05;
      if (store.settings.showFps) this.fpsEl.textContent = `${this.fps.toFixed(0)} fps · ${this.quality.name}`;
      this.input.pollGamepad();
      const scene = this.scene;
      if (scene && !this._switching) {
        try {
          scene.update?.(dt);
          scene.render?.();
        } catch (err) {
          console.error('[game] frame error', err);
          if (!this._frameErrorShown) {
            this._frameErrorShown = true;
            this.bus.emit('game:frameError', err);
          }
        }
      }
      this.input.endFrame();
    };
    requestAnimationFrame(loop);
  }
}
