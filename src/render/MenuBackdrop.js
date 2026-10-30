// Menu backdrop: "Earthrise" from lunar orbit (Apollo 8, 24 Dec 1968) — the lunar limb sliding
// below, the Earth slowly rising over it, the CSM drifting in the foreground. Rendered in two
// passes (far: Moon/Earth/stars/Sun · near: spacecraft) so depth precision is never an issue.
//   createMenuBackdrop(game) → { update(dt), render(), resize(w, h), setFocus(k), dispose() }

import * as THREE from 'three';
import { R_MOON } from '../core/constants.js';
import { createEarth, createMoon, createStarfield, createSun } from './env/Bodies.js';
import { createCSM } from './models/index.js';

const DEG = Math.PI / 180;
const ORBIT_ALT = 112e3;
const EARTH_DIST = 3.844e8;

export function createMenuBackdrop(game) {
  const far = new THREE.Scene();
  const near = new THREE.Scene();
  const aspect = game.width / game.height;
  const farCam = new THREE.PerspectiveCamera(20, aspect, 2e3, 2e9);
  const nearCam = new THREE.PerspectiveCamera(20, aspect, 0.5, 5000);
  const state = { t: 0, focus: 0, focusT: 0, disposed: false, ready: false };

  const R = R_MOON + ORBIT_ALT;
  const dip = Math.acos(R_MOON / R); // horizon depression
  const sunDir = new THREE.Vector3(-0.32, -0.93, 0.18).normalize();

  const stars = createStarfield({ count: 7000, radius: 1.5e9 });
  far.add(stars.group);
  const sun = createSun({ flare: false });
  far.add(sun.group);

  let earth = null;
  let moon = null;
  const moonPivot = new THREE.Group(); // rotates to make the surface stream below the camera
  far.add(moonPivot);

  const load = async () => {
    const tex = (n, o) => game.assets.texture(n, o).catch(() => null);
    const [day, night, clouds, water, mcol, mh] = await Promise.all([
      tex('earth_day', { sizes: ['4k', '2k'] }),
      tex('earth_night_2k'),
      tex('earth_clouds_2k', { srgb: false }),
      tex('earth_water_2k', { srgb: false }),
      tex('moon_color', { sizes: ['4k', '2k'] }),
      tex('moon_height_1k', { srgb: false }),
    ]);
    if (state.disposed) return;
    earth = createEarth({ day, night, clouds, water }, { segments: 96 });
    earth.setSun(sunDir);
    earth.setRotation(2.2);
    far.add(earth.group);
    moon = createMoon({ color: mcol, height: mh }, { segments: 192 });
    moon.setSun(sunDir);
    moon.uniforms.bump.value = 3.2;
    moon.uniforms.exposure.value = 1.15;
    moonPivot.add(moon.mesh);
    state.ready = true;
  };
  const loading = load();

  // spacecraft in the foreground
  const csm = createCSM();
  const craft = new THREE.Group();
  craft.add(csm.root);
  near.add(craft);
  const key = new THREE.DirectionalLight(0xfff3e2, 4.2);
  key.position.copy(sunDir).multiplyScalar(100);
  const fill = new THREE.HemisphereLight(0x5b6b86, 0x8a8478, 0.35);
  near.add(key, fill);
  const envRT = new THREE.WebGLCubeRenderTarget(64);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x101418);
  const envCam = new THREE.CubeCamera(0.1, 100, envRT);
  const grad = new THREE.Mesh(
    new THREE.SphereGeometry(10, 16, 8),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 sunDir; varying vec3 vD; void main(){ vec3 d = normalize(vD); float s = pow(max(dot(d, sunDir), 0.0), 40.0); float g = smoothstep(0.1, -0.6, d.z); vec3 c = vec3(0.004) + vec3(0.45, 0.43, 0.4) * g * 0.6 + vec3(6.0, 5.6, 5.0) * s; gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  envScene.add(grad);
  envCam.update(game.renderer, envScene);
  near.environment = envRT.texture;
  near.environmentIntensity = 0.6;

  const lookQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const camOffset = new THREE.Vector3();

  function cameraQuat(yawDeg, pitchDeg, out) {
    // base: looking along +X with +Z up (camera right = −Y); +yaw turns right, +pitch up
    const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
    tmpE.set(pitchDeg * DEG, -yawDeg * DEG, 0, 'YXZ');
    return out.copy(base).multiply(new THREE.Quaternion().setFromEuler(tmpE));
  }

  function dirFrom(yawDeg, pitchDeg, out) {
    // yaw positive → toward −Y (screen right), pitch positive → +Z (up)
    const y = yawDeg * DEG;
    const p = pitchDeg * DEG;
    return out.set(Math.cos(p) * Math.cos(y), -Math.cos(p) * Math.sin(y), Math.sin(p));
  }

  const earthDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  return {
    loading,
    setFocus(k) {
      state.focusT = k;
    },
    update(dt) {
      state.t += dt;
      const t = state.t;
      state.focus += (state.focusT - state.focus) * Math.min(1, dt * 1.5);
      const horizonPitch = -dip / DEG;
      // gentle handheld drift + slow pan when the focus changes (menu screens)
      const yaw = 2.5 + Math.sin(t * 0.05) * 0.5 + state.focus * 2.2;
      const pitch = horizonPitch + 2.7 + Math.sin(t * 0.07) * 0.25 - state.focus * 0.6;
      cameraQuat(yaw, pitch, lookQ);
      farCam.quaternion.copy(lookQ);
      nearCam.quaternion.copy(lookQ);
      // camera at the origin of the far scene; the Moon centre sits below it
      moonPivot.position.set(0, 0, -R);
      moonPivot.rotation.set(0, -(t * 0.0012) % (Math.PI * 2), 0);
      if (moon) moon.mesh.rotation.set(0, 0, 0.4);
      // Earth rising: 0.1° → 1.8° above the limb over ~80 s, then holding
      const rise = 0.1 + 1.7 * (1 - Math.exp(-t / 34));
      dirFrom(6.2, horizonPitch + rise, earthDir);
      if (earth) {
        earth.setPosition(tmp.copy(earthDir).multiplyScalar(EARTH_DIST));
        earth.setRotation(2.2 + t * 0.002);
        earth.uniforms.cloudShift.value = t * 0.00004;
      }
      if (moon) moon.uniforms.earthDir.value.copy(earthDir);
      sun.group.position.copy(sunDir).multiplyScalar(1e9);
      sun.setSize(1e9, 0.12);
      stars.setVisibility(0.9);
      stars.setPixelScale(Math.min(2, game.renderer.getPixelRatio()));
      // spacecraft: ~95 m away, upper right, slow tumble
      dirFrom(yaw + 9.5, pitch + 4.2, camOffset).multiplyScalar(95);
      craft.position.copy(camOffset);
      craft.rotation.set(0.35 + t * 0.012, -0.5 + Math.sin(t * 0.03) * 0.15, 0.9 + t * 0.008);
    },
    render() {
      const r = game.renderer;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.toneMappingExposure = 1.0;
      r.clear();
      r.render(far, farCam);
      r.clearDepth();
      r.render(near, nearCam);
    },
    resize(w, h) {
      for (const c of [farCam, nearCam]) {
        c.aspect = w / h;
        // keep the composition on narrow screens
        c.fov = w / h < 1.5 ? 26 : 20;
        c.updateProjectionMatrix();
      }
    },
    dispose() {
      state.disposed = true;
      stars.dispose();
      sun.dispose();
      earth?.dispose();
      moon?.dispose();
      envRT.dispose();
      grad.geometry.dispose();
      grad.material.dispose();
      csm.dispose?.();
      near.traverse((o) => {
        o.geometry?.dispose?.();
      });
    },
  };
}
