// Words set in the world: text is rasterised once into a mipmapped texture and placed on a quad, so
// towers can pass in front of it and the ground can carry it.
import { createProgram, createBuffer, createVAO, createTexture } from './gl.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;   // -0.5..0.5
uniform mat4 uViewProj, uModel;
uniform vec3 uCamPos;
out vec2 vUv;
out float vDist;
void main(){
  vUv = vec2(aPos.x + 0.5, 0.5 - aPos.y);
  vec4 w = uModel * vec4(aPos, 0.0, 1.0);
  vDist = length(w.xyz - uCamPos);
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vDist;
uniform sampler2D uTex;
uniform vec3 uColor, uFogCol;
uniform float uAlpha, uFogDensity, uReveal, uGlow;
out vec4 o;
void main(){
  float a = texture(uTex, vUv).a;
  // wipe reveal, bottom to top in texture space
  float m = smoothstep(uReveal - 0.04, uReveal, 1.0 - vUv.y);
  a *= 1.0 - m;
  float fog = 1.0 - exp(-vDist * uFogDensity);
  vec3 c = mix(uColor * (1.0 + uGlow), uFogCol, fog * 0.85);
  o = vec4(c * a * uAlpha, a * uAlpha);
}`;

export function createBillboards(gl) {
  const prog = createProgram(gl, VS, FS, 'billboards');
  const quad = createBuffer(gl, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]));
  const vao = createVAO(gl, [{ buffer: quad, loc: 0, size: 2 }]);
  const words = new Map();

  /** Rasterise a word. style: e.g. 'italic 400'; family: CSS family list. Returns aspect (w/h). */
  function addWord(id, text, style, family, { size = 220, tracking = 0 } = {}) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = `${style} ${size}px ${family}`;
    g.font = font;
    const chars = [...text];
    const widths = chars.map((ch) => g.measureText(ch).width);
    const full = g.measureText(text).width + tracking * size * (chars.length - 1);
    const pad = size * 0.2;
    c.width = Math.ceil(full + pad * 2);
    c.height = Math.ceil(size * 1.3 + pad * 2);
    g.font = font;
    g.fillStyle = '#fff';
    g.textBaseline = 'alphabetic';
    const base = pad + size * 1.0;
    if (tracking === 0) {
      g.fillText(text, pad, base);
    } else {
      let x = pad;
      chars.forEach((ch, i) => { g.fillText(ch, x, base); x += widths[i] + tracking * size; });
    }
    const tex = createTexture(gl, {
      width: c.width, height: c.height, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      data: null, mipmaps: false,
    });
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (gl.ext.aniso) gl.texParameterf(gl.TEXTURE_2D, gl.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    words.set(id, { tex, aspect: c.width / c.height });
    return c.width / c.height;
  }

  return {
    addWord,
    aspect: (id) => words.get(id)?.aspect ?? 4,
    draw(frame, cam) {
      const list = frame.billboards;
      if (!list || !list.length) return;
      prog.use();
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      for (const b of list) {
        const w = words.get(b.word);
        if (!w || b.alpha <= 0) continue;
        prog.setAll({
          uViewProj: cam.viewProj, uModel: b.model, uCamPos: cam.pos, uTex: w.tex,
          uColor: b.color, uFogCol: b.fogCol, uAlpha: b.alpha, uFogDensity: b.fog ?? 0.002,
          uReveal: b.reveal ?? 1.2, uGlow: b.glow ?? 0,
        });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    },
  };
}
