// Rocket exhaust and particles.
//  - Plume meshes (open lathe, additive, view-dependent "volume" brightness, animated turbulence)
//    per engine type: F-1 (RP-1/LOX: dark fuel-rich collar, blazing yellow-orange), J-2 (LH2/LOX:
//    nearly transparent, faint blue-white Mach diamonds), hypergolics (SPS/DPS/APS/RCS: pale
//    orange-pink), solids (LES, retro, ullage motors: white-hot, smoky).
//  - Particle systems (instanced camera-facing billboards, sun-lit): smoke, steam, dust, flame.
// Positions are kept in world (ECI / local) doubles on the CPU and uploaded camera-relative.

import * as THREE from 'three';

// ------------------------------------------------------------------ plumes

const PLUME_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vUv = uv;
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const PLUME_FS = /* glsl */ `
uniform float time; uniform float intensity; uniform float collar; uniform float diamonds; uniform float turb;
uniform vec3 core; uniform vec3 mid; uniform vec3 edge; uniform float vac; uniform float seed;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  float a = clamp(vUv.y, 0.0, 1.0);              // 0 at the nozzle exit → 1 at the tip
  float ang = vUv.x * 6.2831853;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(facing, 1.35);                  // longer optical path through the centre
  // turbulence streaks travelling downstream
  vec3 q = vec3(cos(ang) * 1.6, sin(ang) * 1.6, a * 9.0 - time * 7.0 + seed);
  float n = noise(q) * 0.6 + noise(q * 2.3 + 3.1) * 0.4;
  float flick = mix(1.0, 0.55 + 0.9 * n, turb);
  // dark fuel-rich film near the nozzle (F-1): suppress the first part, with glowing streaks
  float dark = collar * (1.0 - smoothstep(0.02, 0.14, a));
  float streak = smoothstep(0.55, 0.9, n) * collar * (1.0 - smoothstep(0.0, 0.16, a));
  // Mach diamonds
  float dmd = diamonds * (0.5 + 0.5 * cos(a * 52.0)) * (1.0 - smoothstep(0.0, 0.5, a)) * (1.0 - vac);
  float fade = (1.0 - smoothstep(0.35, 1.0, a)) * smoothstep(0.0, 0.035, a);
  float hot = 1.0 - smoothstep(0.0, 0.45, a);
  vec3 c = mix(edge, mid, smoothstep(0.0, 0.6, body));
  c = mix(c, core, hot * body * (1.0 - dark));
  float k = (body * flick * fade + dmd * body) * (1.0 - dark * 0.92) + streak * 0.8;
  k *= mix(1.0, 0.35, vac);
  gl_FragColor = vec4(c * k * intensity, 1.0);
}`;

const ENGINE_LOOK = {
  F1: { core: [3.4, 2.5, 1.1], mid: [2.7, 1.1, 0.16], edge: [1.25, 0.28, 0.03], collar: 1, diamonds: 0.15, turb: 1 },
  J2: { core: [0.9, 1.0, 1.35], mid: [0.32, 0.4, 0.7], edge: [0.12, 0.14, 0.3], collar: 0, diamonds: 1, turb: 0.35 },
  HYPER: { core: [1.6, 0.95, 0.75], mid: [0.75, 0.38, 0.32], edge: [0.25, 0.12, 0.14], collar: 0, diamonds: 0.4, turb: 0.4 },
  SOLID: { core: [4.0, 3.6, 2.8], mid: [2.8, 1.6, 0.6], edge: [1.0, 0.45, 0.15], collar: 0, diamonds: 0.2, turb: 0.9 },
  RCS: { core: [2.2, 1.8, 1.4], mid: [1.0, 0.7, 0.5], edge: [0.3, 0.2, 0.2], collar: 0, diamonds: 0, turb: 0.6 },
};

let _plumeGeo = null;
function plumeGeometry() {
  if (_plumeGeo) return _plumeGeo;
  // unit plume along −X: radius 0.32 at the exit → 1 at the tip (rotated lathe)
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector2(0.32 + 0.68 * Math.pow(t, 0.55) - 0.12 * t * t, t));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2); // lathe +Y → −X
  _plumeGeo = g;
  return g;
}

export function createPlumeMaterial(kind = 'F1') {
  const L = ENGINE_LOOK[kind] ?? ENGINE_LOOK.HYPER;
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      intensity: { value: 1 },
      collar: { value: L.collar },
      diamonds: { value: L.diamonds },
      turb: { value: L.turb },
      core: { value: new THREE.Vector3(...L.core) },
      mid: { value: new THREE.Vector3(...L.mid) },
      edge: { value: new THREE.Vector3(...L.edge) },
      vac: { value: 0 },
      seed: { value: Math.random() * 10 },
    },
    vertexShader: PLUME_VS,
    fragmentShader: PLUME_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** A plume mesh to attach to a nozzle anchor (anchor −X = exhaust direction). */
export function createPlume(kind = 'F1') {
  const mat = createPlumeMaterial(kind);
  const m = new THREE.Mesh(plumeGeometry(), mat);
  m.frustumCulled = false;
  m.renderOrder = 10;
  m.visible = false;
  m.userData.kind = kind;
  return {
    mesh: m,
    mat,
    /** length and exit/tip radius in metres; k 0..1 brightness; vac 0..1 ambient vacuum */
    set(on, length = 10, radius = 2, k = 1, vac = 0, time = 0) {
      m.visible = on && k > 0.005;
      if (!m.visible) return;
      m.scale.set(length, radius, radius);
      mat.uniforms.intensity.value = k;
      mat.uniforms.vac.value = vac;
      mat.uniforms.time.value = time;
    },
    dispose() {
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ particles

function smokeAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  let seed = 77;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let f = 0; f < 4; f++) {
    const ox = (f % 2) * S;
    const oy = Math.floor(f / 2) * S;
    // billowing puffs: many overlapping soft circles inside a soft disc
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.7) * S * 0.28;
      const x = ox + S / 2 + Math.cos(a) * r;
      const y = oy + S / 2 + Math.sin(a) * r;
      const rr = S * (0.08 + rnd() * 0.16);
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, `rgba(255,255,255,${0.22 + rnd() * 0.2})`);
      grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const PART_VS = /* glsl */ `
attribute vec3 iOffset; attribute float iSize; attribute float iAlpha; attribute float iRot; attribute vec3 iTint; attribute float iFrame;
varying vec2 vUv; varying float vA; varying vec3 vTint; varying vec2 vLocal; varying float vRot;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iRot); float s = sin(iRot);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 w = iOffset + (right * p.x + up * p.y) * iSize;
  vec2 cell = vec2(mod(iFrame, 2.0), floor(iFrame / 2.0));
  vUv = (uv + cell) * 0.5;
  vLocal = position.xy * 2.0;
  vRot = iRot;
  vA = iAlpha;
  vTint = iTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const PART_FS = /* glsl */ `
uniform sampler2D atlas; uniform vec3 sunView; uniform vec3 sunColor; uniform vec3 ambient; uniform float additive;
varying vec2 vUv; varying float vA; varying vec3 vTint; varying vec2 vLocal; varying float vRot;
void main(){
  float d = texture2D(atlas, vUv).r;
  float a = d * vA;
  if (a < 0.004) discard;
  // fake sphere normal in view space for sun shading
  vec2 l = vLocal;
  float c = cos(-vRot); float s = sin(-vRot);
  l = vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  vec3 n = normalize(vec3(l, sqrt(max(0.0, 1.0 - dot(l, l))) + 0.25));
  float lit = clamp(dot(n, sunView) * 0.6 + 0.55, 0.0, 1.0);
  vec3 col = vTint * (ambient + sunColor * lit);
  if (additive > 0.5) gl_FragColor = vec4(vTint * a, a);
  else gl_FragColor = vec4(col * a, a);
}`;

/**
 * Instanced particle system. emit({ pos, vel, life, size0, size1, alpha, tint, drag, rise })
 * pos/vel in world units (any frame, as long as update() gets the camera in the same frame).
 */
export class Particles {
  constructor({ max = 1500, additive = false, renderOrder = 8 } = {}) {
    this.max = max;
    this.additive = additive;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.off = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.frame = new Float32Array(max);
    const ia = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOffset', ia(this.off, 3));
    g.setAttribute('iSize', ia(this.size, 1));
    g.setAttribute('iAlpha', ia(this.alpha, 1));
    g.setAttribute('iRot', ia(this.rot, 1));
    g.setAttribute('iTint', ia(this.tint, 3));
    g.setAttribute('iFrame', ia(this.frame, 1));
    g.instanceCount = 0;
    this.geo = g;
    Particles._atlas ??= smokeAtlas();
    this.uniforms = {
      atlas: { value: Particles._atlas },
      sunView: { value: new THREE.Vector3(0, 0, 1) },
      sunColor: { value: new THREE.Vector3(1.3, 1.25, 1.15) },
      ambient: { value: new THREE.Vector3(0.45, 0.5, 0.58) },
      additive: { value: additive ? 1 : 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    // CPU state (doubles)
    this.p = [];
    this.next = 0;
  }

  emit(o) {
    let s;
    if (this.p.length < this.max) {
      s = {};
      this.p.push(s);
    } else {
      s = this.p[this.next];
      this.next = (this.next + 1) % this.max;
    }
    s.x = o.pos.x;
    s.y = o.pos.y;
    s.z = o.pos.z;
    s.vx = o.vel?.x ?? 0;
    s.vy = o.vel?.y ?? 0;
    s.vz = o.vel?.z ?? 0;
    s.age = 0;
    s.life = o.life ?? 10;
    s.s0 = o.size0 ?? 5;
    s.s1 = o.size1 ?? 30;
    s.a0 = o.alpha ?? 0.6;
    s.drag = o.drag ?? 0.3;
    s.rise = o.rise ?? null; // { x, y, z } acceleration (buoyancy) in world units
    s.rot = Math.random() * Math.PI * 2;
    s.spin = (Math.random() - 0.5) * (o.spin ?? 0.2);
    s.tr = o.tint?.[0] ?? 1;
    s.tg = o.tint?.[1] ?? 1;
    s.tb = o.tint?.[2] ?? 1;
    s.frame = Math.floor(Math.random() * 4);
    s.fadeIn = o.fadeIn ?? 0.08;
    return s;
  }

  get count() {
    return this.p.length;
  }

  clear() {
    this.p.length = 0;
    this.next = 0;
    this.geo.instanceCount = 0;
  }

  /** Advance and upload camera-relative offsets. cam: {x,y,z} world camera position. */
  update(dt, cam, extraVel = null) {
    let n = 0;
    const P = this.p;
    for (let i = 0; i < P.length; i++) {
      const s = P[i];
      if (s.age > s.life) continue;
      s.age += dt;
      const k = Math.max(0, 1 - s.drag * dt);
      s.vx *= k;
      s.vy *= k;
      s.vz *= k;
      if (s.rise) {
        s.vx += s.rise.x * dt;
        s.vy += s.rise.y * dt;
        s.vz += s.rise.z * dt;
      }
      s.x += (s.vx + (extraVel?.x ?? 0)) * dt;
      s.y += (s.vy + (extraVel?.y ?? 0)) * dt;
      s.z += (s.vz + (extraVel?.z ?? 0)) * dt;
      s.rot += s.spin * dt;
      const t = s.age / s.life;
      const j = n * 3;
      this.off[j] = s.x - cam.x;
      this.off[j + 1] = s.y - cam.y;
      this.off[j + 2] = s.z - cam.z;
      this.size[n] = s.s0 + (s.s1 - s.s0) * Math.sqrt(t);
      const fin = Math.min(1, t / s.fadeIn);
      this.alpha[n] = s.a0 * fin * (1 - t) * (1 - t * 0.3);
      this.rot[n] = s.rot;
      this.tint[j] = s.tr;
      this.tint[j + 1] = s.tg;
      this.tint[j + 2] = s.tb;
      this.frame[n] = s.frame;
      n++;
    }
    this.geo.instanceCount = n;
    for (const name of ['iOffset', 'iSize', 'iAlpha', 'iRot', 'iTint', 'iFrame']) {
      const a = this.geo.getAttribute(name);
      a.clearUpdateRanges?.();
      a.addUpdateRange?.(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    // compact dead particles occasionally
    if (P.length >= this.max && n < this.max * 0.5) {
      this.p = P.filter((s) => s.age <= s.life);
      this.next = 0;
    }
  }

  /** Sun direction in view space for lighting + ambient tint/brightness. */
  setLighting(sunView, sunColor, ambient) {
    this.uniforms.sunView.value.copy(sunView);
    if (sunColor) this.uniforms.sunColor.value.copy(sunColor);
    if (ambient) this.uniforms.ambient.value.copy(ambient);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Plume layout per stage: per-engine plumes + one merged "column" for clustered engines. */
export const PLUME_SPEC = {
  // [perEngine length, exit radius, tip radius scale] at sea level; vacuum scales applied by caller
  F1: { len: 26, rad: 3.4 },
  F1_COLUMN: { len: 95, rad: 14 },
  J2: { len: 24, rad: 3.8 },
  SPS: { len: 16, rad: 4.5 },
  DPS: { len: 9, rad: 3.2 },
  APS: { len: 8, rad: 2.8 },
  RCS: { len: 1.6, rad: 0.45 },
  LES: { len: 14, rad: 2.6 },
  RETRO: { len: 9, rad: 1.6 },
  ULLAGE: { len: 6, rad: 1.0 },
};
