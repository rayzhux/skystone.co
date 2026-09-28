// GPU particle field. Every particle reads two target shapes from a float texture and travels between
// them along a noisy, swirling path. No per-frame CPU work beyond uniforms.
import { createProgram, createTexture, GLSL_NOISE } from './gl.js';
import { S, SHAPE_COUNT } from './shapes.js';

const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPos;
uniform sampler2D uAttr;
uniform int uSide;
uniform int uFrom, uTo;
uniform mat4 uFromM, uToM;
uniform float uFromS, uToS;
uniform mat4 uView, uProj;
uniform float uProgress, uStagger;
uniform int uStaggerMode, uEase;
uniform vec3 uStaggerOrigin;
uniform float uStaggerRange;
uniform float uNoiseAmp, uLift, uSwirl;
uniform vec3 uSwirlCenter;
uniform float uTime, uSpinTime, uSize, uPointScale, uDrift, uVortexSpin, uFlowSpeed;
uniform vec4 uGroupFade;
uniform float uFogDensity;
uniform float uMinPx;
uniform float uTransitGrow;
out vec3 vColor;
out float vHi;
out float vFog;
out float vA;
${GLSL_NOISE}

vec4 fetchP(int shape, int id){ return texelFetch(uPos, ivec2(id % uSide, id / uSide + shape * uSide), 0); }
vec4 fetchA(int shape, int id){ return texelFetch(uAttr, ivec2(id % uSide, id / uSide + shape * uSide), 0); }

vec4 shapePos(int shape, int id, float seed){
  if (shape == ${S.FLOW_A}) {
    vec4 a = fetchP(${S.FLOW_A}, id);
    vec4 b = fetchP(${S.FLOW_B}, id);
    float f = fract(seed * 7.13 + uTime * a.w * uFlowSpeed);
    vec3 p = mix(a.xyz, b.xyz, f);
    p.y += sin(f * 3.14159) * 1.2;
    return vec4(p, b.w * smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.9, f));
  }
  vec4 p = fetchP(shape, id);
  if (shape == ${S.VORTEX}) {
    float r = p.x;
    float th = p.z + uSpinTime * uVortexSpin * (9.0 / (r + 3.0));
    return vec4(cos(th) * r, p.y, sin(th) * r, p.w);
  }
  return p;
}

float easeF(float t){
  if (uEase == 1) return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
  if (uEase == 2) return t <= 0.0 ? 0.0 : t >= 1.0 ? 1.0 : t < 0.5 ? pow(2.0, 20.0 * t - 10.0) / 2.0 : (2.0 - pow(2.0, -20.0 * t + 10.0)) / 2.0;
  if (uEase == 3) return 1.0 - pow(1.0 - t, 3.0);
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main(){
  int id = gl_VertexID;
  float seed = hash11(float(id) * 0.6180339 + 0.37);
  vec4 A = shapePos(uFrom, id, seed);
  vec4 B = shapePos(uTo, id, seed);
  vec4 attrA = fetchA(uFrom, id);
  vec4 attrB = fetchA(uTo, id);
  vec3 pa = (uFromM * vec4(A.xyz, 1.0)).xyz;
  vec3 pb = (uToM * vec4(B.xyz, 1.0)).xyz;

  float s;
  if (uStaggerMode == 1) s = clamp(length(pa - uStaggerOrigin) / uStaggerRange, 0.0, 1.0);
  else if (uStaggerMode == 2) s = clamp(length(pb - uStaggerOrigin) / uStaggerRange, 0.0, 1.0);
  else if (uStaggerMode == 3) s = clamp((pa.y - uStaggerOrigin.y) / uStaggerRange, 0.0, 1.0);
  else if (uStaggerMode == 4) s = 1.0 - clamp(length(pa - uStaggerOrigin) / uStaggerRange, 0.0, 1.0);
  else if (uStaggerMode == 5) s = 1.0 - clamp(length(pb - uStaggerOrigin) / uStaggerRange, 0.0, 1.0);
  else s = seed;
  s = clamp(s * 0.85 + seed * 0.15, 0.0, 1.0);
  float p = clamp((uProgress - s * uStagger) / max(1.0 - uStagger, 1e-4), 0.0, 1.0);
  float e = easeF(p);
  float arc = sin(3.14159265 * e);

  vec3 pos = mix(pa, pb, e);
  if (uNoiseAmp > 0.0 && arc > 0.0) {
    vec3 q = pos * 0.035 + vec3(seed * 13.0, uTime * 0.25, seed * 7.0);
    vec3 n = vec3(vnoise(q), vnoise(q + 19.1), vnoise(q + 41.7)) - 0.5;
    pos += n * 2.0 * uNoiseAmp * arc;
  }
  pos.y += uLift * arc * (0.55 + seed);
  if (uSwirl != 0.0 && arc > 0.0) {
    vec3 d = pos - uSwirlCenter;
    float ang = uSwirl * arc * (0.6 + 0.8 * seed);
    float c = cos(ang), sn = sin(ang);
    pos = uSwirlCenter + vec3(c * d.x - sn * d.z, d.y, sn * d.x + c * d.z);
  }
  if (uDrift > 0.0) {
    vec3 q = pos * 0.08 + vec3(uTime * 0.18, seed * 3.0, uTime * 0.11);
    pos += (vec3(vnoise(q), vnoise(q + 5.2) * 0.4, vnoise(q + 9.7)) - vec3(0.5, 0.2, 0.5)) * uDrift;
  }

  float group = mix(attrA.b, attrB.b, step(0.5, e)) * 255.0;
  float gf = group < 0.5 ? uGroupFade.x : group < 1.5 ? uGroupFade.y : group < 2.5 ? uGroupFade.z : uGroupFade.w;
  float size = mix(A.w * uFromS, B.w * uToS, e) * uSize * gf * (1.0 + uTransitGrow * arc);

  vec4 vp = uView * vec4(pos, 1.0);
  gl_Position = uProj * vp;
  float dist = max(-vp.z, 0.05);
  float px = size * uPointScale / dist;
  vA = clamp(px / uMinPx, 0.0, 1.0);
  gl_PointSize = clamp(px, uMinPx, 56.0);
  if (size <= 0.0) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

  float hi = mix(attrA.r, attrB.r, e);
  float br = mix(attrA.g, attrB.g, e);
  // glints twinkle
  vHi = hi * (0.55 + 0.45 * sin(uTime * (2.5 + seed * 6.0) + seed * 60.0));
  vColor = vec3(br);
  vFog = 1.0 - exp(-dist * uFogDensity);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vHi;
in float vFog;
in float vA;
uniform vec3 uLightDirV, uSunCol, uAmbCol, uRimCol, uFogCol, uBase, uHiCol;
uniform float uEmissive, uLight, uHiEmissive, uTransmit, uIntensity;
out vec4 o;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 n = vec3(p, sqrt(1.0 - r2));
  float diff = max(dot(n, uLightDirV), 0.0);
  float wrap = max(dot(n, uLightDirV) * 0.5 + 0.5, 0.0);
  float rim = pow(1.0 - n.z, 2.5);
  vec3 base = mix(uBase, uHiCol, vHi) * (0.55 + 0.45 * vColor.r);
  vec3 c = base * (uAmbCol * (0.6 + 0.4 * wrap) + uSunCol * diff) * uLight;
  c += uRimCol * rim * uLight * (0.5 + 0.5 * vColor.r);
  // forward scattering: dust glows when the light sits behind it
  float trans = pow(max(-uLightDirV.z, 0.0), 3.0);
  c += base * uSunCol * trans * uTransmit * uLight * (0.4 + 0.6 * vColor.r);
  c += base * uEmissive + uHiCol * vHi * uHiEmissive;
  c = mix(c, uFogCol * 0.6, vFog);
  float a = vA * (1.0 - smoothstep(0.55, 1.0, r2));
  o = vec4(c * a * uIntensity, 0.0);
}`;

export function createParticles(gl, shapes) {
  const { pos, attr, side } = shapes;
  const H = side * SHAPE_COUNT;
  const posTex = createTexture(gl, {
    width: side, height: H, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: pos, filter: gl.NEAREST,
  });
  const attrTex = createTexture(gl, {
    width: side, height: H, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: attr, filter: gl.NEAREST,
  });
  const prog = createProgram(gl, VS, FS, 'particles');
  const vao = gl.createVertexArray();
  const N = side * side;
  return {
    N,
    draw(frame, cam, msaa) {
      const P = frame.particles;
      if (!P.visible) return;
      prog.use();
      prog.setAll({
        uPos: posTex, uAttr: attrTex, uSide: side,
        uFrom: P.from, uTo: P.to, uFromM: P.fromM, uToM: P.toM, uFromS: P.fromS, uToS: P.toS,
        uView: cam.view, uProj: cam.proj,
        uProgress: P.progress, uStagger: P.stagger, uStaggerMode: P.staggerMode, uEase: P.ease,
        uStaggerOrigin: P.staggerOrigin, uStaggerRange: P.staggerRange,
        uNoiseAmp: P.noise, uLift: P.lift, uSwirl: P.swirl, uSwirlCenter: P.swirlCenter,
        uTime: frame.time, uSpinTime: P.spinTime ?? frame.time, uSize: P.size, uPointScale: cam.pointScale, uDrift: P.drift,
        uVortexSpin: P.vortexSpin, uFlowSpeed: P.flowSpeed, uGroupFade: P.groupFade,
        uFogDensity: P.fog, uMinPx: P.minPx,
        uLightDirV: cam.sunDirView, uSunCol: P.sunCol, uAmbCol: P.ambCol, uRimCol: P.rimCol,
        uFogCol: P.fogCol, uBase: P.base, uHiCol: P.hiCol,
        uEmissive: P.emissive, uLight: P.light, uHiEmissive: P.hiEmissive, uTransmit: P.transmit ?? 0.9,
        uIntensity: P.intensity ?? 1, uTransitGrow: P.transitGrow ?? 0,
      });
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, Math.floor(N * (P.fraction ?? 1)));
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    },
  };
}
