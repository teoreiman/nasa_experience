// Menu cinematics: the real game engine (Saturn V physics + FlightView: launch site, steam, F-1
// plumes, staging bodies…) filmed by a scripted "director", plus the Earthrise from lunar orbit.
// Shots (≈75 s loop, cuts through black):
//   1. dawn on Pad 39A — crane up the umbilical tower       (T−30 → T−19)
//   2. ignition & liftoff — long lens from the press site   (T−8 → T+4)
//   3. tower camera looking up as the vehicle clears it     (T+4 → T+12)
//   4. ascent from the beach — telephoto, white trail       (T+38 → T+50)
//   5. staging — S-II camera looking aft as the S-IC falls  (T+156 → T+172)
//   6. Earthrise over the lunar limb                         (12 s)
// createCinematicBackdrop(game, { shots }) → { loading, update(dt), render(), resize(w,h), setFocus(k), dispose() }

import * as THREE from 'three';
import { Simulation } from '../sim/Simulation.js';
import { FlightView } from './FlightView.js';
import { createMenuBackdrop } from './MenuBackdrop.js';
import { DECK_Y } from './env/LaunchSite.js';
import { CONFIGS } from '../sim/geometry.js';
import { h } from '../core/dom.js';

const CHAPTER = { id: 'cinematic', setup: { get: -30, config: 'SATURN_V', state: 'PAD_39A', csm: 'PRELAUNCH', lm: 'STOWED' } };
const X = new THREE.Vector3(1, 0, 0);

const ALL_SHOTS = [
  {
    id: 'dawn',
    from: -30,
    to: -19,
    caption: ['16 de julio de 1969 · 09:31 EDT', 'Complejo de lanzamiento 39A'],
    cam(view, t, u) {
      // crane up beside the tower, looking at the spacecraft end of the stack
      const pos = view._padPoint(-70 + u * 12, DECK_Y + 30 + u * 70, 95 - u * 20, new THREE.Vector3());
      const st = view.sim.vehicle.state;
      const look = st.r.clone().addScaledVector(X.clone().applyQuaternion(st.q), 55 - u * 10);
      return { pos, look, fov: 34 };
    },
  },
  { id: 'ignition', from: -8, to: 4, caption: ['T−8,9 s · secuencia de ignición', '7,5 millones de libras de empuje'], mode: 'pad:far' },
  {
    id: 'tower',
    from: 4,
    to: 12,
    caption: ['T+0 · ¡despegue!', 'Cámara de la torre umbilical'],
    cam(view) {
      const pos = view._padPoint(-11, DECK_Y + 52, -16, new THREE.Vector3());
      const st = view.sim.vehicle.state;
      const look = st.r.clone().addScaledVector(X.clone().applyQuaternion(st.q), -CONFIGS.SATURN_V.ref + 4);
      return { pos, look, fov: 64, shake: 1.4 };
    },
  },
  {
    id: 'ascent',
    from: 38,
    to: 50,
    caption: ['T+40 s · velocidad del sonido', 'Desde la playa, 4 km al sur'],
    cam(view) {
      const pos = view._padPoint(1100, 4, 3800, new THREE.Vector3());
      const st = view.sim.vehicle.state;
      const look = st.r.clone().addScaledVector(X.clone().applyQuaternion(st.q), -60);
      const d = pos.distanceTo(look);
      return { pos, look, fov: Math.max(1.2, 2 * Math.atan(260 / d) * 57.3) };
    },
  },
  { id: 'staging', from: 156, to: 172, caption: ['T+2 min 42 s · separación de la primera etapa', 'Cámara a bordo del S-II, mirando hacia atrás'], mode: 'onboard' },
  { id: 'earthrise', earthrise: true, dur: 12, caption: ['24 de diciembre de 1968 · órbita lunar', 'La salida de la Tierra'] },
];

export function createCinematicBackdrop(game, { shots = null } = {}) {
  const list = shots ? ALL_SHOTS.filter((s) => shots.includes(s.id)) : ALL_SHOTS;
  const state = { i: -1, t: 0, ready: false, disposed: false, fading: 0, jumping: false, focus: 0 };
  const earthrise = createMenuBackdrop(game);
  let sim = null;
  let view = null;

  const fadeEl = h('div', { class: 'cine-fade' });
  const capEl = h('div', { class: 'cine-caption' }, h('div', { class: 'c1' }), h('div', { class: 'c2' }));
  const dotsEl = h('div', { class: 'cine-dots' }, list.map(() => h('i')));
  const overlay = h('div', { class: 'cine-overlay' }, fadeEl);
  const over = h('div', { class: 'cine-over' }, capEl, dotsEl);
  game.uiRoot.prepend(overlay);
  game.uiRoot.append(over);

  const needsLaunch = list.some((s) => !s.earthrise);
  const makeSim = async () => {
    const s = new Simulation({ chapter: CHAPTER, missionId: 'apollo11', role: 'controller' });
    await s.init();
    return s;
  };

  const loading = (async () => {
    await earthrise.loading;
    if (!needsLaunch || state.disposed) return;
    sim = await makeSim();
    view = new FlightView({ game, sim, role: 'controller', chapter: CHAPTER, mission: { id: 'apollo11' }, observer: true });
    await view.init();
    if (state.disposed) {
      view.dispose();
      return;
    }
    view.resize(game.width, game.height);
    state.ready = true;
  })();

  function setCaption(c) {
    capEl.classList.remove('show');
    if (!c) return;
    capEl.children[0].textContent = c[0];
    capEl.children[1].textContent = c[1] ?? '';
    setTimeout(() => capEl.classList.add('show'), 500);
  }

  /** Advance the simulation to a GET (in chunks, emitting particles so trails exist). */
  async function jumpTo(get) {
    state.jumping = true;
    if (sim.clock.get > get + 1) {
      const fresh = await makeSim();
      sim.dispose();
      sim = fresh;
      view.rebind(sim);
    }
    let n = 0;
    while (sim.clock.get < get - 1e-6 && !state.disposed) {
      sim.step(0.05);
      if (++n % 2 === 0) view.update(0.1, false);
      if (n % 120 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    state.jumping = false;
  }

  async function startShot(i) {
    state.i = i % list.length;
    const shot = list[state.i];
    [...dotsEl.children].forEach((d, k) => d.classList.toggle('on', k === state.i));
    state.t = 0;
    if (!shot.earthrise && state.ready) {
      await jumpTo(shot.from);
      if (shot.cam) {
        view.cinematicCam = (v, dt) => {
          const u = Math.min(1, (sim.clock.get - shot.from) / (shot.to - shot.from));
          return shot.cam(v, dt, u);
        };
        view.setCamera('cinematic');
      } else {
        view.cinematicCam = null;
        view.setCamera(shot.mode);
      }
    }
    setCaption(shot.caption);
    fadeEl.classList.remove('black');
  }

  async function nextShot() {
    fadeEl.classList.add('black');
    await new Promise((r) => setTimeout(r, 650));
    if (state.disposed) return;
    let j = state.i + 1;
    // skip launch shots if the launch scene failed to build
    for (let k = 0; k < list.length && !state.ready && !list[j % list.length].earthrise; k++) j++;
    await startShot(j);
  }

  loading.then(() => {
    if (!state.disposed) startShot(0);
  });

  return {
    loading: earthrise.loading,
    setFocus(k) {
      state.focus = k;
      earthrise.setFocus(k);
      over.classList.toggle('dim', k > 0.5);
    },
    update(dt) {
      earthrise.update(dt);
      if (state.i < 0) return;
      const shot = list[state.i];
      state.t += dt;
      if (shot.earthrise) {
        if (state.t > shot.dur && !state.fading) {
          state.fading = 1;
          nextShot().finally(() => (state.fading = 0));
        }
        return;
      }
      if (!state.ready || state.jumping) return;
      sim.step(dt);
      view.update(dt, false);
      if (sim.clock.get >= shot.to && !state.fading) {
        state.fading = 1;
        nextShot().finally(() => (state.fading = 0));
      }
    },
    render() {
      const shot = list[state.i];
      if (!shot || shot.earthrise || !state.ready) earthrise.render();
      else view.render();
    },
    resize(w, hh) {
      earthrise.resize(w, hh);
      view?.resize(w, hh);
    },
    dispose() {
      state.disposed = true;
      overlay.remove();
      over.remove();
      earthrise.dispose();
      view?.dispose();
      sim?.dispose();
    },
  };
}
