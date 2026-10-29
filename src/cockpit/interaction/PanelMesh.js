// A Panel shown in 3D: the panel canvas is split into 512-px tiles, each a CanvasTexture on its
// own quad, so only tiles touched by Panel.render() dirty rects are re-uploaded.
// Mesh local frame: panel centred at the origin, +X right, +Y up, facing +Z; 1 unit = 1 m.

import * as THREE from 'three';

const TILE = 512;

export class PanelMesh {
  constructor(panel, { pxPerMm = 1.6, brightness = 1 } = {}) {
    this.panel = panel;
    this.group = new THREE.Group();
    this.group.userData.panelMesh = this;
    const canvas = panel.getCanvas(pxPerMm);
    this.tiles = [];
    const W = panel.width / 1000;
    const H = panel.height / 1000;
    const cols = Math.ceil(canvas.width / TILE);
    const rows = Math.ceil(canvas.height / TILE);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = c * TILE;
        const sy = r * TILE;
        const w = Math.min(TILE, canvas.width - sx);
        const h = Math.min(TILE, canvas.height - sy);
        const tc = document.createElement('canvas');
        tc.width = w;
        tc.height = h;
        const tex = new THREE.CanvasTexture(tc);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(brightness, brightness, brightness) });
        const geo = new THREE.PlaneGeometry((w / canvas.width) * W, (h / canvas.height) * H);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(-W / 2 + ((sx + w / 2) / canvas.width) * W, H / 2 - ((sy + h / 2) / canvas.height) * H, 0);
        mesh.userData.panelMesh = this;
        this.group.add(mesh);
        this.tiles.push({ sx, sy, w, h, ctx: tc.getContext('2d'), tex, mesh, dirty: true });
      }
    }
    // dark bezel behind the panel
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.02, H + 0.02), new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.8 }));
    back.position.z = -0.003;
    this.group.add(back);
    this.width = W;
    this.height = H;
    this._acc = 1;
    this.flush(true);
  }

  get meshes() {
    return this.tiles.map((t) => t.mesh);
  }

  /** Redraw panel changes and upload affected tiles. Call each frame. */
  update(dt, force = false) {
    this.panel.update(dt);
    this._acc += dt;
    if (!force && this._acc < 1 / 15) return;
    this._acc = 0;
    this.flush(false);
  }

  flush(all) {
    const rects = this.panel.render();
    for (const t of this.tiles) {
      if (!all && !rects.some((r) => r.x < t.sx + t.w && r.x + r.w > t.sx && r.y < t.sy + t.h && r.y + r.h > t.sy)) continue;
      t.ctx.clearRect(0, 0, t.w, t.h);
      t.ctx.drawImage(this.panel.canvas, t.sx, t.sy, t.w, t.h, 0, 0, t.w, t.h);
      t.tex.needsUpdate = true;
    }
  }

  /** Convert a ray hit on one of the tile meshes to panel millimetres. */
  hitToMm(hit) {
    const local = this.group.worldToLocal(hit.point.clone());
    const x = (local.x / this.width + 0.5) * this.panel.width;
    const y = (0.5 - local.y / this.height) * this.panel.height;
    return { x, y };
  }

  dispose() {
    for (const t of this.tiles) {
      t.tex.dispose();
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    }
  }
}
