// Atmospheric sky dome (single-scattering approximation: Rayleigh + Mie with Chapman/Kasten-Young
// air masses). Blue daylight, warm low-sun skies, haze toward the horizon, black space above
// ~100 km. Drawn additively in the far pass after the Earth so it also hazes the planet below.
// skyColor() mirrors the shader on the CPU (fog colour / exposure / star visibility).

import * as THREE from 'three';

const VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FS = /* glsl */ `
uniform vec3 sunDir; uniform vec3 up; uniform float alt; uniform float intensity; uniform float exposure;
varying vec3 vDir;
const vec3 BR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float BM = 1.3e-5;
const float HR = 8000.0;
const float HM = 1200.0;
const float PI = 3.14159265;
float airmass(float mu){
  float z = acos(clamp(mu, -1.0, 1.0)) * 57.29578;
  return 1.0 / (max(mu, 0.0) + 0.50572 * pow(max(96.07995 - z, 0.5), -1.6364));
}
float depth(float h, float mu, float H){
  if (mu >= -0.02) return H * exp(-h / H) * airmass(max(mu, 0.0));
  // looking down: path to the ground through the layers below the camera
  float m = -mu;
  return H * (1.0 - exp(-h / H)) / max(m, 0.02) + H * exp(-h / H) * 0.0;
}
void main(){
  vec3 d = normalize(vDir);
  float mu = dot(d, up);
  float muS = dot(sunDir, up);
  float nu = dot(d, sunDir);
  float h = max(alt, 0.0);
  vec3 tauV = BR * depth(h, mu, HR) + BM * 1.1 * depth(h, mu, HM);
  vec3 tauS = BR * depth(h, muS, HR) + BM * 1.1 * depth(h, muS, HM);
  vec3 sunT = exp(-tauS) * smoothstep(-0.12, 0.02, muS);
  float pR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
  float g = 0.76;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + nu * nu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * nu, 1.5));
  vec3 sc = (BR * pR + BM * pM) / (BR + BM * 1.1);
  vec3 col = sc * (1.0 - exp(-tauV)) * sunT * intensity;
  // twilight glow from the sunlit upper atmosphere
  col += vec3(0.35, 0.22, 0.12) * 0.04 * intensity * exp(-abs(mu) * 6.0) * smoothstep(-0.35, 0.0, muS) * (1.0 - smoothstep(0.0, 0.2, muS)) * exp(-h / 30000.0);
  gl_FragColor = vec4(col * exposure, 1.0);
}`;

export function createSky() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(0, 0, 1) },
    up: { value: new THREE.Vector3(0, 0, 1) },
    alt: { value: 0 },
    intensity: { value: 16 },
    exposure: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS,
    fragmentShader: FS,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return {
    mesh,
    uniforms,
    update(camUp, sunDir, alt) {
      uniforms.up.value.copy(camUp);
      uniforms.sunDir.value.copy(sunDir);
      uniforms.alt.value = alt;
      mesh.visible = alt < 140000;
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

const _c = new THREE.Color();
/** CPU estimate of the sky radiance toward the horizon / zenith (for fog colour, star visibility). */
export function skyColor(muView, muSun, alt, out = _c) {
  const BR = [5.8e-6, 13.5e-6, 33.1e-6];
  const BM = 1.3e-5;
  const am = (mu) => {
    const z = (Math.acos(Math.max(-1, Math.min(1, mu))) * 180) / Math.PI;
    return 1 / (Math.max(mu, 0) + 0.50572 * Math.pow(Math.max(96.07995 - z, 0.5), -1.6364));
  };
  const dep = (mu, H) => H * Math.exp(-alt / H) * am(Math.max(mu, 0));
  const sunVis = Math.max(0, Math.min(1, (muSun + 0.12) / 0.14));
  const rgb = [0, 1, 2].map((i) => {
    const tv = BR[i] * dep(muView, 8000) + BM * 1.1 * dep(muView, 1200);
    const ts = BR[i] * dep(muSun, 8000) + BM * 1.1 * dep(muSun, 1200);
    const sc = (BR[i] * 0.06 + BM * 0.08) / (BR[i] + BM * 1.1);
    return sc * (1 - Math.exp(-tv)) * Math.exp(-ts) * sunVis * 16;
  });
  return out.setRGB(rgb[0], rgb[1], rgb[2]);
}
