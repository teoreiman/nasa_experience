// Celestial bodies shared by the flight view, the menu backdrop and the MOCR TV feed:
// Earth (day/night, clouds with shadows, ocean glint, Rayleigh-tinted limb + outer atmosphere
// shell), Moon (Lommel-Seeliger regolith shading with height-map relief), the star field with the
// Milky Way, and the Sun (glare sprite + lens flare).
// Geometry is in metres with ECI-aligned axes (poles on +Z), like the simulation.

import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { R_EARTH, R_MOON } from '../../core/constants.js';

// ------------------------------------------------------------------ Earth

const EARTH_VS = /* glsl */ `
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FS = /* glsl */ `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform sampler2D waterMap;
uniform vec3 sunDir; uniform float cloudShift; uniform float exposure; uniform float nightGain;
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float mu = dot(n, sunDir);
  float day = smoothstep(-0.08, 0.16, mu);
  vec2 cuv = vUv + vec2(cloudShift, 0.0);
  float cl = texture2D(cloudMap, cuv).r;
  // cloud shadow: sample the cloud layer offset toward the sun (tangent-space shift)
  vec3 tSun = sunDir - n * mu;
  float shadow = texture2D(cloudMap, cuv - vec2(tSun.x * -0.0016, tSun.z * 0.0016)).r;
  vec3 dayC = texture2D(dayMap, vUv).rgb;
  dayC = pow(dayC, vec3(1.08)) * 1.08;
  float water = texture2D(waterMap, vUv).r;
  vec3 ground = dayC * (1.0 - shadow * 0.45);
  vec3 col = mix(ground, vec3(0.96, 0.97, 1.0), smoothstep(0.08, 0.9, cl));
  float lambert = max(mu, 0.0);
  col *= 0.02 + 1.05 * lambert;
  // ocean sun glint
  vec3 hv = normalize(sunDir + v);
  float spec = pow(max(dot(n, hv), 0.0), 90.0) * 1.6 + pow(max(dot(n, hv), 0.0), 12.0) * 0.08;
  col += water * (1.0 - cl) * spec * vec3(1.0, 0.86, 0.66) * day;
  // night lights (fade under clouds and at the terminator)
  vec3 night = texture2D(nightMap, vUv).rgb;
  night = pow(night, vec3(1.4)) * vec3(1.0, 0.78, 0.48) * nightGain * (1.0 - cl * 0.85);
  col += night * (1.0 - smoothstep(-0.18, 0.04, mu));
  // in-disc atmosphere: limb brightening + Rayleigh blue, warm near the terminator
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  vec3 rayleigh = mix(vec3(1.0, 0.45, 0.18), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.35, mu));
  col = mix(col, rayleigh * (0.25 + 1.1 * max(mu + 0.15, 0.0)), fres * smoothstep(-0.3, 0.1, mu) * 0.85);
  col += vec3(0.05, 0.1, 0.2) * (0.3 + 0.7 * lambert) * 0.35; // aerial haze
  gl_FragColor = vec4(col * exposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_FS = /* glsl */ `
uniform vec3 sunDir; uniform vec3 planetCenter; uniform float planetR; uniform float atmoR; uniform float exposure;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - cameraPosition);
  // ray / sphere: thickness of the atmosphere shell along the view ray, minus the planet
  vec3 oc = ro - planetCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - atmoR * atmoR;
  float h = b * b - c;
  if (h < 0.0) discard;
  float sq = sqrt(h);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float cp = dot(oc, oc) - planetR * planetR;
  float hp = b * b - cp;
  if (hp > 0.0) { float tp = -b - sqrt(hp); if (tp > 0.0) t1 = min(t1, tp); }
  float len = max(t1 - t0, 0.0) / (atmoR - planetR);
  vec3 mid = normalize(oc + rd * (t0 + t1) * 0.5);
  float mu = dot(mid, sunDir);
  float lit = smoothstep(-0.25, 0.25, mu);
  float cosv = dot(rd, sunDir);
  float mie = pow(max(cosv, 0.0), 24.0) * 0.6;
  vec3 col = mix(vec3(1.0, 0.42, 0.15), vec3(0.28, 0.55, 1.0), smoothstep(-0.1, 0.4, mu));
  float dens = 1.0 - exp(-len * 0.11);
  float a = dens * lit;
  gl_FragColor = vec4((col * (1.0 + mie) * a * 1.4) * exposure, a);
}`;

/**
 * @param {{ day, night, clouds, water }} tex textures (any may be null)
 * @returns {{ group: THREE.Group, earth: THREE.Mesh, atmo: THREE.Mesh, uniforms: object, setSun(dir), setRotation(gmst), dispose() }}
 */
export function createEarth(tex, { segments = 128 } = {}) {
  const blank = new THREE.DataTexture(new Uint8Array([20, 40, 90, 255]), 1, 1);
  blank.needsUpdate = true;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  if (tex.clouds) tex.clouds.wrapS = THREE.RepeatWrapping;
  const uniforms = {
    dayMap: { value: tex.day ?? blank },
    nightMap: { value: tex.night ?? black },
    cloudMap: { value: tex.clouds ?? black },
    waterMap: { value: tex.water ?? black },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    cloudShift: { value: 0 },
    exposure: { value: 1 },
    nightGain: { value: 1.6 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VS, fragmentShader: EARTH_FS });
  const geo = new THREE.SphereGeometry(R_EARTH, segments, Math.round(segments * 0.75));
  geo.rotateX(Math.PI / 2);
  const earth = new THREE.Mesh(geo, mat);
  const atmoUniforms = {
    sunDir: uniforms.sunDir,
    planetCenter: { value: new THREE.Vector3() },
    planetR: { value: R_EARTH },
    atmoR: { value: R_EARTH * 1.018 },
    exposure: uniforms.exposure,
  };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R_EARTH * 1.018, 96, 64),
    new THREE.ShaderMaterial({ uniforms: atmoUniforms, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  atmo.renderOrder = 2;
  const group = new THREE.Group();
  group.add(earth, atmo);
  return {
    group,
    earth,
    atmo,
    uniforms,
    /** world-space position of the Earth centre (camera-relative) */
    setPosition(p) {
      group.position.copy(p);
      atmoUniforms.planetCenter.value.copy(p);
    },
    setSun(dir) {
      uniforms.sunDir.value.copy(dir);
    },
    setRotation(angle) {
      earth.rotation.set(0, 0, angle);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      atmo.geometry.dispose();
      atmo.material.dispose();
    },
  };
}

// ------------------------------------------------------------------ Moon

const MOON_FS = /* glsl */ `
uniform sampler2D colorMap; uniform sampler2D heightMap; uniform vec3 sunDir; uniform float exposure;
uniform float bump; uniform vec2 texel; uniform float earthshine; uniform vec3 earthDir;
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // relief from the LOLA height map (finite differences in UV → tangent frame of the sphere)
  float h0 = texture2D(heightMap, vUv).r;
  float hx = texture2D(heightMap, vUv + vec2(texel.x, 0.0)).r;
  float hy = texture2D(heightMap, vUv + vec2(0.0, texel.y)).r;
  vec3 east = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-5));
  vec3 north = normalize(cross(n, east));
  vec3 nb = normalize(n - bump * ((hx - h0) * east + (hy - h0) * north));
  vec3 albedo = texture2D(colorMap, vUv).rgb;
  albedo = mix(vec3(dot(albedo, vec3(0.3, 0.55, 0.15))), albedo, 0.65) * 1.12;
  float mu0 = max(dot(nb, sunDir), 0.0);
  float mu = max(dot(nb, v), 0.0);
  // Lommel-Seeliger (lunar regolith) blended with a little Lambert + opposition surge
  float ls = mu0 / max(mu0 + mu, 1e-3);
  float phase = max(dot(v, sunDir), 0.0);
  float surge = 1.0 + 0.35 * pow(phase, 24.0);
  float shade = (ls * 1.7 * 0.75 + mu0 * 0.25) * surge;
  vec3 col = albedo * shade * vec3(1.0, 0.985, 0.96);
  col += albedo * earthshine * max(dot(n, earthDir), 0.0) * vec3(0.55, 0.65, 0.85) * 0.03;
  gl_FragColor = vec4(col * exposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createMoon(tex, { segments = 128 } = {}) {
  const grey = new THREE.DataTexture(new Uint8Array([150, 146, 140, 255]), 1, 1);
  grey.needsUpdate = true;
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  flat.needsUpdate = true;
  const hm = tex.height ?? flat;
  const uniforms = {
    colorMap: { value: tex.color ?? grey },
    heightMap: { value: hm },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    exposure: { value: 1 },
    bump: { value: tex.height ? 5.0 : 0 },
    texel: { value: new THREE.Vector2(1 / (hm.image?.width ?? 1024), 1 / (hm.image?.height ?? 512)) },
    earthshine: { value: 1 },
    earthDir: { value: new THREE.Vector3(-1, 0, 0) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VS, fragmentShader: MOON_FS });
  const geo = new THREE.SphereGeometry(R_MOON, segments, Math.round(segments * 0.75));
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  return {
    mesh,
    uniforms,
    setSun(dir) {
      uniforms.sunDir.value.copy(dir);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ stars + Milky Way

// Galactic north pole (J2000): RA 192.859°, Dec +27.128°; galactic centre RA 266.405°, Dec −28.936°.
const GNP = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 27.128 * (Math.PI / 180), 0);
function radec(raDeg, decDeg, out = new THREE.Vector3()) {
  const ra = (raDeg * Math.PI) / 180;
  const de = (decDeg * Math.PI) / 180;
  return out.set(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de));
}
const GAL_N = radec(192.859, 27.128);
const GAL_C = radec(266.405, -28.936);

// Bright stars (RA°, Dec°, V mag, B−V) incl. Apollo navigation stars — anchors the real sky.
const BRIGHT = [
  [101.287, -16.716, -1.46, 0.0], [95.988, -52.696, -0.74, 0.15], [219.9, -60.83, -0.27, 0.71], [213.915, 19.182, -0.05, 1.23],
  [279.235, 38.784, 0.03, 0.0], [79.172, 45.998, 0.08, 0.8], [78.634, -8.202, 0.13, -0.03], [114.825, 5.225, 0.34, 0.42],
  [24.429, -57.237, 0.46, -0.16], [88.793, 7.407, 0.5, 1.85], [210.956, -60.373, 0.61, -0.23], [297.696, 8.868, 0.77, 0.22],
  [186.65, -63.099, 0.77, -0.24], [68.98, 16.509, 0.85, 1.54], [247.352, -26.432, 0.96, 1.83], [201.298, -11.161, 0.97, -0.23],
  [116.329, 28.026, 1.14, 1.0], [344.413, -29.622, 1.16, 0.09], [191.93, -59.689, 1.25, -0.23], [310.358, 45.28, 1.25, 0.09],
  [152.093, 11.967, 1.35, -0.11], [104.656, -28.972, 1.5, -0.21], [113.65, 31.888, 1.58, 0.03], [187.791, -57.113, 1.63, 1.59],
  [81.283, 6.35, 1.64, -0.22], [81.573, 28.608, 1.65, -0.13], [138.3, -69.717, 1.68, 0.0], [84.053, -1.202, 1.69, -0.18],
  [332.058, -46.961, 1.74, -0.13], [193.507, 55.96, 1.77, -0.02], [165.932, 61.751, 1.79, 1.07], [263.402, -37.104, 1.62, -0.22],
  [37.955, 89.264, 1.98, 0.6], [2.097, 29.091, 2.06, -0.11], [17.433, 35.621, 2.07, 1.58], [30.975, 42.33, 2.1, 1.37],
  [141.897, -8.659, 1.98, 1.44], [177.265, 14.572, 2.14, 0.09], [233.672, 26.715, 2.23, -0.02], [326.046, 9.875, 2.39, 1.52],
  [346.19, 15.205, 2.49, -0.04], [14.177, 60.717, 2.47, -0.15], [10.897, -17.987, 2.04, 1.02], [305.557, 40.257, 2.23, 0.68],
  [222.676, 74.156, 2.08, 1.47], [125.628, -59.51, 1.86, 1.28], [140.528, -55.011, 2.21, -0.14], [131.176, -54.709, 1.96, 0.04],
  [83.002, -0.299, 2.23, -0.22], [85.19, -1.943, 1.77, -0.21], [26.017, -15.937, 3.5, 0.72], [56.871, 24.105, 2.87, -0.09],
];

const STAR_VS = /* glsl */ `
attribute float mag; attribute vec3 tint;
uniform float scale; uniform float limit; varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float b = pow(2.512, limit - mag);
  gl_PointSize = clamp(1.0 + sqrt(b) * 0.9, 1.0, 7.0) * scale;
  vA = clamp(b * 0.35, 0.0, 1.0);
  vC = tint;
}`;
const STAR_FS = /* glsl */ `
uniform float opacity; varying vec3 vC; varying float vA;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float core = exp(-d * d * 28.0);
  float a = core * vA * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC * a * 1.6, a);
}`;

const MW_FS = /* glsl */ `
uniform vec3 galN; uniform vec3 galC; uniform float opacity; varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float b = asin(clamp(dot(d, galN), -1.0, 1.0));
  float l = dot(normalize(d - galN * dot(d, galN)), galC);
  float band = exp(-b * b / 0.018) * (0.55 + 0.45 * smoothstep(-0.6, 1.0, l));
  float bulge = exp(-pow(acos(clamp(dot(d, galC), -1.0, 1.0)) / 0.38, 2.0)) * 0.9;
  float n = fbm(d * 7.0);
  float dust = smoothstep(0.45, 0.7, fbm(d * 13.0 + 3.0)) * exp(-b * b / 0.003);
  float i = (band * (0.45 + 0.9 * n) + bulge * (0.6 + 0.6 * n)) * (1.0 - dust * 0.75);
  vec3 col = mix(vec3(0.62, 0.68, 0.85), vec3(1.0, 0.86, 0.68), bulge);
  gl_FragColor = vec4(col * i * 0.11 * opacity, 1.0);
}`;

function bvToRgb(bv) {
  const t = Math.max(-0.4, Math.min(2, bv));
  if (t < 0) return [0.72, 0.8, 1.0];
  if (t < 0.4) return [0.85 + t * 0.3, 0.88 + t * 0.2, 1.0 - t * 0.15];
  if (t < 0.8) return [1.0, 0.94 - (t - 0.4) * 0.15, 0.85 - (t - 0.4) * 0.4];
  return [1.0, 0.82 - (t - 0.8) * 0.15, 0.62 - (t - 0.8) * 0.25];
}

/** Star field + Milky Way glow, unit-sphere directions scaled to `radius`. Keep it centred on the camera. */
export function createStarfield({ count = 9000, radius = 1e9, milkyWay = true } = {}) {
  const group = new THREE.Group();
  const n = count + BRIGHT.length;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  let seed = 1969;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const v = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gx = GAL_C.clone();
  const gy = new THREE.Vector3().crossVectors(GAL_N, gx);
  let k = 0;
  for (const [ra, de, m, bv] of BRIGHT) {
    radec(ra, de, v).multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], k * 3);
    mag[k] = m;
    tint.set(bvToRgb(bv), k * 3);
    k++;
  }
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.42) {
      // concentrate toward the galactic plane
      const l = rnd() * Math.PI * 2;
      const b = (rnd() + rnd() + rnd() - 1.5) * 0.28;
      v.copy(gx).multiplyScalar(Math.cos(b) * Math.cos(l)).addScaledVector(gy, Math.cos(b) * Math.sin(l)).addScaledVector(GAL_N, Math.sin(b));
    } else {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      v.set(r * Math.cos(a), r * Math.sin(a), z);
    }
    v.normalize().multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], k * 3);
    // magnitude distribution: N(<m) ∝ 10^(0.5 m)
    mag[k] = 2.2 + 4.6 * Math.pow(rnd(), 0.32);
    tint.set(bvToRgb(rnd() * rnd() * 1.9 - 0.2), k * 3);
    k++;
  }
  tmp.set(0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const starUniforms = { scale: { value: 1 }, limit: { value: 6.2 }, opacity: { value: 1 } };
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: starUniforms, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  group.add(stars);
  let mw = null;
  if (milkyWay) {
    const mwUniforms = { galN: { value: GAL_N }, galC: { value: GAL_C }, opacity: { value: 1 } };
    mw = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.01, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: mwUniforms,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: MW_FS,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
      }),
    );
    mw.frustumCulled = false;
    mw.renderOrder = -11;
    group.add(mw);
  }
  return {
    group,
    /** 0..1 visibility (exposure adaptation: stars vanish in daylight / with the Sun in view) */
    setVisibility(o) {
      starUniforms.opacity.value = o;
      if (mw) mw.material.uniforms.opacity.value = o;
      group.visible = o > 0.01;
    },
    setPixelScale(s) {
      starUniforms.scale.value = s;
    },
    dispose() {
      g.dispose();
      stars.material.dispose();
      mw?.geometry.dispose();
      mw?.material.dispose();
    },
  };
}

// ------------------------------------------------------------------ Sun

function radialTex(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTex(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.6, 'rgba(160,200,255,0.25)');
  grd.addColorStop(0.75, 'rgba(255,190,140,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sun glare (sprite, scaled in angular size) + lens flare. Place `group` at sunDir × distance. */
export function createSun({ flare = true } = {}) {
  const group = new THREE.Group();
  const glareTex = radialTex(256, [
    [0, 'rgba(255,255,255,1)'],
    [0.035, 'rgba(255,255,250,1)'],
    [0.07, 'rgba(255,246,225,0.6)'],
    [0.2, 'rgba(255,220,170,0.16)'],
    [0.5, 'rgba(255,200,140,0.04)'],
    [1, 'rgba(255,200,140,0)'],
  ]);
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2.9, 2.7) }));
  glare.renderOrder = 5;
  group.add(glare);
  let lens = null;
  if (flare) {
    lens = new Lensflare();
    const hex = radialTex(64, [[0, 'rgba(255,255,255,0.7)'], [0.7, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
    const ring = ringTex(256);
    lens.addElement(new LensflareElement(hex, 60, 0.35, new THREE.Color(0.5, 0.7, 1.0)));
    lens.addElement(new LensflareElement(hex, 90, 0.55, new THREE.Color(1.0, 0.75, 0.45)));
    lens.addElement(new LensflareElement(ring, 260, 0.75, new THREE.Color(0.7, 0.85, 1.0)));
    lens.addElement(new LensflareElement(hex, 40, 0.9, new THREE.Color(0.6, 1.0, 0.7)));
    lens.addElement(new LensflareElement(hex, 120, 1.1, new THREE.Color(0.55, 0.6, 1.0)));
    group.add(lens);
  }
  return {
    group,
    glare,
    lens,
    /** angular glare diameter at the given distance */
    setSize(distance, angularRad = 0.2) {
      glare.scale.setScalar(distance * angularRad);
    },
    setIntensity(k) {
      glare.material.color.setScalar(3 * k);
      glare.visible = k > 0.01;
      if (lens) lens.visible = k > 0.15;
    },
    dispose() {
      glareTex.dispose();
      glare.material.dispose();
      lens?.dispose();
    },
  };
}

export { radec, GAL_N, GNP };
