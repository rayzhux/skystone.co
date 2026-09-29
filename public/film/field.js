// The light field. Every particle's position, size and colour is a pure function of film time, evaluated on the
// GPU once per frame (and once more a shutter-interval earlier), then drawn as a motion-blurred, depth-of-field
// streak of light. Nothing accumulates between frames, so the film can pause, scrub and export frame-exact.
import { createProgram, createTexture, FULLSCREEN_VS } from './gl.js';

export const FORM = { POINT: 0, HORIZON: 1, SPIRAL: 2, FLOW: 3, RINGS: 4, LATTICE: 5, FIELD: 6 };
export const EASE = { inOutCubic: 0, outExpo: 1, inOutExpo: 2, outCubic: 3, outBack: 4, inExpo: 5 };
export const STAGGER = { random: 0, fromA: 1, toB: 2, heightB: 3, fromAInv: 4, alongB: 5 };

const SIM_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uSide;
uniform float uN, uMainN, uTime;
uniform int uFormA, uFormB;
uniform float uTA, uTB;
uniform mat4 uMatA, uMatB;
uniform vec4 uParA[4];
uniform vec4 uParB[4];
uniform float uProgress, uStagger, uStaggerRange, uNoise, uSwirl, uLift;
uniform int uStaggerMode, uEase;
uniform vec3 uStaggerOrigin, uSwirlCenter;
uniform mat3 uRing[7];
uniform vec4 uScan;
uniform vec4 uDust;
uniform vec3 uPaper, uAccent;
uniform float uIntensity, uSize;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oCol;

const float PI = 3.14159265;
const float TAU = 6.28318531;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint id, uint salt) { return float(pcg(id ^ (salt * 0x9E3779B9u)) >> 8) / 16777216.0; }
vec2 gauss2(float a, float b) { return sqrt(-2.0 * log(max(a, 1e-7))) * vec2(cos(TAU * b), sin(TAU * b)); }

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec3 g3(vec3 c) { return hash33(c) * 2.0 - 1.0; }
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(g3(i), f);
  float n100 = dot(g3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(g3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(g3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(g3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(g3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(g3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(g3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm(vec3 p) { return gnoise(p) + 0.5 * gnoise(p * 2.03 + 7.1) + 0.25 * gnoise(p * 4.07 + 13.3); }

struct Pt { vec3 p; float size; float bright; float warm; };

// a single point of light (the ignition, the collapse)
// (only a few particles are lit while they are gathered here; the rest are born as they leave it)
Pt fPoint(vec4 h, vec4 par[4]) {
  vec2 a = gauss2(h.x, h.y), b = gauss2(h.z, h.w);
  Pt s;
  s.p = vec3(a, b.x) * par[0].x;
  s.size = 1.0; s.bright = step(fract(h.w * 31.7), par[0].y) * par[0].z; s.warm = 0.6;
  return s;
}

// the horizon: a band of light brightest at its centre, with the sun sitting on it
Pt fHorizon(vec4 h, vec4 par[4]) {
  Pt s;
  float L = par[0].x, th = par[0].y;
  if (h.w < par[0].z) {
    vec2 a = gauss2(h.x, h.y), b = gauss2(h.z, fract(h.w * 91.7));
    s.p = vec3(a, b.x) * par[0].w;
    s.size = 1.1; s.bright = 1.6; s.warm = 0.7;
  } else {
    float u = h.x * 2.0 - 1.0;
    float x = sign(u) * pow(abs(u), 1.7) * L;
    float fall = exp(-abs(x) / L * 2.6);
    vec2 g = gauss2(h.y, h.z);
    s.p = vec3(x, g.x * th * (0.3 + 0.7 * fall), g.y * th * 3.0);
    s.size = 0.8 + 0.5 * fall; s.bright = (0.18 + 1.3 * fall) * par[1].x; s.warm = 0.35 + 0.45 * fall;
  }
  return s;
}

// investment: a spiral galaxy that turns faster at its heart, like compounding. Three populations: logarithmic
// arms, a golden-angle seed pattern across the core, and a faint halo.
Pt fSpiral(float fid, float k, vec4 h, float t, vec4 par[4]) {
  float R = par[0].x, arms = par[0].w, tight = par[1].x;
  float r, th, bright, warm, size;
  if (k < 0.7) {
    // arms: two dominant, six faint, each a bright spine in a soft envelope, with knots of light along them
    bool major = h.y < 0.6;
    float a = major ? floor(h.y / 0.6 * 2.0) * PI : floor((h.y - 0.6) / 0.4 * 6.0) * TAU / 6.0 + 0.45;
    float u = pow(h.z, 0.85);
    bool knot = major && fract(h.x * 17.3) < 0.14;
    if (knot) { float c = floor(u * 30.0); u = clamp((c + 0.5 + (fract(sin(c * 12.9898 + a) * 43758.5) - 0.5) * 0.7) / 30.0 + (fract(h.w * 7.1) - 0.5) * 0.005, 0.0, 1.0); }
    r = R * (0.035 + 0.965 * u);
    float rn0 = r / R;
    bool spine = fract(h.y * 77.7) < (major ? 0.55 : 0.4);
    vec2 g = gauss2(h.w, fract(h.y * 13.7));
    float sig = (spine ? (0.01 + 0.03 * rn0) : (0.06 + 0.18 * rn0)) * (major ? 1.0 : 0.7) * (knot ? 0.35 : 1.0);
    th = a + log(rn0) * tight + g.x * sig;
    r *= 1.0 + g.y * (spine ? 0.008 : 0.035);
    bright = (spine ? 0.75 : 0.2) * (major ? 1.0 : 0.38) * (1.0 - 0.45 * rn0) * (0.65 + 0.35 * h.x) + (knot ? 0.9 : 0.0);
    warm = (spine ? 0.5 : 0.28) + 0.2 * (1.0 - rn0) + (knot ? 0.25 : 0.0);
    size = knot ? 1.1 : spine ? 0.95 : 0.85;
  } else if (k < 0.74) {
    // the seeds: a golden-angle pattern across the core
    float i = fid - 0.7 * uMainN;
    float cnt = 0.04 * uMainN;
    r = R * 0.55 * sqrt((i + 0.5) / cnt);
    th = i * 2.39996323;
    bright = 0.75 * (1.0 - 0.6 * r / R) * (1.0 - smoothstep(0.3, 0.55, r / R));
    warm = 0.35;
    size = 1.1;
  } else {
    vec2 g = gauss2(h.y, h.z);
    r = R * (0.15 + abs(g.x) * 0.5);
    th = h.w * TAU;
    bright = 0.045;
    warm = 0.15;
    size = 0.8;
  }
  float rn = r / R;
  th += par[0].z * t / (0.16 + rn);
  float core = exp(-rn * 14.0);
  Pt s;
  s.p = vec3(cos(th) * r, par[0].y * pow(rn, 1.6) + (h.x - 0.5) * par[1].y * (0.1 + 0.5 * rn), sin(th) * r);
  s.size = size + 0.4 * core;
  s.bright = bright + 1.6 * core;
  s.warm = warm + 0.3 * core;
  return s;
}

// consulting: turbulence, combed into parallel strands as the front passes
Pt fFlow(vec4 h, float t, vec4 par[4]) {
  float L = par[0].x, W = par[0].y, lanes = par[0].w;
  float lane = floor(h.x * lanes), ln = (lane + 0.5) / lanes;
  float u = fract(h.y + par[0].z * t / (2.0 * L));
  float x = (u * 2.0 - 1.0) * L;
  float ang = par[2].x * x / L + (ln - 0.5) * 2.4;
  vec3 ordered = vec3(x, (ln - 0.5) * W * 0.9 + sin(ang) * W * 0.3, cos(ang) * W * 0.45);
  ordered.yz += gauss2(h.z, h.w) * 0.01 * W;
  // chaos is the same thread, tangled: the noise runs along each strand, so it stays a line
  vec3 q = vec3(x * par[1].w, lane * 0.73, t * 0.55);
  vec3 chaos = ordered + vec3(fbm(q) * 0.5, fbm(q + 17.3), fbm(q + 41.9)) * par[1].z;
  float o = 1.0 - smoothstep(par[1].x - par[1].y, par[1].x + par[1].y, x);
  float ends = smoothstep(1.0, 0.72, abs(x) / L);
  float laneB = 0.55 + 0.45 * fract(lane * 0.618);
  float gold = step(0.83, fract(lane * 0.371 + 0.13));
  Pt s;
  s.p = mix(chaos, ordered, o);
  s.size = 0.9 + 0.15 * gold;
  s.bright = mix(0.42, 0.7, o) * laneB * (1.0 + 0.7 * gold) * ends;
  s.warm = mix(0.2, 0.5, o) + 0.45 * gold;
  return s;
}

// programme management: seven orbits, each with its own tilt and pace, that fall into step
Pt fRings(vec4 h, float t, vec4 par[4]) {
  float R = par[0].x, align = par[0].w;
  float fj = floor(h.x * 7.0);
  int j = int(fj);
  float Rj = R * mix(1.0 - 0.015 * fj, 0.4 + 0.1 * fj, align);
  float dir = mod(fj, 2.0) < 0.5 ? 1.0 : -1.0;
  float w = par[0].z * (0.6 + 0.13 * fj) * dir;
  float phi = h.y * TAU + w * t;
  vec2 g = gauss2(h.z, h.w);
  float rr = Rj + g.x * 0.0045 * R;
  vec3 local = vec3(cos(phi) * rr, g.y * 0.003 * R, sin(phi) * rr);
  float hp = mix(w * t * 2.2 + fj * 1.3, t * 1.1, align);
  float head = pow(max(cos(3.0 * (phi - hp)), 0.0), 60.0);
  Pt s;
  s.p = uRing[j] * local;
  s.size = 0.85 + 0.7 * head;
  s.bright = 0.3 + 2.8 * head;
  s.warm = 0.28 + 0.55 * head;
  return s;
}

// implementation: a lattice with bright joints, cropped to a sphere
Pt fLattice(vec4 h, vec4 par[4]) {
  float S = par[0].x, n = par[0].y;
  float axis = floor(h.x * 3.0);
  float a = floor(h.y * n), b = floor(h.z * n);
  float u = h.w * (n - 1.0);
  float node = step(0.88, fract(h.x * 7.31 + h.y * 3.17));
  u = mix(u, floor(u + 0.5), node);
  vec3 g = axis < 0.5 ? vec3(u, a, b) : axis < 1.5 ? vec3(a, u, b) : vec3(a, b, u);
  vec3 p = (g - (n - 1.0) * 0.5) * (2.0 * S / (n - 1.0));
  float keep = 1.0 - smoothstep(0.9, 1.0, length(p) / (S * par[0].z));
  Pt s;
  s.p = p;
  s.size = (0.85 + 0.5 * node) * keep;
  s.bright = (0.24 + 1.4 * node) * keep;
  s.warm = 0.28 + 0.3 * node;
  return s;
}

// insights: a field of noise that settles until one clean signal runs through it
Pt fField(float fid, vec4 h, float t, vec4 par[4]) {
  float G = float(uSide);
  float rows = floor(uMainN / G);
  float gx = mod(fid, G), gz = floor(fid / G);
  float x = ((gx + 0.5 + (h.x - 0.5) * 0.3) / G - 0.5) * par[0].x;
  float z = ((gz + 0.5 + (h.y - 0.5) * 0.3) / rows - 0.5) * par[0].y;
  float nz = fbm(vec3(x * par[0].w, z * par[0].w, t * 0.3));
  float zc = sin(x * 0.28 + par[1].z) * 2.4 + sin(x * 0.63 + 1.7) * 0.6;
  float ridge = exp(-pow((z - zc) / par[1].y, 2.0));
  float edge = smoothstep(1.0, 0.72, max(abs(x) / (0.5 * par[0].x), abs(z) / (0.5 * par[0].y)));
  Pt s;
  s.p = vec3(x, nz * par[0].z + ridge * par[1].x * 1.2, z);
  s.size = 0.75 + 0.6 * ridge * par[1].x;
  s.bright = (0.2 + 0.6 * max(nz, 0.0) * par[0].z + 3.2 * ridge * par[1].x) * edge;
  s.warm = 0.2 + 0.7 * ridge * par[1].x;
  return s;
}

// ambient dust: depth, parallax and the odd out-of-focus sparkle
Pt fDust(vec4 h, float t) {
  vec3 p = (h.xyz - 0.5) * vec3(2.0, 0.9, 2.0) * uDust.y;
  vec3 q = p * 0.06 + vec3(0.0, t * 0.05, 0.0);
  p += vec3(gnoise(q), gnoise(q + 9.1), gnoise(q + 21.7)) * uDust.z;
  Pt s;
  s.p = p;
  s.size = uDust.w * (0.5 + h.w);
  s.bright = uDust.x * (0.12 + 0.88 * h.w * h.w * h.w);
  s.warm = 0.15 + 0.4 * h.w;
  return s;
}

Pt form(int f, float fid, float k, vec4 h, float t, vec4 par[4]) {
  if (f == 1) return fHorizon(h, par);
  if (f == 2) return fSpiral(fid, k, h, t, par);
  if (f == 3) return fFlow(h, t, par);
  if (f == 4) return fRings(h, t, par);
  if (f == 5) return fLattice(h, par);
  if (f == 6) return fField(fid, h, t, par);
  return fPoint(h, par);
}

float easeF(float x) {
  if (uEase == 1) return x >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * x);
  if (uEase == 2) return x <= 0.0 ? 0.0 : x >= 1.0 ? 1.0 : x < 0.5 ? pow(2.0, 20.0 * x - 10.0) / 2.0 : (2.0 - pow(2.0, -20.0 * x + 10.0)) / 2.0;
  if (uEase == 3) { float y = 1.0 - x; return 1.0 - y * y * y; }
  if (uEase == 4) { float y = x - 1.0; return 1.0 + 2.70158 * y * y * y + 1.70158 * y * y; }
  if (uEase == 5) return x <= 0.0 ? 0.0 : pow(2.0, 10.0 * x - 10.0);
  if (x < 0.5) return 4.0 * x * x * x;
  float y = -2.0 * x + 2.0;
  return 1.0 - y * y * y / 2.0;
}

void main() {
  ivec2 st = ivec2(gl_FragCoord.xy);
  float fid = float(st.y * uSide + st.x);
  if (fid >= uN) { oPos = vec4(0.0); oCol = vec4(0.0); return; }
  uint id = uint(st.y * uSide + st.x);
  vec4 h = vec4(rnd(id, 1u), rnd(id, 2u), rnd(id, 3u), rnd(id, 4u));
  Pt P;
  if (fid >= uMainN) {
    P = fDust(h, uTime);
  } else {
    float k = (fid + 0.5) / uMainN;
    Pt A = form(uFormA, fid, k, h, uTA, uParA);
    A.p = (uMatA * vec4(A.p, 1.0)).xyz;
    P = A;
    if (uProgress > 0.0) {
      Pt B = form(uFormB, fid, k, h, uTB, uParB);
      B.p = (uMatB * vec4(B.p, 1.0)).xyz;
      float sd = rnd(id, 5u);
      float s;
      if (uStaggerMode == 1) s = length(A.p - uStaggerOrigin) / uStaggerRange;
      else if (uStaggerMode == 2) s = length(B.p - uStaggerOrigin) / uStaggerRange;
      else if (uStaggerMode == 3) s = (B.p.y - uStaggerOrigin.y) / uStaggerRange;
      else if (uStaggerMode == 4) s = 1.0 - length(A.p - uStaggerOrigin) / uStaggerRange;
      else if (uStaggerMode == 5) s = (B.p.x - uStaggerOrigin.x) / uStaggerRange;
      else s = sd;
      s = clamp(clamp(s, 0.0, 1.0) * 0.85 + sd * 0.15, 0.0, 1.0);
      float pr = clamp((uProgress - s * uStagger) / max(1.0 - uStagger, 1e-4), 0.0, 1.0);
      float e = easeF(pr);
      float ec = clamp(e, 0.0, 1.0);
      float arc = sin(PI * pr);
      P.p = mix(A.p, B.p, e);
      P.size = mix(A.size, B.size, ec);
      // light leaving the point stays dim until it has spread out; light returning to it fades before it arrives,
      // so the point never becomes a flare
      float eb = uFormA == 0 ? ec * ec * ec : uFormB == 0 ? 1.0 - (1.0 - smoothstep(0.55, 0.95, ec)) * (1.0 - ec * B.bright) : ec;
      P.bright = uFormB == 0 ? A.bright * (1.0 - smoothstep(0.55, 0.95, ec)) + B.bright * ec : mix(A.bright, B.bright, eb);
      P.warm = mix(A.warm, B.warm, ec);
      if (arc > 0.0) {
        if (uNoise > 0.0) {
          vec3 q = P.p * 0.09 + vec3(h.x * 5.0, uTime * 0.4, h.y * 5.0);
          P.p += vec3(gnoise(q), gnoise(q + 11.3), gnoise(q + 23.9)) * 2.0 * uNoise * arc;
        }
        P.p.y += uLift * arc * (0.5 + h.z);
        if (uSwirl != 0.0) {
          vec3 d = P.p - uSwirlCenter;
          float ang = uSwirl * arc * (0.6 + 0.8 * h.w);
          float c = cos(ang), sn = sin(ang);
          P.p = uSwirlCenter + vec3(c * d.x - sn * d.z, d.y, sn * d.x + c * d.z);
        }
        P.bright *= 1.0 + 0.5 * arc;
      }
    }
    float spark = step(0.986, rnd(id, 6u));
    P.bright *= 1.0 + spark * (2.5 + 1.5 * sin(uTime * (5.0 + 6.0 * h.z) + h.w * 40.0));
    // a scan plane in world space: whatever it passes through lights up
    if (uScan.z > 0.0) {
      float sc = uScan.z * exp(-pow((P.p.y - uScan.x) / uScan.y, 2.0));
      P.bright += sc * 2.4 * step(0.02, P.size);
      P.warm = mix(P.warm, 0.92, clamp(sc, 0.0, 1.0));
      P.size *= 1.0 + 0.4 * sc;
    }
  }
  vec3 col = mix(uPaper, uAccent, clamp(P.warm, 0.0, 1.0)) * max(P.bright, 0.0) * uIntensity;
  oPos = vec4(P.p, max(P.size, 0.0) * uSize);
  oCol = vec4(col, 1.0);
}`;

const DRAW_VS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos, uPrev, uCol;
uniform int uSide;
uniform mat4 uVP, uPrevVP;
uniform vec2 uRes;
uniform float uProjScale, uMinPx, uMaxPx, uMaxLen, uFocus, uAperture, uEnergy;
out vec2 vL;
out float vHalf;
out float vR;
out vec3 vC;
void main() {
  int id = gl_InstanceID;
  ivec2 st = ivec2(id % uSide, id / uSide);
  vec4 P = texelFetch(uPos, st, 0);
  vec4 C = texelFetch(uCol, st, 0);
  vec4 Q = texelFetch(uPrev, st, 0);
  vec4 c1 = uVP * vec4(P.xyz, 1.0);
  vec4 c0 = uPrevVP * vec4(Q.xyz, 1.0);
  if (c1.w < 0.05 || P.w <= 0.0 || C.r + C.g + C.b <= 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (c0.w < 0.05) c0 = c1;
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes;
  vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  float depth = c1.w;
  float rIn = P.w * uProjScale / depth;
  float coc = uAperture * abs(1.0 - uFocus / depth);
  float r = clamp(sqrt(rIn * rIn + coc * coc), uMinPx, uMaxPx);
  vec2 d = s1 - s0;
  float L = length(d);
  if (L > uMaxLen) { s0 = s1 - d / L * uMaxLen; d = s1 - s0; L = uMaxLen; }
  vec2 dir = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 corner = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float(gl_VertexID >> 1) * 2.0 - 1.0);
  float ext = r * 1.6;
  float halfLen = L * 0.5 + ext;
  vec2 pix = (s0 + s1) * 0.5 + dir * corner.x * halfLen + nrm * corner.y * ext;
  gl_Position = vec4(pix / uRes * 2.0 - 1.0, 0.0, 1.0);
  vL = vec2(corner.x * halfLen, corner.y * ext);
  vHalf = L * 0.5;
  vR = r;
  // a particle's light is fixed: spread over its disc when defocused and along its streak when moving
  float E = uEnergy / (1.5708 * r * r);
  E /= 1.0 + L / (1.6 * r);
  vC = C.rgb * E;
}`;

const DRAW_FS = `#version 300 es
precision highp float;
in vec2 vL;
in float vHalf;
in float vR;
in vec3 vC;
out vec4 o;
void main() {
  float dx = max(abs(vL.x) - vHalf, 0.0);
  float d2 = (dx * dx + vL.y * vL.y) / (vR * vR);
  float g = exp(-2.0 * d2);
  if (g < 0.004) discard;
  o = vec4(vC * g, 0.0);
}`;

const N_REF = 262144;

export function createField(gl, { side, dustFrac = 0.1 }) {
  const N = side * side;
  const mainN = Math.floor((N * (1 - dustFrac)) / side) * side;
  const f32 = gl.ext.floatRT;
  const tex = () => createTexture(gl, {
    width: side, height: side, internalFormat: f32 ? gl.RGBA32F : gl.RGBA16F, format: gl.RGBA,
    type: f32 ? gl.FLOAT : gl.HALF_FLOAT, filter: gl.NEAREST,
  });
  const posNow = tex(), colNow = tex(), posPrev = tex();
  const fbo = (list) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    list.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(list.length === 2 ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0, gl.NONE]);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('field-target-incomplete');
    return fb;
  };
  const fbNow = fbo([posNow, colNow]);
  const fbPrev = fbo([posPrev]);
  const sim = createProgram(gl, FULLSCREEN_VS, SIM_FS, 'field-sim');
  const draw = createProgram(gl, DRAW_VS, DRAW_FS, 'field-draw');
  const vao = gl.createVertexArray();
  // fewer particles on small devices: each one carries more light and a little more size
  const energyK = N_REF / N;
  const sizeK = Math.pow(N_REF / N, 0.25);

  function run(fb, F, time) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, side, side);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    sim.use().setAll({
      uSide: side, uN: N, uMainN: mainN, uTime: time,
      uFormA: F.formA, uFormB: F.formB, uTA: time, uTB: time, uMatA: F.matA, uMatB: F.matB,
      uParA: F.parA, uParB: F.parB,
      uProgress: F.progress, uStagger: F.stagger, uStaggerRange: F.staggerRange, uNoise: F.noise, uSwirl: F.swirl, uLift: F.lift,
      uStaggerMode: F.staggerMode, uEase: F.ease, uStaggerOrigin: F.staggerOrigin, uSwirlCenter: F.swirlCenter,
      uRing: F.rings, uScan: F.scan, uDust: F.dust, uPaper: F.paper, uAccent: F.accent,
      uIntensity: F.intensity, uSize: F.size * sizeK,
    });
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    N,
    mainN,
    simulate(frame, prev) {
      run(fbNow, frame.field, frame.time);
      run(fbPrev, prev.field, prev.time);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    draw(frame, cam, camPrev) {
      const F = frame.field;
      draw.use().setAll({
        uPos: posNow, uPrev: posPrev, uCol: colNow, uSide: side,
        uVP: cam.viewProj, uPrevVP: camPrev.viewProj, uRes: cam.res,
        uProjScale: cam.pointScale, uMinPx: 0.75 * Math.max(1, cam.pxScale), uMaxPx: 18 * cam.pxScale, uMaxLen: F.maxStreak * cam.pxScale,
        uFocus: F.focus, uAperture: F.aperture * cam.pxScale, uEnergy: F.energy * energyK * cam.pxScale * cam.pxScale,
      });
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.floor(N * (F.fraction ?? 1)));
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    },
  };
}
