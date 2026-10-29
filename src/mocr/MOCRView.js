// Controller view: first-person walkable Mission Operations Control Room (MOCR), Houston.
// STUB by the architect with the final interface (docs/ARCHITECTURE.md §12). The "mocr" agent
// implements the room, consoles (Panel-based, every button interactive), NPC controllers, wall
// displays, walking/sitting, and the console task UI for ctx.ground()/ctx.poll().

import * as THREE from 'three';
import { MOCR_CONSOLES } from '../missions/MissionRunner.js';

export class MOCRView {
  constructor({ game, sim, role, chapter, mission }) {
    this.game = game;
    this.sim = sim;
    this.role = role;
    this.chapter = chapter;
    this.mission = mission;
    this.playerConsole = null; // console id the player is seated at (null = walking)
    this.active = false;
  }

  async init() {
    const { game } = this;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d10);
    this.camera = new THREE.PerspectiveCamera(70, game.width / game.height, 0.05, 200);
    this.camera.position.set(0, 1.7, 9);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x202020, 1.2));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24), new THREE.MeshStandardMaterial({ color: 0x3a3f36 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 7), new THREE.MeshStandardMaterial({ color: 0x1d2b3a, emissive: 0x0a1520 }));
    wall.position.set(0, 3.5, -9);
    this.scene.add(wall);
    MOCR_CONSOLES.slice(0, 16).forEach((id, i) => {
      const row = Math.floor(i / 5);
      const col = i % 5;
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a8578 }));
      c.position.set((col - 2) * 2.6, 0.55, -5 + row * 3);
      c.userData.console = id;
      this.scene.add(c);
    });
    this.yaw = 0;
    this.pitch = 0;
  }

  setActive(on) {
    this.active = on;
    this.game.input.setContext('walk', on);
  }

  sitAt(consoleId) {
    this.playerConsole = consoleId;
    this.sim.bus.emit('mocr:seat', { console: consoleId });
  }

  stand() {
    this.playerConsole = null;
    this.sim.bus.emit('mocr:seat', { console: null });
  }

  setCamera() {}

  shake() {}

  fade(toBlack, seconds = 1) {
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  highlight() {}

  update(dt) {
    const input = this.game.input;
    const speed = (input.down('run') ? 3.2 : 1.6) * dt;
    if (input.mouse.buttons & 1) {
      this.yaw -= input.mouse.dx * 0.003;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - input.mouse.dy * 0.003));
    }
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.addScaledVector(fwd, input.axis('walkZ') * speed).addScaledVector(right, input.axis('walkX') * speed);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
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
