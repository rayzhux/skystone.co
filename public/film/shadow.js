// Directional sun shadows: one depth map, hardware PCF, fitted to whatever the shot is about.
import { m4, v3 } from './math.js';

export const GLSL_SHADOW = `
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn, uShadowTexel, uShadowBias;
float shadowAt(vec3 wp, vec3 n){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sp = uShadowMat * vec4(wp + n * 0.04, 1.0);
  vec3 s = sp.xyz / sp.w * 0.5 + 0.5;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += texture(uShadowMap, vec3(s.xy + vec2(float(i), float(j)) * uShadowTexel * 1.25, s.z - uShadowBias));
  return sum / 9.0;
}
`;

export function createShadow(gl, size = 2048) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const view = m4.create(), proj = m4.create(), viewProj = m4.create();
  let active = false;

  return {
    ok,
    get viewProj() { return viewProj; },
    /** Fit an orthographic sun camera around frame.shadow = { center, radius }; returns false when off. */
    begin(frame) {
      const S = frame.shadow;
      active = !!(ok && S && S.on);
      if (!active) return false;
      const d = frame.sky.sunDir;
      const c = S.center;
      const dist = S.radius * 3;
      const eye = v3.add(c, v3.scale(d, dist));
      const up = Math.abs(d[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
      m4.lookAt(view, eye, c, up);
      m4.ortho(proj, -S.radius, S.radius, -S.radius, S.radius, 0.5, dist * 2.2);
      m4.multiply(viewProj, proj, view);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, size, size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.6, 3.0);
      return true;
    },
    end() {
      gl.disable(gl.POLYGON_OFFSET_FILL);
    },
    bind(prog, frame) {
      const on = active && frame.shadow && frame.shadow.on;
      prog.set('uShadowOn', on ? 1 : 0);
      prog.set('uShadowMat', viewProj);
      prog.set('uShadowTexel', 1 / size);
      prog.set('uShadowBias', frame.shadow?.bias ?? 0.0012);
      prog.set('uShadowMap', tex);
    },
  };
}
