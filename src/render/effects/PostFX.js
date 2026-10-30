// HDR post-processing: the scene is drawn (by a callback, so multi-pass camera-relative rendering
// keeps working) into a half-float target, then bloom, then tone mapping + sRGB output.
//   const fx = createPostFX(game); fx.render((renderer) => { ...draw passes... }); fx.resize(w, h)

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

class CallbackPass extends Pass {
  constructor() {
    super();
    this.fn = null;
    this.needsSwap = false;
    this.clear = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    this.fn?.(renderer);
  }
}

// Film look: vignette, very light grain, slight chromatic fringe at the edges.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.35 }, grain: { value: 0.025 }, fade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float vignette; uniform float grain; uniform float fade;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= 1.0 - vignette * smoothstep(0.08, 0.6, r2);
      col += (rand(vUv * 731.0 + time) - 0.5) * grain;
      col *= 1.0 - fade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPostFX(game, { bloom = true, strength = 0.42, radius = 0.55, threshold = 0.82, film = true } = {}) {
  const r = game.renderer;
  const composer = new EffectComposer(r);
  const scenePass = new CallbackPass();
  composer.addPass(scenePass);
  let bloomPass = null;
  if (bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(game.width, game.height), strength, radius, threshold);
    composer.addPass(bloomPass);
  }
  const output = new OutputPass();
  composer.addPass(output);
  let filmPass = null;
  if (film) {
    filmPass = new ShaderPass(FilmShader);
    composer.addPass(filmPass);
  }
  const resize = (w, h) => {
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(w, h);
  };
  resize(game.width, game.height);
  return {
    composer,
    bloomPass,
    filmPass,
    render(fn, dt = 0.016) {
      scenePass.fn = fn;
      if (filmPass) filmPass.uniforms.time.value = (filmPass.uniforms.time.value + dt) % 100;
      composer.render(dt);
    },
    setBloom(s) {
      if (bloomPass) bloomPass.strength = s;
    },
    setFade(k) {
      if (filmPass) filmPass.uniforms.fade.value = k;
    },
    setVignette(k) {
      if (filmPass) filmPass.uniforms.vignette.value = k;
    },
    resize,
    dispose() {
      composer.dispose();
      bloomPass?.dispose?.();
      filmPass?.material?.dispose?.();
      output.dispose?.();
    },
  };
}
