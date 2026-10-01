/* ============================================================
   renderer.js — WebGL2 实时后处理管线
   ------------------------------------------------------------
   设计要点（这是"管线"本身，不是一堆散装滤镜）：
   1. 声明式注册表 PASS_DEFS —— 每个 pass 只描述：读哪张图、写哪张图、
      需要哪些 uniform（按 recipe 路径绑定）、UI 暴露哪些可调参数。
      新增一个效果 = 往表里加一条，不需要改执行器。
   2. 执行器只认三种 pass 类型：
        full  → 读当前链 → 写 ping-pong 里的另一张 → 交换
        aux   → 读指定源 → 写辅助 RT（不进主链），例如半分辨率辉光
        final → 读当前链（+辅助图）→ 写到屏幕
   3. ping-pong 双 RT：读写的 RT 永不同一，避免反馈环。
   4. 所有 pass 可独立关闭，执行器直接跳过 —— 这条链是可插拔的。
   5. 每个 pass 编译失败只上报并禁用自身，不拖垮整条管线。
   ============================================================ */
(function (root) {
'use strict';

/* ---------------- 着色器 ---------------- */

const VS = [
  '#version 300 es',
  'layout(location = 0) in vec2 aPos;',
  'out vec2 vUV;',
  'void main(){',
  '  vUV = aPos * 0.5 + 0.5;',
  '  gl_Position = vec4(aPos, 0.0, 1.0);',
  '}'
].join('\n');

const PRELUDE = [
  '#version 300 es',
  'precision highp float;',
  'in vec2 vUV;',
  'out vec4 fragColor;',
  'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
  'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }'
].join('\n');

const FS = {

  /* 把上传的图按 cover 方式归一到画布尺寸，成为整条链的稳定输入 */
  cover: [
    'uniform sampler2D uTex;',
    'uniform vec2 uScale;',
    'uniform vec2 uOffset;',
    'void main(){',
    '  fragColor = vec4(texture(uTex, vUV * uScale + uOffset).rgb, 1.0);',
    '}'
  ].join('\n'),

  /* 色彩分级：曝光 → 增益/抬升 → 伽马 → 色温 → 对比 → 饱和 → 染色 */
  grade: [
    'uniform sampler2D uTex;',
    'uniform float uExposure, uSat, uTemp, uContrast;',
    'uniform vec3 uLift, uGamma, uGain, uTint;',
    'void main(){',
    '  vec3 c = texture(uTex, vUV).rgb;',
    '  c *= (1.0 + uExposure);',
    '  c = c * uGain + uLift;',
    '  c = pow(max(c, 0.0), 1.0 / max(uGamma, vec3(0.05)));',
    '  c.r *= 1.0 + uTemp * 0.22;',
    '  c.b *= 1.0 - uTemp * 0.22;',
    '  c = (c - 0.5) * uContrast + 0.5;',
    '  float l = luma(c);',
    '  c = mix(vec3(l), c, uSat);',
    '  c *= uTint;',
    '  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n'),

  /* 辉光亮部提取 */
  bright: [
    'uniform sampler2D uTex;',
    'uniform float uThreshold;',
    'void main(){',
    '  vec3 c = texture(uTex, vUV).rgb;',
    '  float k = smoothstep(uThreshold, uThreshold + 0.12, luma(c));',
    '  fragColor = vec4(c * k, 1.0);',
    '}'
  ].join('\n'),

  /* 可分离高斯：9 tap */
  blur: [
    'uniform sampler2D uTex;',
    'uniform vec2 uTexel, uDir;',
    'uniform float uRadius;',
    'void main(){',
    '  vec2 d = uDir * uTexel * max(uRadius, 0.4);',
    '  vec3 s  = texture(uTex, vUV).rgb * 0.2270270;',
    '  s += (texture(uTex, vUV + d * 1.0).rgb + texture(uTex, vUV - d * 1.0).rgb) * 0.1945946;',
    '  s += (texture(uTex, vUV + d * 2.0).rgb + texture(uTex, vUV - d * 2.0).rgb) * 0.1216216;',
    '  s += (texture(uTex, vUV + d * 3.0).rgb + texture(uTex, vUV - d * 3.0).rgb) * 0.0540540;',
    '  s += (texture(uTex, vUV + d * 4.0).rgb + texture(uTex, vUV - d * 4.0).rgb) * 0.0162162;',
    '  fragColor = vec4(s, 1.0);',
    '}'
  ].join('\n'),

  /* Sobel 描边 */
  edge: [
    'uniform sampler2D uTex;',
    'uniform vec2 uTexel;',
    'uniform float uIntensity, uThreshold;',
    'uniform vec3 uColor;',
    'void main(){',
    '  vec3 c = texture(uTex, vUV).rgb;',
    '  float tl = luma(texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb);',
    '  float t  = luma(texture(uTex, vUV + uTexel * vec2( 0.0, 1.0)).rgb);',
    '  float tr = luma(texture(uTex, vUV + uTexel * vec2( 1.0, 1.0)).rgb);',
    '  float ml = luma(texture(uTex, vUV + uTexel * vec2(-1.0, 0.0)).rgb);',
    '  float mr = luma(texture(uTex, vUV + uTexel * vec2( 1.0, 0.0)).rgb);',
    '  float bl = luma(texture(uTex, vUV + uTexel * vec2(-1.0,-1.0)).rgb);',
    '  float b  = luma(texture(uTex, vUV + uTexel * vec2( 0.0,-1.0)).rgb);',
    '  float br = luma(texture(uTex, vUV + uTexel * vec2( 1.0,-1.0)).rgb);',
    '  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);',
    '  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);',
    '  float g = sqrt(gx * gx + gy * gy);',
    '  float e = clamp(smoothstep(uThreshold, uThreshold + 0.18, g) * uIntensity, 0.0, 1.0);',
    '  fragColor = vec4(mix(c, uColor, e), 1.0);',
    '}'
  ].join('\n'),

  /* 径向色散 + 行错位（故障） */
  aberration: [
    'uniform sampler2D uTex;',
    'uniform float uAmount, uGlitch, uTime;',
    'void main(){',
    '  vec2 uv = vUV;',
    '  if (uGlitch > 0.001) {',
    '    float band = floor(uv.y * 42.0);',
    '    float r = hash(vec2(band, floor(uTime * 9.0)));',
    '    if (r > 0.88) uv.x += ((r - 0.88) * 8.0 - 0.4) * uGlitch * 0.08;',
    '  }',
    '  vec2 off = (uv - 0.5) * (uAmount * 0.006);',
    '  fragColor = vec4(texture(uTex, uv + off).r,',
    '                   texture(uTex, uv).g,',
    '                   texture(uTex, uv - off).b, 1.0);',
    '}'
  ].join('\n'),

  /* 网点（半调屏） */
  halftone: [
    'uniform sampler2D uTex;',
    'uniform vec2 uRes;',
    'uniform float uMix, uScale, uAngle;',
    'void main(){',
    '  vec3 c = texture(uTex, vUV).rgb;',
    '  float s = sin(uAngle), co = cos(uAngle);',
    '  vec2 p = mat2(co, -s, s, co) * (vUV * uRes) / max(uScale, 1.0);',
    '  vec2 cell = fract(p) - 0.5;',
    '  float d = length(cell) * 2.0;',
    '  float l = clamp(luma(c), 0.03, 0.97);',
    '  float dotm = 1.0 - smoothstep(l, l + 0.10, d);',
    '  vec3 ht = c * mix(0.18, 1.0, dotm);',
    '  fragColor = vec4(mix(c, ht, clamp(uMix, 0.0, 1.0)), 1.0);',
    '}'
  ].join('\n'),

  /* 合成输出：辉光叠加 → 扫描线 → 颗粒 → 暗角 */
  composite: [
    'uniform sampler2D uTex, uBloom;',
    'uniform vec2 uRes;',
    'uniform float uBloomIntensity, uScanIntensity, uScanFreq;',
    'uniform float uGrainIntensity, uGrainScale, uVignette, uVigSoft, uTime;',
    'void main(){',
    '  vec3 c = texture(uTex, vUV).rgb;',
    '  if (uBloomIntensity > 0.001) c += texture(uBloom, vUV).rgb * uBloomIntensity;',
    '  if (uScanIntensity > 0.001) c *= 1.0 - uScanIntensity * (0.5 + 0.5 * sin(vUV.y * uScanFreq));',
    '  if (uGrainIntensity > 0.001) {',
    '    // 颗粒格子必须按像素定尺寸：若按 UV 定，画布一变密格子就小于一个像素，',
    '    // floor() 会跳格采样，噪点退化成规则的网格摩尔纹。',
    '    float g = hash(floor(vUV * uRes / max(uGrainScale, 0.5)) + vec2(uTime * 61.0, uTime * 37.0));',
    '    c += (g - 0.5) * uGrainIntensity;',
    '  }',
    '  if (uVignette > 0.001) {',
    '    float r = length((vUV - 0.5) * 2.0);',
    '    c *= 1.0 - uVignette * smoothstep(mix(0.95, 0.15, uVigSoft), 1.05, r);',
    '  }',
    '  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n')
};

/* ---------------- pass 注册表 ---------------- */
/* kind: full | aux | final                                    */
/* uniforms: [着色器变量名, recipe 路径] —— 绑定时自动取值        */
/* params: UI 暴露给美术的可调参数（写回 recipe 同一路径）        */
const PASS_DEFS = [
  {
    id: 'grade', name: '色彩分级', desc: 'lift / gamma / gain · 饱和 · 色温 · 对比',
    kind: 'full', fs: 'grade',
    uniforms: [['uExposure', 'grade.exposure'], ['uLift', 'grade.lift'], ['uGamma', 'grade.gamma'],
               ['uGain', 'grade.gain'], ['uSat', 'grade.sat'], ['uTemp', 'grade.temp'],
               ['uContrast', 'grade.contrast'], ['uTint', 'grade.tint']],
    autoOn: function () { return true; },
    params: [
      { path: 'grade.exposure', label: '曝光', min: -0.6, max: 0.6, step: 0.01 },
      { path: 'grade.contrast', label: '对比度', min: 0.4, max: 2.2, step: 0.01 },
      { path: 'grade.sat', label: '饱和度', min: 0, max: 2.4, step: 0.01 },
      { path: 'grade.temp', label: '色温', min: -1, max: 1, step: 0.01 }
    ]
  },
  {
    id: 'bloomBright', name: '辉光 · 亮部提取', desc: '阈值提取，半分辨率',
    kind: 'aux', fs: 'bright', readFrom: 'chain', writeTo: 'bloomA', scale: 0.5,
    uniforms: [['uThreshold', 'bloom.threshold']],
    autoOn: function (r) { return r.bloom.intensity > 0.004; },
    params: [{ path: 'bloom.threshold', label: '阈值', min: 0.2, max: 0.98, step: 0.01 }]
  },
  {
    id: 'bloomBlurH', name: '辉光 · 横向模糊', desc: '9 tap 高斯 · 半分辨率',
    kind: 'aux', fs: 'blur', readFrom: 'bloomA', writeTo: 'bloomB', scale: 0.5, dir: [1, 0],
    uniforms: [['uRadius', 'bloom.radius']],
    autoOn: function (r) { return r.bloom.intensity > 0.004; },
    params: [{ path: 'bloom.radius', label: '半径', min: 0.4, max: 4, step: 0.05 }]
  },
  {
    id: 'bloomBlurV', name: '辉光 · 纵向模糊', desc: '9 tap 高斯 · 半分辨率',
    kind: 'aux', fs: 'blur', readFrom: 'bloomB', writeTo: 'bloomA', scale: 0.5, dir: [0, 1],
    uniforms: [['uRadius', 'bloom.radius']],
    autoOn: function (r) { return r.bloom.intensity > 0.004; },
    params: []
  },
  {
    id: 'edge', name: '描边', desc: 'Sobel 边缘检测',
    kind: 'full', fs: 'edge',
    uniforms: [['uIntensity', 'edge.intensity'], ['uThreshold', 'edge.threshold'], ['uColor', 'edge.color']],
    autoOn: function (r) { return r.edge.intensity > 0.004; },
    params: [
      { path: 'edge.intensity', label: '强度', min: 0, max: 1.5, step: 0.01 },
      { path: 'edge.threshold', label: '阈值', min: 0.02, max: 0.7, step: 0.005 }
    ]
  },
  {
    id: 'aberration', name: '色差 / 故障', desc: '径向色散 + 行错位',
    kind: 'full', fs: 'aberration',
    uniforms: [['uAmount', 'aberration.amount'], ['uGlitch', 'aberration.glitch']],
    autoOn: function (r) { return r.aberration.amount > 0.004 || r.aberration.glitch > 0.004; },
    params: [
      { path: 'aberration.amount', label: '色散', min: 0, max: 6, step: 0.05 },
      { path: 'aberration.glitch', label: '错位', min: 0, max: 1, step: 0.01 }
    ]
  },
  {
    id: 'halftone', name: '网点', desc: '可调角度半调屏',
    kind: 'full', fs: 'halftone',
    uniforms: [['uMix', 'halftone.mix'], ['uScale', 'halftone.scale'], ['uAngle', 'halftone.angle']],
    autoOn: function (r) { return r.halftone.mix > 0.004; },
    params: [
      { path: 'halftone.mix', label: '混合', min: 0, max: 1, step: 0.01 },
      { path: 'halftone.scale', label: '网点尺寸', min: 2, max: 16, step: 0.1 }
    ]
  },
  {
    id: 'composite', name: '合成输出', desc: '辉光叠加 · 扫描线 · 颗粒 · 暗角',
    kind: 'final', fs: 'composite',
    uniforms: [['uBloomIntensity', 'bloom.intensity'],
               ['uScanIntensity', 'scanline.intensity'], ['uScanFreq', 'scanline.freq'],
               ['uGrainIntensity', 'grain.intensity'], ['uGrainScale', 'grain.scale'],
               ['uVignette', 'vignette.intensity'], ['uVigSoft', 'vignette.softness']],
    autoOn: function () { return true; },
    params: [
      { path: 'bloom.intensity', label: '辉光强度', min: 0, max: 2.5, step: 0.01 },
      { path: 'scanline.intensity', label: '扫描线', min: 0, max: 0.8, step: 0.005 },
      { path: 'grain.intensity', label: '颗粒', min: 0, max: 0.4, step: 0.002 },
      { path: 'grain.scale', label: '颗粒粗细(px)', min: 0.6, max: 6, step: 0.1 },
      { path: 'vignette.intensity', label: '暗角', min: 0, max: 1.3, step: 0.01 }
    ]
  }
];

/* ---------------- GL 工具 ---------------- */
function pick(obj, path) {
  const parts = String(path).split('.');
  let v = obj;
  for (let i = 0; i < parts.length; i++) {
    if (v === null || v === undefined) return 0;
    v = v[parts[i]];
  }
  return (v === undefined) ? 0 : v;
}

function setUniform(gl, loc, v) {
  if (loc === null || loc === undefined) return;
  if (typeof v === 'number') { gl.uniform1f(loc, v); return; }
  if (Array.isArray(v)) {
    if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'unknown compile error');
  }
  return sh;
}

function makeProgram(gl, fragBody) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, PRELUDE + '\n' + fragBody);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!ok) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(log || 'link failed');
  }
  return p;
}

function makeRT(gl, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex: tex, fbo: fbo, w: w, h: h };
}

function killRT(gl, rt) {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
}

/* ============================================================
   Pipeline
   ============================================================ */
function Pipeline(gl, canvas, passes) {
  this.gl = gl;
  this.canvas = canvas;
  this.passes = passes;               // 由 app 持有，UI 与渲染共享同一份状态
  this.errors = [];
  this.ready = false;
  this.srcW = 2; this.srcH = 2;
  this.canvasW = 2; this.canvasH = 2;
  this.coverScale = [1, 1];
  this.coverOffset = [0, 0];
  this.bloomTex = null;
  this.lastPassCount = 0;

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);

  // 全屏三角形
  this.vao = gl.createVertexArray();
  gl.bindVertexArray(this.vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // 黑纹理：bloom 缺席时的占位，避免分支绑定的未定义行为
  this.black = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // 输入图纹理
  this.srcTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([20, 20, 26, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  this.coverProgram = makeProgram(gl, FS.cover);
  this.coverLoc = {};

  // 逐 pass 编译；单个失败只禁用自身
  const self = this;
  passes.forEach(function (p) {
    try {
      p.program = makeProgram(gl, FS[p.def.fs]);
      p.loc = {};
    } catch (e) {
      p.program = null;
      p.broken = true;
      p.enabled = false;
      self.errors.push({ pass: p.def.id, message: e.message });
    }
  });

  this.ready = true;
}

Pipeline.prototype.autoEnable = function (recipe) {
  this.passes.forEach(function (p) {
    if (p.broken) { p.enabled = false; return; }
    p.enabled = p.def.autoOn ? !!p.def.autoOn(recipe) : true;
  });
};

Pipeline.prototype.resize = function (w, h) {
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  if (w === this.canvasW && h === this.canvasH && this.rt) return false;
  const gl = this.gl;
  this.canvasW = w; this.canvasH = h;
  this.canvas.width = w; this.canvas.height = h;

  killRT(gl, this.rt && this.rt[0]);
  killRT(gl, this.rt && this.rt[1]);
  killRT(gl, this.auxA);
  killRT(gl, this.auxB);

  this.rt = [makeRT(gl, w, h), makeRT(gl, w, h)];
  this.auxA = makeRT(gl, w * 0.5, h * 0.5);
  this.auxB = makeRT(gl, w * 0.5, h * 0.5);
  this.updateCover();
  return true;
};

Pipeline.prototype.updateCover = function () {
  const sa = this.srcW / this.srcH;
  const ta = this.canvasW / this.canvasH;
  let sx = 1, sy = 1;
  if (sa > ta) sx = ta / sa; else sy = sa / ta;
  this.coverScale = [sx, sy];
  this.coverOffset = [(1 - sx) * 0.5, (1 - sy) * 0.5];
};

Pipeline.prototype.uploadSource = function (source) {
  const gl = this.gl;
  this.srcW = source.width || source.naturalWidth || 2;
  this.srcH = source.height || source.naturalHeight || 2;
  gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // 源图通常远大于画布，cover 这一步是缩小采样。
  // 没有 mipmap 时 LINEAR 只取 2x2 纹素，高频细节（灯窗、噪点、细线条）
  // 会走样并把整体亮度带偏 —— 表现为"什么都没调，画面却和原图不一样"。
  // WebGL2 支持 NPOT mipmap，直接生成即可。
  if (gl.getParameter(gl.VERSION)) {
    try { gl.generateMipmap(gl.TEXTURE_2D); } catch (e) {}
  }
  this.updateCover();
};

Pipeline.prototype._uloc = function (program, cache, name) {
  if (!(name in cache)) cache[name] = this.gl.getUniformLocation(program, name);
  return cache[name];
};

Pipeline.prototype._draw = function (pass, readTex, writeRT, recipe, time) {
  const gl = this.gl;
  const d = pass.def;
  const W = writeRT ? writeRT.w : this.canvasW;
  const H = writeRT ? writeRT.h : this.canvasH;

  gl.useProgram(pass.program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, writeRT ? writeRT.fbo : null);
  gl.viewport(0, 0, W, H);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, readTex);
  gl.uniform1i(this._uloc(pass.program, pass.loc, 'uTex'), 0);

  if (d.fs === 'composite') {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex || this.black);
    gl.uniform1i(this._uloc(pass.program, pass.loc, 'uBloom'), 1);
  }

  const u = d.uniforms || [];
  for (let i = 0; i < u.length; i++) {
    setUniform(gl, this._uloc(pass.program, pass.loc, u[i][0]), pick(recipe, u[i][1]));
  }

  // 内建 uniform
  setUniform(gl, this._uloc(pass.program, pass.loc, 'uTexel'), [1 / W, 1 / H]);
  setUniform(gl, this._uloc(pass.program, pass.loc, 'uRes'), [W, H]);
  setUniform(gl, this._uloc(pass.program, pass.loc, 'uTime'), time);
  if (d.dir) setUniform(gl, this._uloc(pass.program, pass.loc, 'uDir'), d.dir);

  gl.bindVertexArray(this.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
};

Pipeline.prototype.render = function (recipe, time) {
  if (!this.ready || !this.rt) return 0;
  const gl = this.gl;
  let n = 0;

  // 0) 输入归一化：cover 到画布尺寸 → rt[0]
  gl.useProgram(this.coverProgram);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.rt[0].fbo);
  gl.viewport(0, 0, this.canvasW, this.canvasH);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
  gl.uniform1i(this._uloc(this.coverProgram, this.coverLoc, 'uTex'), 0);
  setUniform(gl, this._uloc(this.coverProgram, this.coverLoc, 'uScale'), this.coverScale);
  setUniform(gl, this._uloc(this.coverProgram, this.coverLoc, 'uOffset'), this.coverOffset);
  gl.bindVertexArray(this.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  n++;

  // 1) 按注册表顺序执行
  let read = this.rt[0].tex;
  let wi = 1;
  this.bloomTex = null;

  for (let i = 0; i < this.passes.length; i++) {
    const p = this.passes[i];
    if (!p.enabled || !p.program) continue;
    const d = p.def;

    if (d.kind === 'full') {
      const dst = this.rt[wi];
      this._draw(p, read, dst, recipe, time);
      read = dst.tex;
      wi ^= 1;
      n++;
    } else if (d.kind === 'aux') {
      const src = d.readFrom === 'bloomA' ? this.auxA.tex
                : d.readFrom === 'bloomB' ? this.auxB.tex
                : read;
      const dst = d.writeTo === 'bloomB' ? this.auxB : this.auxA;
      this._draw(p, src, dst, recipe, time);
      if (d.writeTo === 'bloomA') this.bloomTex = dst.tex;
      n++;
    } else {
      this._draw(p, read, null, recipe, time);
      n++;
    }
  }

  this.lastPassCount = n;
  return n;
};

const API = { Pipeline: Pipeline, PASS_DEFS: PASS_DEFS, FS: FS, VS: VS, PRELUDE: PRELUDE,
              pick: pick, makeProgram: makeProgram, compile: compile };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.PPFX_RENDER = API;
})(typeof window !== 'undefined' ? window : globalThis);
