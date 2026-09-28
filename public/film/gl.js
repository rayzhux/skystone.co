// Thin WebGL2 helpers: programs with typed uniform setters, buffers, textures, render targets.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: false,
  });
  if (!gl) return null;
  const ext = {
    floatRT: !!gl.getExtension('EXT_color_buffer_float'),
    halfRT: !!gl.getExtension('EXT_color_buffer_half_float'),
    aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
  };
  gl.ext = ext;
  return gl;
}

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n');
    throw new Error(`[${name}] shader compile failed:\n${log}\n${lines}`);
  }
  return s;
}

export function createProgram(gl, vs, fs, name = 'program') {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name + '.vs'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`[${name}] link failed: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  let texUnit = 0;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const uname = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(p, info.name);
    const u = { loc, type: info.type, size: info.size };
    if (
      info.type === gl.SAMPLER_2D ||
      info.type === gl.SAMPLER_3D ||
      info.type === gl.INT_SAMPLER_2D ||
      info.type === gl.UNSIGNED_INT_SAMPLER_2D
    ) {
      u.unit = texUnit++;
    }
    uniforms[uname] = u;
  }
  const prog = {
    program: p,
    uniforms,
    use() {
      gl.useProgram(p);
      return prog;
    },
    set(name, v) {
      const u = uniforms[name];
      if (!u) return prog;
      const l = u.loc;
      switch (u.type) {
        case gl.FLOAT:
          if (u.size > 1) gl.uniform1fv(l, v);
          else gl.uniform1f(l, v);
          break;
        case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
        case gl.INT:
        case gl.BOOL:
          if (u.size > 1) gl.uniform1iv(l, v);
          else gl.uniform1i(l, v);
          break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
        case gl.SAMPLER_2D:
        case gl.SAMPLER_3D:
        case gl.INT_SAMPLER_2D:
        case gl.UNSIGNED_INT_SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + u.unit);
          gl.bindTexture(u.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, v);
          gl.uniform1i(l, u.unit);
          break;
        default:
          break;
      }
      return prog;
    },
    setAll(obj) {
      for (const k in obj) prog.set(k, obj[k]);
      return prog;
    },
  };
  return prog;
}

export function createBuffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}

/** attribs: [{buffer, loc, size, type?, stride?, offset?, divisor?, integer?}] */
export function createVAO(gl, attribs, indexBuffer = null) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const a of attribs) {
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
    gl.enableVertexAttribArray(a.loc);
    if (a.integer) gl.vertexAttribIPointer(a.loc, a.size, a.type || gl.INT, a.stride || 0, a.offset || 0);
    else gl.vertexAttribPointer(a.loc, a.size, a.type || gl.FLOAT, false, a.stride || 0, a.offset || 0);
    if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
  }
  if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);
  return vao;
}

export function createTexture(gl, { width, height, internalFormat, format, type, data = null, filter, wrap, mipmaps = false }) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  const f = filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap ?? gl.CLAMP_TO_EDGE);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

/** Color render target backed by a texture (no depth). */
export function createTarget(gl, width, height, hdr) {
  const internal = hdr ? gl.RGBA16F : gl.RGBA8;
  const type = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const tex = createTexture(gl, { width, height, internalFormat: internal, format: gl.RGBA, type });
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, width, height, ok };
}

/** Multisampled scene target (color + depth renderbuffers). */
export function createMSTarget(gl, width, height, hdr, samples) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const color = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, color);
  const fmt = hdr ? gl.RGBA16F : gl.RGBA8;
  if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, width, height);
  else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
  else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, color, depth, width, height, ok, samples };
}

export function deleteTarget(gl, t) {
  if (!t) return;
  if (t.fb) gl.deleteFramebuffer(t.fb);
  if (t.tex) gl.deleteTexture(t.tex);
  if (t.color) gl.deleteRenderbuffer(t.color);
  if (t.depth) gl.deleteRenderbuffer(t.depth);
}

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared GLSL snippets
export const GLSL_NOISE = `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)), hash13(i+vec3(1,0,0)), u.x),
                 mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x),
                 mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
