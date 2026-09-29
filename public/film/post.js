// Post: a dual-filter bloom chain, light shafts, then a single grade pass (tone map, split-tone, chromatic
// aberration, zoom and directional blur, vignette, grain, flash, fade). Stills can accumulate many sub-frames
// into one HDR exposure before the grade.
import { createProgram, createTarget, deleteTarget, FULLSCREEN_VS } from './gl.js';

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform int uPrefilter;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv + vec2(-t.x, -t.y)).rgb;
  c += texture(uTex, vUv + vec2( t.x, -t.y)).rgb;
  c += texture(uTex, vUv + vec2(-t.x,  t.y)).rgb;
  c += texture(uTex, vUv + vec2( t.x,  t.y)).rgb;
  c /= 8.0;
  if (uPrefilter == 1) {
    float l = max(max(c.r, c.g), c.b);
    float k = smoothstep(uThreshold, uThreshold + 0.6, l);
    c *= k;
  }
  o = vec4(c, 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec3 c = texture(uTex, vUv + vec2(-t.x * 2.0, 0.0)).rgb;
  c += texture(uTex, vUv + vec2(-t.x, t.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(0.0, t.y * 2.0)).rgb;
  c += texture(uTex, vUv + vec2(t.x, t.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(t.x * 2.0, 0.0)).rgb;
  c += texture(uTex, vUv + vec2(t.x, -t.y)).rgb * 2.0;
  c += texture(uTex, vUv + vec2(0.0, -t.y * 2.0)).rgb;
  c += texture(uTex, vUv + vec2(-t.x, -t.y)).rgb * 2.0;
  o = vec4(c / 12.0, 1.0);
}`;

const RAYS_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSun;
uniform float uDecay, uDensity;
out vec4 o;
void main(){
  vec2 d = (uSun - vUv) * uDensity / 40.0;
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0;
  for (int i = 0; i < 40; i++) {
    uv += d;
    acc += texture(uTex, uv).rgb * w;
    w *= uDecay;
  }
  o = vec4(acc / 14.0, 1.0);
}`;

const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uWeight;
out vec4 o;
void main(){ o = vec4(texture(uTex, vUv).rgb * uWeight, 1.0); }`;

const GRADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom, uRays;
uniform float uRaysAmt;
uniform vec2 uRes;
uniform float uBloomAmt, uExposure, uCA, uVignette, uGrain, uTime, uFlash, uFade, uBlurAmt, uLift, uSaturation;
uniform vec3 uFlashCol, uShadowTint, uHighTint;
uniform vec2 uBlurDir;
uniform float uZoomBlur;
out vec4 o;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 sampleScene(vec2 uv){
  vec2 d = uv - 0.5;
  float ca = uCA * dot(d, d);
  vec3 c;
  c.r = texture(uScene, uv - d * ca).r;
  c.g = texture(uScene, uv).g;
  c.b = texture(uScene, uv + d * ca).b;
  return c;
}

void main(){
  vec3 col;
  if (uBlurAmt > 0.001 || uZoomBlur > 0.001) {
    col = vec3(0.0);
    float tot = 0.0;
    for (int i = 0; i < 12; i++) {
      float f = float(i) / 11.0 - 0.5;
      vec2 off = uBlurDir * uBlurAmt * f + (vUv - 0.5) * uZoomBlur * f;
      float w = 1.0 - abs(f) * 1.2;
      col += sampleScene(vUv + off) * w;
      tot += w;
    }
    col /= tot;
  } else {
    col = sampleScene(vUv);
  }
  col += texture(uBloom, vUv).rgb * uBloomAmt;
  col += texture(uRays, vUv).rgb * uRaysAmt;
  col = 1.0 - exp(-max(col, 0.0) * uExposure);
  // split tone: cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += uShadowTint * (1.0 - smoothstep(0.0, 0.45, l)) * 0.06;
  col += uHighTint * smoothstep(0.55, 1.0, l) * 0.05;
  col = mix(vec3(l), col, uSaturation);
  col = col * (1.0 - uLift) + uLift;
  // vignette
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.25, length(d));
  // flash and fade
  col = mix(col, uFlashCol, clamp(uFlash, 0.0, 1.0));
  col *= 1.0 - clamp(uFade, 0.0, 1.0);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // grain, applied in display space so it reads as film, not noise
  float g = hash12(vUv * uRes + fract(uTime * 17.0) * 811.0) - 0.5;
  col += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  o = vec4(col, 1.0);
}`;

export function createPost(gl) {
  const down = createProgram(gl, FULLSCREEN_VS, DOWN_FS, 'bloom-down');
  const up = createProgram(gl, FULLSCREEN_VS, UP_FS, 'bloom-up');
  const grade = createProgram(gl, FULLSCREEN_VS, GRADE_FS, 'grade');
  const rays = createProgram(gl, FULLSCREEN_VS, RAYS_FS, 'rays');
  const copy = createProgram(gl, FULLSCREEN_VS, COPY_FS, 'copy');
  const vao = gl.createVertexArray();
  const hdr = gl.ext.floatRT || gl.ext.halfRT;
  let scene = null, accum = null, raysT = null, chain = [];
  let W = 0, H = 0;

  const make = (w, h) => {
    let t = createTarget(gl, w, h, hdr);
    if (!t.ok) t = createTarget(gl, w, h, false);
    return t;
  };

  function resize(w, h) {
    if (w === W && h === H && scene) return;
    W = w; H = h;
    [scene, accum, raysT, ...chain].forEach((t) => deleteTarget(gl, t));
    accum = null;
    scene = make(w, h);
    raysT = make(Math.max(1, w >> 2), Math.max(1, h >> 2));
    chain = [];
    let cw = w, ch = h;
    for (let i = 0; i < 5; i++) {
      cw = Math.max(1, cw >> 1);
      ch = Math.max(1, ch >> 1);
      chain.push(make(cw, ch));
    }
  }

  function pass(prog, target, uniforms) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.width : gl.drawingBufferWidth, target ? target.height : gl.drawingBufferHeight);
    prog.use();
    prog.setAll(uniforms);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function finish(frame, src) {
    const P = frame.post;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    let s = src;
    chain.forEach((t, i) => {
      pass(down, t, { uTex: s.tex, uTexel: [1 / s.width, 1 / s.height], uThreshold: P.bloomThreshold, uPrefilter: i === 0 ? 1 : 0 });
      s = t;
    });
    const R = P.rays || 0;
    if (R > 0.001 && P.sunUv) pass(rays, raysT, { uTex: chain[1].tex, uSun: P.sunUv, uDecay: P.raysDecay || 0.955, uDensity: 0.92 });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = chain.length - 1; i > 0; i--) {
      const a = chain[i], b = chain[i - 1];
      pass(up, b, { uTex: a.tex, uTexel: [0.5 / a.width, 0.5 / a.height] });
    }
    gl.disable(gl.BLEND);
    pass(grade, null, {
      uScene: src.tex, uBloom: chain[0].tex, uRays: raysT.tex, uRaysAmt: (R > 0.001 && P.sunUv) ? R : 0,
      uRes: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      uBloomAmt: P.bloom, uExposure: P.exposure, uCA: P.ca, uVignette: P.vignette, uGrain: P.grain,
      uTime: frame.time, uFlash: P.flash, uFade: P.fade, uBlurAmt: P.blur, uBlurDir: P.blurDir,
      uZoomBlur: P.zoomBlur, uFlashCol: P.flashCol, uShadowTint: P.shadowTint, uHighTint: P.highTint,
      uLift: P.lift, uSaturation: P.saturation,
    });
  }

  return {
    resize,
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    end(frame) { finish(frame, scene); },
    // long exposures for stills: sum (or max) many rendered sub-frames, then grade once
    accumReset() {
      if (!accum) accum = make(W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    accumAdd(weight, mode = 'add') {
      gl.enable(gl.BLEND);
      gl.blendEquation(mode === 'max' ? gl.MAX : gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      pass(copy, accum, { uTex: scene.tex, uWeight: weight });
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    },
    endAccum(frame) { finish(frame, accum); },
  };
}
