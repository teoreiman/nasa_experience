// First-person 3D cockpit (CM or LM interior) with interactive panels.
// STUB by the architect with the final interface (docs/ARCHITECTURE.md §9.2). The "cabins" agent
// implements: cabin geometry, panel meshes with tiled CanvasTextures fed by Panel.render() dirty
// rects, raycast → panel mm interaction (mouse + touch), seats/viewpoints, zoom-to-panel, flat 2D
// panel mode, window reticles (CM COAS, LM LPD scale), interior lighting, vibration.
//
// Coordinate convention: cockpit scene units = metres in the crew module's datum frame
// (geometry.js: CSM datum for 'CM', LM datum for 'LM'). FlightView renders the exterior with a
// camera whose world pose = vehicle pose ∘ moduleTransform(config, module) ∘ getEyeTransform().

import * as THREE from 'three';

export class CockpitView {
  /** @param {{ game, sim, station: 'CM'|'LM', panels: import('./Panel.js').Panel[], observer?: boolean }} o */
  constructor({ game, sim, station, panels = [], observer = false }) {
    this.game = game;
    this.sim = sim;
    this.station = station;
    this.panels = panels;
    this.observer = observer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, game.width / game.height, 0.02, 20);
    this.seat = station === 'LM' ? 'CDR' : 'CDR';
  }

  async init() {}

  /** Seats/viewpoints available for this station (ids + Spanish names). */
  get seats() {
    return this.station === 'LM'
      ? [{ id: 'CDR', name: 'Comandante (izquierda)' }, { id: 'LMP', name: 'Piloto del LM (derecha)' }]
      : [{ id: 'CDR', name: 'Comandante' }, { id: 'CMP', name: 'Piloto del CM' }, { id: 'LMP', name: 'Piloto del LM' }, { id: 'LEB', name: 'Bahía inferior de equipos' }];
  }

  setSeat(id) {
    this.seat = id;
  }

  highlight(ids) {
    for (const p of this.panels) p.setHighlights(ids);
  }

  /** Eye pose in the module datum frame (for the exterior pass camera). */
  getEyeTransform() {
    return { position: this.camera.position, quaternion: this.camera.quaternion };
  }

  update(dt) {}

  render(renderer) {}

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setActive(on) {}

  dispose() {
    for (const p of this.panels) p.dispose();
  }
}
