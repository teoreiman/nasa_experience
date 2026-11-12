// Coming home (near pass, camera-relative ECI): the entry fireball (a glowing shock layer ahead of the
// heat shield, a wake of ionised air, ablation sparks, an orange light on the capsule), the parachutes
// (two drogues, three orange-and-white ringsail mains, reefed then full, draped on the sea after
// splashdown) and the Pacific: an ocean disc with swell, sky reflection, sun glint, the splash ring and
// the green dye marker, the recovery carrier steaming in and a Sea King circling.
//   const rec = createRecovery({ recovery: { name, lat, lon } | null, light })
//   rec.update({ camWorld, camQ, sunDir, vehicle, dyn, time, dt, utc, skyTint, fogColor, nearLaunchSite, flames, smoke })

import * as THREE from 'three';
import { R_EARTH, DEG } from '../../core/constants.js';
import { earthFixedToEci, gmst } from '../../sim/physics/ephemeris.js';

const OMEGA = 7.2921159e-5;
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const ID = new THREE.Quaternion();

/** Local east / north at `up` (works in ECI and Earth-fixed axes alike: both share the Z axis). */
function enu(up, east, north) {
  east.set(-up.y, up.x, 0);
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(up, east);
}
/** ECI → Earth-fixed (rotation by −θ about Z). */
function toFixed(p, th, out) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return out.set(p.x * c + p.y * s, -p.x * s + p.y * c, p.z);
}
/** Earth-fixed → ECI. */
function toEci(p, th, out) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return out.set(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

// ------------------------------------------------------------------ parachutes

function goreTexture(colors, gores, rings) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  const w = 512 / gores;
  for (let i = 0; i < gores; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(i * w, 0, w + 1, 128);
  }
  // ringsail: the slots between the sail rings (darker: the sky shows through), the radial tapes
  for (let k = 1; k <= rings; k++) {
    g.fillStyle = 'rgba(20,30,50,0.3)';
    g.fillRect(0, (k * 128) / (rings + 1), 512, 2.5);
  }
  for (let i = 0; i < gores; i++) {
    g.fillStyle = 'rgba(70,60,50,0.35)';
    g.fillRect(i * w - 1, 0, 2, 128);
  }
  // canvas bottom = the skirt (v = 0), top = the vent
  g.fillStyle = 'rgba(60,50,40,0.45)';
  g.fillRect(0, 124, 512, 4);
  g.fillRect(0, 0, 512, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One parachute: canopy (lathe, +Y up, vent at the top, gores bulging between the radial tapes) and
 *  the suspension lines from the skirt down to the confluence at the group origin. */
function createChute({ radius, height, lines, gores, colors, rings }) {
  const group = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    prof.push(new THREE.Vector2(radius * (0.07 + 0.93 * Math.cos(a)), height * Math.sin(a) - (i === 0 ? height * 0.06 : 0)));
  }
  const geo = new THREE.LatheGeometry(prof, gores * 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const b = 1 + 0.04 * Math.sin((Math.atan2(x, z) * gores) / 2) ** 2;
    p.setXYZ(i, x * b, p.getY(i), z * b);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: goreTexture(colors, gores, rings), side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  const canopy = new THREE.Mesh(geo, mat);
  canopy.position.y = lines;
  canopy.castShadow = true;
  group.add(canopy);
  const pts = [];
  for (let i = 0; i < gores; i++) {
    const a = (i / gores) * Math.PI * 2;
    pts.push(Math.sin(a) * radius, lines - height * 0.06, Math.cos(a) * radius, 0, 0, 0);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lm = new THREE.LineBasicMaterial({ color: 0xc9c2b4, transparent: true, opacity: 0.7 });
  const shrouds = new THREE.LineSegments(lg, lm);
  group.add(shrouds);
  group.visible = false;
  return { group, canopy, lines: shrouds, dispose: () => (geo.dispose(), mat.map.dispose(), mat.dispose(), lg.dispose(), lm.dispose()) };
}

// ------------------------------------------------------------------ entry fireball

const PLASMA_NOISE = /* glsl */ `
float hash3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`;
const PLASMA_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vL; varying vec2 vUv;
void main(){ vN = normalize(normalMatrix * normal); vL = position; vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`;
// shock layer: an ellipsoid ahead of and around the heat shield (local +Y = direction of flight).
// Seen as a volume: brighter where the eye grazes the shell, white-hot at the stagnation point,
// orange on the shoulders, pink-violet at the edge, rippling. From inside (the cabin) a uniform glow.
const SHOCK_FS = /* glsl */ `
uniform float k; uniform float time; uniform vec3 flowView;
varying vec3 vN; varying vec3 vP; varying vec3 vL; varying vec2 vUv;
${PLASMA_NOISE}
void main(){
  vec3 n = normalize(vN);
  vec3 V = normalize(-vP);
  float facing = abs(dot(n, V));
  float front = clamp(dot(n, flowView), -1.0, 1.0) * 0.5 + 0.5; // outward normal toward the flow
  float turb = noise3(vL * 2.2 + vec3(0.0, -time * 9.0, time * 1.3)) * 0.6 + noise3(vL * 5.5 + vec3(time * 2.0, -time * 17.0, 0.0)) * 0.4;
  float rim = pow(1.0 - facing, 1.6);
  float core = pow(front, 5.0);
  vec3 col = mix(vec3(1.0, 0.3, 0.12), vec3(1.0, 0.5, 0.12), smoothstep(0.5, 0.85, front));
  col = mix(col, vec3(1.0, 0.82, 0.5), core);
  // only the forward half glows: the layer hugs the shield and spills into the wake at the shoulders
  float fwd = smoothstep(0.35, 0.8, front);
  float a = (rim * 0.75 + core * 0.7 + 0.1) * fwd * (0.65 + 0.7 * turb);
  if (!gl_FrontFacing) a = max(a * 0.4, 0.2 * (0.6 + 0.8 * turb)); // from inside (the cabin)
  a = clamp(a * k, 0.0, 1.0);
  gl_FragColor = vec4(col * a * 1.5, a);
}`;
// ionised wake: a flared tube trailing behind (local −Y), soft at its silhouette, streaming.
const WAKE_FS = /* glsl */ `
uniform float k; uniform float time;
varying vec3 vN; varying vec3 vP; varying vec3 vL; varying vec2 vUv;
${PLASMA_NOISE}
void main(){
  vec3 n = normalize(vN);
  float facing = abs(dot(n, normalize(-vP)));
  float along = 1.0 - vUv.y; // 0 at the capsule, 1 at the tail
  float streak = noise3(vec3(vUv.x * 14.0, along * 5.0 - time * 7.0, time * 0.7)) * 0.65 + noise3(vec3(vUv.x * 31.0, along * 13.0 - time * 16.0, 0.0)) * 0.35;
  float a = pow(1.0 - along, 1.5) * pow(facing, 1.2) * (0.4 + 0.9 * streak) * k * 0.85;
  if (!gl_FrontFacing) a *= 0.6;
  vec3 col = mix(vec3(1.0, 0.5, 0.14), vec3(0.9, 0.18, 0.3), smoothstep(0.1, 0.75, along));
  col = mix(col, vec3(1.0, 0.8, 0.45), pow(1.0 - along, 10.0) * 0.7);
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col * a * 1.6, a);
}`;

// ------------------------------------------------------------------ ocean

const OCEAN_VS = /* glsl */ `
uniform vec2 offset;
varying vec3 vW; varying vec2 vL; varying float vR;
void main(){
  vL = vec2(position.x, -position.z) + offset; // east, north (m) from the anchor
  vR = length(position.xz);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const OCEAN_FS = /* glsl */ `
uniform vec3 sunDir; uniform vec3 upW; uniform vec3 eastW; uniform vec3 skyTint; uniform vec3 fogColor; uniform float fogDensity;
uniform float time; uniform float exposure; uniform float opacity; uniform float edgeR;
uniform vec2 cm; uniform float splashT;
uniform vec2 shipL; uniform vec2 shipDir; uniform float shipOn; uniform float shipSpeed; uniform float shipHalf;
varying vec3 vW; varying vec2 vL; varying float vR;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
vec2 grad(vec2 p, vec2 drift){ vec2 q = p + drift; const float e = 0.35;
  return vec2(vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0)), vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e))); }
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  // Pacific swell from the southwest, wind sea, ripples; flattened with distance (no far shimmer)
  vec2 p = vL;
  vec2 sw = vec2(0.8, 0.6);
  vec2 sw2 = vec2(0.42, 0.91);
  // two swell trains with wandering phase (no ruler-straight crests)
  float ph1 = dot(p, sw) * 0.045 + vnoise(p * 0.0035) * 7.0 + time * 0.62;
  float ph2 = dot(p, sw2) * 0.071 + vnoise(p * 0.005 + 17.0) * 6.0 + time * 0.8;
  float swell = sin(ph1) + 0.5 * sin(ph2);
  vec2 g = (sw * cos(ph1) * 0.2 + sw2 * cos(ph2) * 0.12) * (0.6 + 0.8 * vnoise(p * 0.002));
  g += grad(p * 0.07, vec2(time * 0.09, time * 0.05)) * 0.9;
  g += grad(p * 0.29, vec2(-time * 0.25, time * 0.18)) * 0.5;
  g += grad(p * 1.3, vec2(time * 0.7, -time * 0.5)) * 0.22;
  g *= 1.0 / (1.0 + dist * 0.0012);
  vec3 east = eastW;
  vec3 north = cross(upW, east);
  vec3 n = normalize(upW - (east * g.x + north * g.y) * 0.55);
  float muRaw = dot(upW, sunDir);
  float mu = max(muRaw, 0.0);
  vec3 sunCol = vec3(1.0, 0.93, 0.84) * smoothstep(-0.04, 0.12, muRaw);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float dayK = smoothstep(-0.12, 0.15, muRaw);
  vec3 deep = vec3(0.008, 0.05, 0.1) * (0.12 + 0.18 * dayK + 1.3 * mu) + skyTint * 0.04 * dayK;
  // light through the crests (subsurface green-blue on the sunlit faces)
  deep += vec3(0.0, 0.05, 0.06) * max(0.0, swell) * mu * 0.35;
  vec3 refl = skyTint * (0.12 + 0.83 * dayK) + vec3(0.012, 0.02, 0.03) * dayK;
  vec3 hv = normalize(sunDir + V);
  float nh = max(dot(n, hv), 0.0);
  float spec = pow(nh, 320.0) * 26.0 + pow(nh, 24.0) * 0.3;
  vec3 col = mix(deep, refl, fres) + sunCol * spec;
  // foam: whitecaps on the steepest crests, the splash ring and the froth around the capsule, the
  // carrier's wake (turbulent centre + Kelvin arms) and the water churned along her hull
  float foam = smoothstep(0.62, 0.9, length(g) * 1.35 + vnoise(p * 0.5) * 0.25) * 0.28;
  if (splashT >= 0.0) {
    float d = length(p - cm);
    float rr = 3.0 + 8.0 * sqrt(splashT);
    foam += exp(-pow((d - rr) / (1.2 + splashT * 0.4), 2.0)) * max(0.0, 1.0 - splashT / 9.0) * (0.6 + 0.4 * vnoise(p * 0.9));
    foam += exp(-d / 3.5) * 0.5 * (0.6 + 0.4 * vnoise(p * 1.7 + time));
    // fluorescein sea dye: a bright yellow-green slick spreading from the capsule
    float dr = min(70.0, 4.0 + 2.2 * splashT);
    float edge = d / dr + (vnoise(p * 0.07) - 0.5) * 0.7 + (vnoise(p * 0.3) - 0.5) * 0.2;
    float dye = smoothstep(1.0, 0.55, edge) * smoothstep(0.0, 6.0, splashT);
    col = mix(col, vec3(0.16, 0.6, 0.3) * (0.25 + sunCol * mu * 1.2 + skyTint * 0.4), dye * 0.72);
  }
  if (shipOn > 0.5) {
    vec2 rel = p - shipL;
    vec2 side = vec2(shipDir.y, -shipDir.x);
    float along = dot(rel, shipDir);
    float lat = dot(rel, side);
    float b = -along - shipHalf * 0.93;
    float sp = clamp(shipSpeed / 8.0, 0.15, 1.0);
    if (b > 0.0) {
      float w = 14.0 + b * 0.06;
      foam += exp(-pow(lat / w, 2.0)) * exp(-b / (1600.0 * sp)) * 0.85 * sp * (0.55 + 0.45 * vnoise(p * 0.12 - vec2(time * 0.2)));
      float arm = abs(abs(lat) - b * 0.34) / (3.0 + b * 0.025);
      foam += exp(-arm * arm) * exp(-b / (900.0 * sp)) * 0.45 * sp;
    }
    float hull = max(abs(along) - shipHalf, abs(lat) - 15.0);
    foam += exp(-max(hull, 0.0) / (4.0 + 6.0 * sp)) * 0.55 * (0.5 + 0.5 * vnoise(p * 0.6 + time));
  }
  col += vec3(0.82, 0.86, 0.9) * min(foam, 1.0) * (skyTint * (0.15 + 0.75 * dayK) + sunCol * (0.25 + mu));
  float fog = 1.0 - exp(-dist * fogDensity);
  col = mix(col, fogColor, clamp(fog, 0.0, 1.0));
  float a = opacity * (1.0 - smoothstep(edgeR * 0.62, edgeR, vR));
  gl_FragColor = vec4(col * exposure, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function oceanGeometry(radius) {
  const rings = [0];
  for (let r = 3; r < radius; r *= 1.08) rings.push(r);
  rings.push(radius);
  const segs = 128;
  const pos = [];
  const idx = [];
  for (let i = 0; i < rings.length; i++) {
    const n = i === 0 ? 1 : segs;
    for (let j = 0; j < n; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = rings[i];
      pos.push(Math.cos(a) * r, -(r * r) / (2 * R_EARTH), Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings.length - 1; i++) {
    const a0 = 1 + (i - 1) * segs;
    const b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ recovery forces

/** Extrude a deck plan (x across: + = starboard, y along: + = bow) into a prism `h` metres tall. */
function plan(points, h, y0) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  // shape XY → ship X / −Z (bow), extrusion → +Y (up)
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** USS Hornet (CVS-12), an Essex-class carrier in haze grey: ~270 m long, angled flight deck, island
 *  with its funnel and mast, hull number, running lights (the Iwo Jima, LPH-2, is the same scaled down
 *  to 183 m). Ship frame: +Y up, −Z toward the bow. */
function createCarrier({ hull: number = '12', length = 270 } = {}) {
  const root = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x737a82, roughness: 0.7, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.8 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x262628, roughness: 0.8 });
  // deck: dark non-skid, the angled landing area with its edge lines and dashed centreline, "12"
  const dc = document.createElement('canvas');
  dc.width = 128;
  dc.height = 1024;
  const g = dc.getContext('2d');
  g.fillStyle = '#44474b';
  g.fillRect(0, 0, 128, 1024);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 128, Math.random() * 1024, 2 + Math.random() * 10, 1 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(235,235,225,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(62, 1010);
  g.lineTo(6, 520);
  g.moveTo(112, 1010);
  g.lineTo(56, 520);
  g.moveTo(66, 300);
  g.lineTo(66, 30); // catapult tracks
  g.moveTo(92, 300);
  g.lineTo(92, 30);
  g.stroke();
  g.strokeStyle = 'rgba(235,235,225,0.85)';
  g.setLineDash([18, 14]);
  g.beginPath();
  g.moveTo(87, 1010);
  g.lineTo(31, 520);
  g.stroke();
  g.fillStyle = 'rgba(235,235,225,0.85)';
  g.font = 'bold 60px sans-serif';
  g.fillText(number, 46, 140);
  const deckTex = new THREE.CanvasTexture(dc);
  deckTex.colorSpace = THREE.SRGBColorSpace;
  deckTex.anisotropy = 4;
  // plan coordinates x ∈ [−26, 18], y ∈ [−135, 135] → uv
  deckTex.repeat.set(1 / 44, 1 / 270);
  deckTex.offset.set(26 / 44, 0.5);
  const deck = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.9 });
  // hull: the bow tapering to the stem, a fuller stern
  const hullPts = [[-14, -128], [14, -128], [15, 40], [12, 100], [5, 128], [0, 134], [-5, 128], [-12, 100], [-15, 40]];
  const hull = new THREE.Mesh(plan(hullPts, 13.5, 2.5), grey);
  const waterline = new THREE.Mesh(plan(hullPts.map(([x, y]) => [x * 0.97, y * 0.99]), 4.5, -2), boot);
  // hangar deck (dark openings) between the hull and the flight deck
  const hangar = new THREE.Mesh(plan([[-13.5, -110], [13.5, -110], [13.5, 95], [-13.5, 95]], 3.4, 16), dark);
  // flight deck with the angled deck overhanging to port
  const fd = [[-16, -135], [18, -135], [18, 118], [6, 135], [-10, 135], [-16, 110], [-16, 10], [-22, -20], [-26, -70], [-22, -135]];
  const flight = new THREE.Mesh(plan(fd, 1.1, 19.4), [deck, grey]);
  const island = new THREE.Mesh(plan([[14, -32], [20, -32], [20, 20], [14, 20]], 11, 20.5), grey);
  const bridge = new THREE.Mesh(plan([[13.5, -18], [20.5, -18], [20.5, 10], [13.5, 10]], 3.2, 31.5), grey);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.9, 28.2), dark);
  windows.position.set(17, 33.6, 4);
  const funnel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 7, 11), grey);
  funnel.position.set(17, 38, 9);
  funnel.rotation.x = -0.12;
  const funnelTop = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.6, 11.2), dark);
  funnelTop.position.set(17, 41.6, 9.4);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 18, 6), grey);
  mast.position.set(17, 43.5, -4);
  const yard = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 0.3), grey);
  yard.position.set(17, 47, -4);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 0.3), dark);
  radar.position.set(17, 51, -4);
  root.add(hull, waterline, hangar, flight, island, bridge, windows, funnel, funnelTop, mast, yard, radar);
  // hull number on both sides of the island
  const nc = document.createElement('canvas');
  nc.width = 128;
  nc.height = 64;
  const ng = nc.getContext('2d');
  ng.fillStyle = '#f2f2ea';
  ng.font = 'bold 60px sans-serif';
  ng.textAlign = 'center';
  ng.fillText(number, 64, 56);
  const numTex = new THREE.CanvasTexture(nc);
  numTex.colorSpace = THREE.SRGBColorSpace;
  for (const sx of [1, -1]) {
    const num = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.8 }));
    num.position.set(17 + sx * 3.05, 26.5, -10);
    num.rotation.y = (sx * Math.PI) / 2;
    root.add(num);
  }
  // aircraft parked aft on the deck
  for (let i = 0; i < 7; i++) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 11), grey);
    a.position.set(-8 + (i % 2) * 10, 21.6, 80 + Math.floor(i / 2) * 13);
    root.add(a);
  }
  const lights = [];
  const light = (color, x, y, z, size = 0.8) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    m.position.set(x, y, z);
    root.add(m);
    lights.push(m);
  };
  light(0xff2a18, -16.5, 21, -40);
  light(0x22ff5a, 21, 21, -40);
  light(0xfff3d8, 17, 53, -4, 0.9);
  light(0xfff3d8, 0, 21, 135);
  root.traverse((o) => {
    if (o.isMesh && !lights.includes(o)) o.castShadow = o.receiveShadow = true;
  });
  const k = length / 270;
  root.scale.set(Math.min(1, k * 1.25), Math.min(1, k * 1.2), k);
  return root;
}

/** SH-3 Sea King ("Old 66") in Navy sea grey with its five-blade rotor. Frame: +Y up, −Z forward. */
function createHelicopter() {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4f5964, roughness: 0.6, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.6 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 9, 6, 12), body);
  fus.rotation.x = Math.PI / 2;
  const keel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.8, 9.5), white);
  keel.position.y = -1.0;
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 7, 8), body);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.6, 8.2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 1.4), body);
  fin.position.set(0, 1.9, 11.4);
  fin.rotation.x = -0.25;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.1, 8), body);
  hub.position.y = 1.9;
  const rotor = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 9.4), body);
    blade.position.z = 4.7;
    const arm = new THREE.Group();
    arm.rotation.y = (i * 2 * Math.PI) / 5;
    arm.add(blade);
    rotor.add(arm);
  }
  rotor.position.y = 2.45;
  // motion blur: a faint disc
  const disc = new THREE.Mesh(new THREE.CircleGeometry(9.4, 40), new THREE.MeshBasicMaterial({ color: 0x3a4048, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 2.45;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.2, 0.3), body);
  tail.position.set(0.35, 2.4, 11.6);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
  beacon.position.set(0, 1.5, 3);
  root.add(fus, keel, boom, fin, hub, rotor, disc, tail, beacon);
  root.traverse((o) => {
    if (o.isMesh && o !== disc) o.castShadow = true;
  });
  return { root, rotor, tail, beacon };
}

// ------------------------------------------------------------------ assembly

export function createRecovery({ recovery = null, light = true } = {}) {
  const group = new THREE.Group();
  group.name = 'Recovery';

  // ---- chutes
  const drogues = [0, 1].map(() => createChute({ radius: 2.5, height: 2.2, lines: 9, gores: 16, rings: 6, colors: ['#f4f1ea', '#f4f1ea', '#e2622a', '#f4f1ea'] }));
  const mains = [0, 1, 2].map(() => createChute({ radius: 12.4, height: 8.6, lines: 25, gores: 20, rings: 9, colors: ['#e5602a', '#f4f1ea'] }));
  for (const c of [...drogues, ...mains]) group.add(c.group);
  const risers = new THREE.BufferGeometry();
  risers.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(5 * 6), 3));
  const riserLines = new THREE.LineSegments(risers, new THREE.LineBasicMaterial({ color: 0xb4ad9f }));
  riserLines.frustumCulled = false;
  group.add(riserLines);
  const chute = { drogueT: -1, mainT: -1, splashT: -1, sprayed: false };

  // ---- fireball
  const shockU = { k: { value: 0 }, time: { value: 0 }, flowView: { value: new THREE.Vector3(0, 0, -1) } };
  const shock = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({ uniforms: shockU, vertexShader: PLASMA_VS, fragmentShader: SHOCK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  shock.visible = false;
  shock.renderOrder = 8;
  const wakeU = { k: { value: 0 }, time: { value: 0 } };
  const wakeGeo = new THREE.CylinderGeometry(2.6, 11, 140, 32, 1, true);
  wakeGeo.translate(0, -70, 0);
  const wake = new THREE.Mesh(
    wakeGeo,
    new THREE.ShaderMaterial({ uniforms: wakeU, vertexShader: PLASMA_VS, fragmentShader: WAKE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  wake.visible = false;
  wake.renderOrder = 8;
  group.add(shock, wake);
  // always in the scene (intensity 0 when cold): toggling a light would recompile every material
  const glow = light ? new THREE.PointLight(0xff8a3a, 0, 80, 1.5) : null;
  if (glow) group.add(glow);
  let sparkAcc = 0;
  let heatNow = 0;

  // ---- ocean, carrier, helicopter
  const EDGE = 95000;
  const oceanU = {
    sunDir: { value: new THREE.Vector3() },
    upW: { value: new THREE.Vector3(0, 1, 0) },
    eastW: { value: new THREE.Vector3(1, 0, 0) },
    skyTint: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 1 / 30000 },
    time: { value: 0 },
    exposure: { value: 1 },
    opacity: { value: 1 },
    edgeR: { value: EDGE },
    offset: { value: new THREE.Vector2() },
    cm: { value: new THREE.Vector2() },
    splashT: { value: -1 },
    shipL: { value: new THREE.Vector2() },
    shipDir: { value: new THREE.Vector2(0, 1) },
    shipOn: { value: 0 },
    shipSpeed: { value: 0 },
    shipHalf: { value: (recovery?.length ?? 270) / 2 },
  };
  const ocean = new THREE.Mesh(oceanGeometry(EDGE), new THREE.ShaderMaterial({ uniforms: oceanU, vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, transparent: true }));
  ocean.frustumCulled = false;
  ocean.visible = false;
  ocean.renderOrder = -2;
  const ship = createCarrier(recovery ?? {});
  ship.visible = false;
  const heli = createHelicopter();
  heli.root.visible = false;
  group.add(ocean, ship, heli.root);
  // Earth-fixed anchor of the wave coordinates (re-anchored when far, before float precision suffers)
  let anchor = null;
  // the carrier: Earth-fixed position, heading and speed (placed when the capsule comes down)
  const shipEF = new THREE.Vector3();
  const shipHead = new THREE.Vector3();
  const shipW = new THREE.Vector3();
  let shipSet = false;
  let shipSpeed = 0;
  let heliAng = Math.random() * Math.PI * 2;
  const cmEF = new THREE.Vector3();
  const centreEF = new THREE.Vector3();
  const eastEF = new THREE.Vector3();
  const northEF = new THREE.Vector3();
  const grav = new THREE.Vector3();
  /** ECI point → anchor-relative east/north (m) in the ocean's plane. */
  const plane = (eci, th, out2) => {
    const f = toFixed(eci, th, _d).sub(anchor);
    return out2.set(f.dot(eastEF), f.dot(northEF));
  };

  function update({ camWorld, camQ, sunDir, vehicle, dyn, time, dt, utc, skyTint, fogColor, nearLaunchSite, flames, smoke }) {
    const st = vehicle.state;
    const parts = vehicle.parts;
    const cm = vehicle.config === 'CM';
    const earth = st.primary === 'EARTH';
    const th = gmst(utc);
    _up.copy(st.r).normalize();

    // ---------------- fireball: heating ~ q·v, from ~90 km until the capsule slows below ~4 km/s
    const va = st.vSurface.length();
    const heat = earth && dyn.mode === 'ENTRY' && !parts.drogues ? Math.min(1.15, Math.sqrt((st.dynPressure * va) / 8e7)) * THREE.MathUtils.smoothstep(va, 2600, 4600) : 0;
    heatNow = heat;
    shock.visible = wake.visible = heat > 0.02;
    if (glow) glow.intensity = heat * 30;
    if (shock.visible) {
      const flow = _a.copy(st.vSurface).normalize(); // direction of travel through the air
      shock.position.copy(st.r).addScaledVector(flow, 0.8).sub(camWorld);
      shock.quaternion.setFromUnitVectors(Y, flow);
      shock.scale.set(2.9 + heat * 0.3, 1.55, 2.9 + heat * 0.3);
      shockU.k.value = heat;
      shockU.time.value = time;
      shockU.flowView.value.copy(flow).applyQuaternion(_q.copy(camQ).invert());
      wake.position.copy(st.r).addScaledVector(flow, 0.3).sub(camWorld);
      wake.quaternion.setFromUnitVectors(Y, flow);
      wake.scale.set(1, 0.6 + heat * 0.5, 1);
      wakeU.k.value = Math.min(1, heat);
      wakeU.time.value = time;
      if (glow) glow.position.copy(st.r).addScaledVector(flow, 3).sub(camWorld);
      // ablation sparks peeling off the shield's shoulder and streaming back in the wake
      if (flames && dt > 0) {
        sparkAcc += dt * 110 * heat;
        while (sparkAcc >= 1) {
          sparkAcc -= 1;
          const ang = Math.random() * Math.PI * 2;
          const side = _b.set(Math.cos(ang), Math.sin(ang), Math.cos(ang * 3.7));
          side.addScaledVector(flow, -side.dot(flow));
          if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
          side.normalize();
          const pos = new THREE.Vector3().copy(st.r).addScaledVector(side, 1.9).addScaledVector(flow, 0.4);
          const vel = new THREE.Vector3().copy(st.v).addScaledVector(flow, -(120 + Math.random() * 380)).addScaledVector(side, 2 + Math.random() * 7);
          flames.emit({ pos, vel, life: 0.2 + Math.random() * 0.35, size0: 0.18 + Math.random() * 0.2, size1: 0.35 + Math.random() * 0.5, alpha: Math.min(1, heat * 1.2), drag: 0, tint: [5, 2.6 + Math.random() * 1.2, 0.9] });
        }
      }
    }

    // ---------------- parachutes
    if (parts.drogues && chute.drogueT < 0) chute.drogueT = time;
    if (parts.mains && chute.mainT < 0) chute.mainT = time;
    if (st.splashed && chute.splashT < 0) chute.splashT = time;
    const afloat = chute.splashT >= 0 ? time - chute.splashT : -1;
    const apex = _b.copy(X).applyQuaternion(st.q).multiplyScalar(2.2).add(st.r);
    const riserPos = risers.attributes.position.array;
    let ri = 0;
    enu(_up, _east, _north);
    const tilt = (az, ang, out) => out.copy(_up).multiplyScalar(Math.cos(ang)).addScaledVector(_east, Math.sin(ang) * Math.cos(az)).addScaledVector(_north, Math.sin(ang) * Math.sin(az)).normalize();
    // drape: 0 flying … 1 lying on the water (the canopy turns dome-up, the lines lie along the sea);
    // squash: the canopy losing its shape; sink: metres below the flying position
    const place = (c, dir, riser, open, deploy, spin, drape = 0, sink = 0, squash = 1) => {
      c.group.visible = true;
      const conf = _c.copy(apex).addScaledVector(dir, riser * deploy).addScaledVector(_up, -sink);
      c.group.position.copy(conf).sub(camWorld);
      c.group.quaternion.setFromUnitVectors(Y, dir);
      c.group.rotateY(spin);
      // reefed: a narrow, elongated canopy; breathing a little once full
      const breathe = open > 0.95 && drape === 0 ? 0.02 * Math.sin(time * 1.6 + spin * 7) : 0;
      c.group.scale.set(open * (1 + breathe), deploy, open * (1 + breathe));
      if (drape > 0) {
        _q.copy(c.group.quaternion).invert();
        _q2.setFromUnitVectors(Y, _a.copy(_up).applyQuaternion(_q));
        c.canopy.quaternion.slerpQuaternions(ID, _q2, drape);
      } else c.canopy.quaternion.identity();
      c.canopy.scale.set(1, (1.3 - 0.3 * open) * squash, 1);
      c.lines.scale.set(1 - 0.9 * drape, 1, 1 - 0.9 * drape);
      riserPos[ri++] = apex.x - camWorld.x;
      riserPos[ri++] = apex.y - camWorld.y;
      riserPos[ri++] = apex.z - camWorld.z;
      riserPos[ri++] = conf.x - camWorld.x;
      riserPos[ri++] = conf.y - camWorld.y;
      riserPos[ri++] = conf.z - camWorld.z;
    };
    const showDrogues = cm && parts.drogues && !parts.mains && !st.splashed;
    drogues.forEach((c, i) => {
      if (!showDrogues) return void (c.group.visible = false);
      const t = time - chute.drogueT;
      const deploy = Math.min(1, t / 0.7);
      const open = deploy < 1 ? 0.15 : Math.min(1, 0.15 + (t - 0.7) * 1.2);
      place(c, tilt(i * Math.PI + 0.4, 0.11 + 0.03 * Math.sin(time * 1.3 + i), _d), 16, open, deploy, i * 2.1 + time * 0.3);
    });
    mains.forEach((c, i) => {
      if (!cm || !parts.mains || afloat > 60) return void (c.group.visible = false);
      // line stretch, reefed for ~8 s, disreefed to full; cut loose after splashdown, draped on the sea
      const t = time - chute.mainT;
      const deploy = Math.min(1, t / 1.2);
      const open = t < 1.2 ? 0.08 : t < 8 ? 0.08 + Math.min(1, (t - 1.2) / 1.5) * 0.24 : Math.min(1, 0.32 + ((t - 8) / 2.2) * 0.68);
      // after splashdown: the canopies spill their air and sag (2–3 s), topple over, settle flat on
      // the water and slowly sink
      const sag = afloat > 0 ? THREE.MathUtils.smoothstep(afloat, 0, 2.5) : 0;
      const k = afloat > 0 ? THREE.MathUtils.smoothstep(afloat, 1, 6) : 0;
      const sway = 0.05 * Math.sin(time * 0.45 + i * 2.1) * (1 - k);
      const sink = afloat > 0 ? 2.2 * k + Math.max(0, afloat - 10) * 0.3 : 0;
      const spread = afloat > 0 ? 1 - 0.3 * sag * (1 - k) + 0.06 * k : open;
      const squash = (1 - 0.5 * sag) * (1 - 0.72 * k);
      place(c, tilt((i * 2 * Math.PI) / 3 + 0.5 + sway, 0.4 + sway * 0.5 + k * 1.12, _d), 11 * (1 - k * 0.4), spread, deploy, i * 2.4 + time * (0.04 + i * 0.01) * (1 - k), k, sink, squash);
    });
    for (let i = ri; i < riserPos.length; i++) riserPos[i] = 0;
    risers.attributes.position.needsUpdate = true;
    riserLines.visible = ri > 0;

    // ---------------- the sea (away from the launch site's own coast), carrier and helicopter
    const camAlt = camWorld.length() - R_EARTH;
    ocean.visible = earth && !nearLaunchSite && camAlt < 44000 && (cm || st.splashed);
    ship.visible = heli.root.visible = false;
    oceanU.shipOn.value = 0;
    if (!ocean.visible) return;
    const centre = _c.copy(camWorld).setLength(R_EARTH);
    toFixed(centre, th, centreEF);
    if (!anchor || anchor.distanceTo(centreEF) > 40000) anchor = centreEF.clone();
    const upC = _a.copy(centre).normalize();
    enu(upC, _east, _north);
    // disc frame: +X east, +Y up, +Z south
    _m.makeBasis(_east, upC, _d.copy(_north).negate());
    ocean.quaternion.setFromRotationMatrix(_m);
    ocean.position.copy(centre).sub(camWorld);
    oceanU.upW.value.copy(upC);
    oceanU.eastW.value.copy(_east);
    // wave coordinates: east/north of the anchor, Earth-fixed (the sea turns with the Earth)
    toFixed(_east, th, eastEF);
    toFixed(_north, th, northEF);
    _d.copy(centreEF).sub(anchor);
    oceanU.offset.value.set(_d.dot(eastEF), _d.dot(northEF));
    oceanU.sunDir.value.copy(sunDir);
    oceanU.skyTint.value.copy(skyTint);
    oceanU.fogColor.value.copy(fogColor);
    oceanU.fogDensity.value = 1 / (30000 + camAlt * 5);
    oceanU.opacity.value = 1 - THREE.MathUtils.smoothstep(camAlt, 14000, 44000);
    oceanU.time.value = time;
    plane(_b.copy(st.r).setLength(R_EARTH), th, oceanU.cm.value);
    oceanU.splashT.value = afloat;
    // splashdown: a burst of spray
    if (afloat >= 0 && !chute.sprayed && smoke) {
      chute.sprayed = true;
      grav.copy(_up).multiplyScalar(-9.8);
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const out = _b.copy(_east).multiplyScalar(Math.cos(a)).addScaledVector(_north, Math.sin(a));
        const pos = new THREE.Vector3().copy(st.r).addScaledVector(out, 1.5 + Math.random() * 1.5);
        const vel = new THREE.Vector3(-OMEGA * pos.y, OMEGA * pos.x, 0).addScaledVector(out, 3 + Math.random() * 9).addScaledVector(_up, 4 + Math.random() * 12);
        smoke.emit({ pos, vel, life: 1.6 + Math.random() * 1.6, size0: 1.2, size1: 5 + Math.random() * 5, alpha: 0.7, drag: 0.6, rise: grav, tint: [1, 1, 1] });
      }
    }

    if (!recovery) return;
    // the capsule's spot on the sea, Earth-fixed
    toFixed(_b.copy(st.r).setLength(R_EARTH), th, cmEF);
    const altCM = st.r.length() - R_EARTH;
    if (!shipSet) {
      earthFixedToEci(recovery.lat * DEG, recovery.lon * DEG, 0, utc, shipW);
      toFixed(shipW, th, shipEF);
      // the carrier stands off a few miles, never under the capsule
      if (altCM < 9000) {
        const away = _a.copy(shipEF).sub(cmEF);
        const d = away.length();
        if (d < 3500) {
          if (d < 50) away.copy(eastEF);
          shipEF.copy(cmEF).addScaledVector(away.normalize(), 3800).setLength(R_EARTH);
        }
        shipSet = true;
      }
      shipHead.copy(cmEF).sub(shipEF);
    }
    // she steams toward the capsule; after splashdown at up to ~15 knots, stopping ~900 m off
    const upS = _d.copy(shipEF).normalize();
    const toCM = _a.copy(cmEF).sub(shipEF);
    toCM.addScaledVector(upS, -toCM.dot(upS));
    const dCM = toCM.length();
    const want = afloat >= 0 ? THREE.MathUtils.clamp((dCM - 900) / 120, 0, 7.7) : Math.min(2.5, Math.max(0, (dCM - 900) / 120));
    shipSpeed += (want - shipSpeed) * Math.min(1, dt * 0.08);
    if (dCM > 1) {
      shipHead.addScaledVector(upS, -shipHead.dot(upS)).normalize();
      shipHead.lerp(toCM.normalize(), Math.min(1, dt * 0.02)).normalize();
      if (dCM < 60000) shipEF.addScaledVector(shipHead, shipSpeed * dt).setLength(R_EARTH);
    }
    if (shipEF.distanceTo(cmEF) > EDGE) return;
    ship.visible = true;
    toEci(shipEF, th, shipW);
    const upW = _a.copy(shipW).normalize();
    const headW = toEci(shipHead, th, _b);
    headW.addScaledVector(upW, -headW.dot(upW)).normalize();
    const starboard = _c.crossVectors(headW, upW);
    _m.makeBasis(starboard, upW, _d.copy(headW).negate());
    ship.quaternion.setFromRotationMatrix(_m);
    // a slow roll and pitch in the swell
    ship.quaternion.multiply(_q.setFromEuler(_e.set(Math.sin(time * 0.31) * 0.006, 0, Math.sin(time * 0.23 + 1) * 0.012)));
    ship.position.copy(shipW).addScaledVector(upW, Math.sin(time * 0.5) * 0.25).sub(camWorld);
    plane(shipW, th, oceanU.shipL.value);
    oceanU.shipDir.value.set(shipHead.dot(eastEF), shipHead.dot(northEF)).normalize();
    oceanU.shipOn.value = 1;
    oceanU.shipSpeed.value = shipSpeed;

    // Recovery 1: circles the capsule under its chutes, then hovers off it once it is down
    if (cm && (parts.mains || st.splashed)) {
      heli.root.visible = true;
      const r = afloat >= 0 ? 70 : 420;
      const h = afloat >= 0 ? 28 : Math.max(120, Math.min(460, altCM * 0.35));
      heliAng += (afloat >= 0 ? 0.04 : 38 / r) * dt;
      const sub = toEci(cmEF, th, new THREE.Vector3());
      const upH = sub.clone().normalize();
      const e = new THREE.Vector3();
      const n = new THREE.Vector3();
      enu(upH, e, n);
      const radial = e.multiplyScalar(Math.cos(heliAng)).addScaledVector(n, Math.sin(heliAng));
      sub.addScaledVector(radial, r).addScaledVector(upH, h);
      // flying tangentially and banked into the turn; nose toward the capsule when hovering
      const fwd = afloat >= 0 ? radial.clone().negate() : new THREE.Vector3().crossVectors(upH, radial);
      const right = new THREE.Vector3().crossVectors(fwd, upH);
      _m.makeBasis(right, upH, fwd.negate());
      heli.root.quaternion.setFromRotationMatrix(_m);
      heli.root.quaternion.multiply(_q.setFromEuler(_e.set(afloat >= 0 ? 0.04 : -0.06, 0, afloat >= 0 ? Math.sin(time * 0.7) * 0.03 : 0.22)));
      heli.root.position.copy(sub).sub(camWorld);
      heli.rotor.rotation.y = time * 21;
      heli.tail.rotation.x = time * 90;
      heli.beacon.visible = Math.sin(time * 6) > 0.6;
    }
  }

  return {
    group,
    update,
    objects: { ship, heli: heli.root, ocean, shock, wake },
    /** Entry heating 0…~1.15 (drives the shock-layer glow, also inside the cabin). */
    get heat() {
      return heatNow;
    },
    dispose() {
      for (const c of [...drogues, ...mains]) c.dispose();
      risers.dispose();
      riserLines.material.dispose();
      shock.geometry.dispose();
      shock.material.dispose();
      wake.geometry.dispose();
      wake.material.dispose();
      ocean.geometry.dispose();
      ocean.material.dispose();
      for (const root of [ship, heli.root]) {
        root.traverse((o) => {
          o.geometry?.dispose?.();
          for (const m of [o.material].flat()) {
            m?.map?.dispose?.();
            m?.dispose?.();
          }
        });
      }
    },
  };
}
