// Astronaut view: exterior space/launch rendering + first-person cockpit pass.
// STUB by the architect with the final interface (docs/ARCHITECTURE.md §9). The "env" agent
// replaces it (SpaceRenderer multi-pass, Earth/Moon/stars, launch site, lunar surface, effects,
// cameras) and composes the cockpit pass from CockpitView (the "cabins" agent).
//
// Rendering convention: Three.js world axes = ECI axes, metres, camera-relative (floating origin):
// every frame objects are positioned at (worldPos − cameraWorldPos) so float32 precision holds.

import * as THREE from 'three';
import { R_EARTH, R_MOON } from '../core/constants.js';

export class FlightView {
  /** @param {{ game, sim, role, chapter, mission, observer?: boolean }} o */
  constructor({ game, sim, role, chapter, mission, observer = false }) {
    this.game = game;
    this.sim = sim;
    this.role = role;
    this.chapter = chapter;
    this.mission = mission;
    this.observer = observer; // controller "TV" view: exterior cameras only, no cockpit interaction
    this.cameraMode = observer ? 'exterior:chase' : 'cockpit';
    this.active = false;
    this.cockpit = null;
  }

  async init() {
    const { game } = this;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(60, game.width / game.height, 0.5, 2e9);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.scene.add(this.sun, new THREE.AmbientLight(0x223344, 0.4));
    const [earthTex, moonTex] = await Promise.all([
      game.assets.texture('earth_day', { sizes: ['4k', '2k'] }).catch(() => null),
      game.assets.texture('moon_color', { sizes: ['4k', '2k'] }).catch(() => null),
    ]);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 96, 64), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9 }));
    this.earth.rotation.x = Math.PI / 2; // texture poles on ECI Z
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 64, 48), new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1 }));
    this.moon.rotation.x = Math.PI / 2;
    this.scene.add(this.earth, this.moon);
    const starGeo = new THREE.BufferGeometry();
    const pts = new Float32Array(3000 * 3);
    for (let i = 0; i < pts.length; i += 3) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1e9);
      pts.set([v.x, v.y, v.z], i);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false }));
    this.scene.add(this.stars);
    this.ship = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 8, 24), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.4 }));
    body.rotation.z = -Math.PI / 2; // cylinder axis along +X (body forward)
    this.ship.add(body);
    this.scene.add(this.ship);
    this._camOffset = new THREE.Vector3(-30, 8, 6);
  }

  setActive(on) {
    this.active = on;
    this.game.input.setContext('flight', on && !this.observer);
  }

  // ---- facade used by missions (ctx.view) ----
  setCamera(mode) {
    this.cameraMode = mode;
    this.sim.bus.emit('view:camera', { mode });
  }

  cycleCamera() {
    this.setCamera(this.cameraMode === 'cockpit' ? 'exterior:chase' : 'cockpit');
  }

  shake() {}

  fade(toBlack, seconds = 1) {
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  flash() {}

  setSeat() {}

  highlight() {}

  // ---- frame ----
  update(dt) {
    const { sim, game } = this;
    const v = sim.vehicle;
    const input = game.input;
    if (!this.observer) {
      v.controls.rhc.set(input.axis('roll'), input.axis('pitch'), input.axis('yaw'));
      v.controls.thc.set(input.axis('transX'), input.axis('transY'), input.axis('transZ'));
      if (input.pressed('camera')) this.cycleCamera();
    }
    const st = v.state;
    const camWorld = st.r;
    this.ship.position.set(0, 0, 0);
    this.ship.quaternion.copy(st.q);
    this.earth.position.set(-camWorld.x, -camWorld.y, -camWorld.z);
    this.moon.position.copy(sim.dyn.moonPos).sub(camWorld);
    this.sun.position.copy(sim.dyn.sunDir).multiplyScalar(1e6);
    if (this.cameraMode === 'cockpit') {
      this.camera.position.set(0, 0, 0);
      this.camera.quaternion.copy(st.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)));
      this.ship.visible = false;
    } else {
      this.ship.visible = true;
      this.camera.position.copy(this._camOffset).applyQuaternion(st.q);
      this.camera.up.set(0, 0, -1).applyQuaternion(st.q);
      this.camera.lookAt(0, 0, 0);
    }
  }

  render() {
    const r = this.game.renderer;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.camera);
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.setActive(false);
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
