// Late 2000s console look: HDR render, bloom on anything bright, filmic tone mapping,
// then a muted military colour grade with vignette and film grain.
import * as THREE from 'three';
import { EffectComposer } from '../assets/vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../assets/vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../assets/vendor/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../assets/vendor/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from '../assets/vendor/jsm/postprocessing/OutputPass.js';

export const LOOK = {
  exposure: 1.5,
  bloom: 0.4, bloomRadius: 0.6, bloomThreshold: 1.0,
  saturation: 0.62,          // 1 = full colour, 0 = black and white
  contrast: 1.12,
  vignette: 0.9,
  grain: 0.045,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, saturation: { value: LOOK.saturation }, contrast: { value: LOOK.contrast },
    vignette: { value: LOOK.vignette }, grain: { value: LOOK.grain } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, saturation, contrast, vignette, grain; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);                                                        // washed out colour
      c *= mix(vec3(0.86, 1.0, 0.90), vec3(1.08, 1.0, 0.86), smoothstep(0.15, 0.8, l));       // green shadows, warm highlights
      c = (c - 0.5) * contrast + 0.5;
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * vignette;
      float n = fract(sin(dot(gl_FragCoord.xy + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LOOK.exposure;
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), LOOK.bloom, LOOK.bloomRadius, LOOK.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setSize(w, h, ratio) { this.composer.setPixelRatio(ratio); this.composer.setSize(w, h); }
  render(dt) { this.grade.uniforms.time.value += dt; this.composer.render(dt); }
}
