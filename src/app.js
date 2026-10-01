/* ============================================================
   app.js — 交互层
   串联：提示词 → 解析层（looks.js） → 参数配方 → 管线（renderer.js）
   并把"AI 决策了什么""管线由哪些 pass 组成""每个参数能不能手调"
   全部摊在界面上。侧栏那串 JSON 是整个演示的转折点：
   它让观众看见 AI 在做决策，而不是只看见一张变了的图。
   ============================================================ */
(function () {
'use strict';

/* ---------------- DOM ---------------- */
const $ = function (id) { return document.getElementById(id); };
const viewport = $('viewport');
const view = $('view');
const vctx = view.getContext('2d');
const divider = $('divider');
const hud = $('hud');
const busy = $('busy');
const toastEl = $('toast');
const promptEl = $('prompt');
const chipsEl = $('chips');
const hitsEl = $('hits');
const jsonEl = $('json');
const flowEl = $('flow');
const passesEl = $('passes');
const engineEl = $('engine');
const engineTag = $('engine-tag');
const passStat = $('pass-stat');
const llmCfg = $('llm-cfg');
const llmBase = $('llm-base');
const llmModel = $('llm-model');
const llmHint = $('llm-hint');

/* ---------------- 状态 ---------------- */
let recipe = PPFX.baseRecipe();
let meta = { engine: 'local', hits: [], mods: [] };
let sourceCanvas = null;
let sampleKind = 0;
let split = 0.5;
let dragging = false;
let compareOn = true;
let frameMs = 16.7, lastT = 0, lastHud = 0;
let passCount = 0;

const SHORT = { grade: '分级', bloomBright: '亮部', bloomBlurH: '模糊H', bloomBlurV: '模糊V',
                edge: '描边', aberration: '色差', halftone: '网点', composite: '合成' };

const PRESETS = [
  '赛博朋克雨夜，霓虹辉光，颗粒感重',
  '水墨写意山水，留白，宣纸质感',
  '美式漫画网点，强描边，高对比',
  '蒸汽波 90 年代，扫描线，紫粉色调',
  '恐怖压抑，重暗角，低饱和',
  '黄昏金色时刻，柔和辉光，胶片颗粒',
  '故障艺术，色差撕裂，扫描线',
  '黑白极简，灰阶，轻微颗粒'
];

/* ---------------- 管线实例 ---------------- */
const passes = PPFX_RENDER.PASS_DEFS.map(function (d) {
  return { def: d, enabled: true, program: null, loc: {}, broken: false };
});

const glCanvas = document.createElement('canvas');
let pipeline = null;
let glFail = '';

try {
  const gl = glCanvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  if (!gl) throw new Error('当前浏览器不支持 WebGL2');
  pipeline = new PPFX_RENDER.Pipeline(gl, glCanvas, passes);
} catch (e) {
  glFail = e && e.message ? e.message : String(e);
  pipeline = null;
}

/* ---------------- 工具 ---------------- */
function setPath(obj, path, v) {
  const parts = String(path).split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = v;
}
function fmt(v, step) {
  const d = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Number(v).toFixed(d);
}
function tidy(o) {
  if (Array.isArray(o)) return o.map(function (v) { return typeof v === 'number' ? +v.toFixed(3) : v; });
  if (o && typeof o === 'object') {
    const out = {};
    for (const k in o) out[k] = tidy(o[k]);
    return out;
  }
  return typeof o === 'number' ? +o.toFixed(3) : o;
}
let toastTimer = 0;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
}

/* ---------------- 管线面板 ---------------- */
const sliders = [];

function buildPassUI() {
  passesEl.innerHTML = '';
  sliders.length = 0;

  passes.forEach(function (p, i) {
    const d = p.def;
    const card = document.createElement('div');
    card.className = 'pass';
    card.dataset.id = d.id;

    const head = document.createElement('label');
    head.className = 'pass-head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.enabled;
    cb.disabled = !!p.broken;
    const idx = document.createElement('span');
    idx.className = 'pass-idx';
    idx.textContent = ('0' + (i + 1)).slice(-2);
    const nm = document.createElement('span');
    nm.className = 'pass-name';
    nm.textContent = d.name;
    const de = document.createElement('span');
    de.className = 'pass-desc';
    de.textContent = p.broken ? '编译失败' : d.desc;
    head.appendChild(cb); head.appendChild(idx); head.appendChild(nm); head.appendChild(de);
    cb.addEventListener('change', function () {
      p.enabled = cb.checked;
      card.classList.toggle('off', !cb.checked);
      syncFlow();
    });
    card.appendChild(head);
    card.classList.toggle('off', !p.enabled);

    if (d.params && d.params.length) {
      const body = document.createElement('div');
      body.className = 'pass-params';
      d.params.forEach(function (pr) {
        const wrap = document.createElement('div');
        wrap.className = 'p';
        const top = document.createElement('div');
        top.className = 'p-top';
        const lab = document.createElement('span');
        lab.textContent = pr.label;
        const val = document.createElement('b');
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.min = pr.min; rng.max = pr.max; rng.step = pr.step;
        rng.addEventListener('input', function () {
          const v = parseFloat(rng.value);
          setPath(recipe, pr.path, v);
          val.textContent = fmt(v, pr.step);
          renderJSON();
        });
        top.appendChild(lab); top.appendChild(val);
        wrap.appendChild(top); wrap.appendChild(rng);
        body.appendChild(wrap);
        sliders.push({ rng: rng, val: val, pr: pr });
      });
      card.appendChild(body);
    }
    passesEl.appendChild(card);
  });
}

function syncSliders() {
  sliders.forEach(function (s) {
    const v = PPFX_RENDER.pick(recipe, s.pr.path);
    if (typeof v === 'number') {
      s.rng.value = Math.min(s.pr.max, Math.max(s.pr.min, v));
      s.val.textContent = fmt(v, s.pr.step);
    }
  });
}

function syncPassUI() {
  passes.forEach(function (p) {
    const card = passesEl.querySelector('.pass[data-id="' + p.def.id + '"]');
    if (!card) return;
    card.classList.toggle('off', !p.enabled);
    const cb = card.querySelector('input[type=checkbox]');
    if (cb && !p.broken) cb.checked = p.enabled;
  });
}

function syncFlow() {
  flowEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  passes.forEach(function (p, i) {
    if (i) {
      const em = document.createElement('em');
      em.textContent = '›';
      frag.appendChild(em);
    }
    const s = document.createElement('span');
    s.textContent = SHORT[p.def.id] || p.def.id;
    if (!p.enabled) s.className = 'off';
    frag.appendChild(s);
  });
  flowEl.appendChild(frag);
  const on = passes.filter(function (p) { return p.enabled; }).length;
  passStat.textContent = on + ' / ' + passes.length + ' pass';
}

function renderJSON() {
  jsonEl.textContent = JSON.stringify(tidy(recipe), null, 1);
}

function renderHits() {
  hitsEl.innerHTML = '';
  (meta.hits || []).forEach(function (h) {
    const el = document.createElement('span');
    el.className = 'hit';
    el.textContent = h.name;
    const i = document.createElement('i');
    i.textContent = h.weight;
    el.appendChild(i);
    hitsEl.appendChild(el);
  });
  (meta.mods || []).forEach(function (m) {
    const el = document.createElement('span');
    el.className = 'hit m';
    el.textContent = m.label;
    if (m.times > 1) {
      const i = document.createElement('i');
      i.textContent = '×' + m.times;
      el.appendChild(i);
    }
    hitsEl.appendChild(el);
  });
  if (!hitsEl.children.length) {
    const el = document.createElement('span');
    el.className = 'hit';
    el.textContent = meta.engine === 'llm' ? 'LLM 直接输出' : '未命中关键词';
    hitsEl.appendChild(el);
  }
}

/* ---------------- 应用配方 ---------------- */
function applyRecipe(r, m) {
  recipe = r;
  meta = m || { engine: 'local', hits: [], mods: [] };
  if (pipeline && pipeline.ready) pipeline.autoEnable(recipe);
  syncPassUI();
  syncSliders();
  syncFlow();
  renderJSON();
  renderHits();
  engineTag.textContent = meta.engine === 'llm'
    ? ('LLM · ' + (meta.model || ''))
    : '本地词典';
}

/* ---------------- 绘制 ---------------- */
function drawCover(ctx, img, W, H) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  if (!iw || !ih) return;
  const sa = iw / ih, ta = W / H;
  let dw, dh;
  if (sa > ta) { dh = H; dw = H * sa; } else { dw = W; dh = W / sa; }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawView() {
  const W = view.width, H = view.height;
  vctx.clearRect(0, 0, W, H);
  if (!compareOn) {
    vctx.drawImage(glCanvas, 0, 0, W, H);
    return;
  }
  const x = Math.round(split * W);
  vctx.save();
  vctx.beginPath(); vctx.rect(0, 0, x, H); vctx.clip();
  if (sourceCanvas) drawCover(vctx, sourceCanvas, W, H);
  vctx.restore();

  vctx.save();
  vctx.beginPath(); vctx.rect(x, 0, W - x, H); vctx.clip();
  vctx.drawImage(glCanvas, 0, 0, W, H);
  vctx.restore();
}

function updateHud() {
  if (!pipeline || !pipeline.ready) {
    hud.textContent = glFail ? 'WebGL 不可用' : '—';
    return;
  }
  hud.textContent = pipeline.canvasW + '×' + pipeline.canvasH
    + ' · ' + passCount + ' pass · ' + frameMs.toFixed(1) + ' ms'
    + ' · ' + Math.round(1000 / Math.max(frameMs, 0.1)) + ' fps';
}

function syncSize() {
  const r = viewport.getBoundingClientRect();
  const cssW = Math.max(2, r.width), cssH = Math.max(2, r.height);
  let scale = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = Math.round(cssW * scale), h = Math.round(cssH * scale);
  const MAXP = 2.4e6;
  if (w * h > MAXP) {
    const k = Math.sqrt(MAXP / (w * h));
    w = Math.round(w * k); h = Math.round(h * k);
  }
  view.width = w; view.height = h;
  if (pipeline && pipeline.ready) pipeline.resize(w, h);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!pipeline || !pipeline.ready) return;
  if (lastT) frameMs = frameMs * 0.9 + (now - lastT) * 0.1;
  lastT = now;
  passCount = pipeline.render(recipe, now / 1000);
  drawView();
  if (now - lastHud > 250) { lastHud = now; updateHud(); }
}

/* ---------------- 提示词 → 配方 ---------------- */
async function runPrompt(text) {
  const t = (text || promptEl.value || '').trim();
  if (!t) { showToast('先写一句提示词'); return; }
  busy.hidden = false;
  try {
    const out = await PPFX.resolveStyle(t, engineEl.value, {
      base: llmBase.value.trim(), model: llmModel.value.trim()
    });
    applyRecipe(out.recipe, out.meta);
    try { localStorage.setItem('ppfx.llm', JSON.stringify({ base: llmBase.value, model: llmModel.value })); } catch (e) {}
    if (out.meta.note) showToast(out.meta.note);
  } catch (e) {
    showToast('解析失败：' + (e && e.message ? e.message : e));
  } finally {
    busy.hidden = true;
  }
}

function buildChips() {
  chipsEl.innerHTML = '';
  PRESETS.forEach(function (p) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p;
    b.addEventListener('click', function () {
      promptEl.value = p;
      Array.prototype.forEach.call(chipsEl.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      runPrompt(p);
    });
    chipsEl.appendChild(b);
  });
}

/* ---------------- 交互绑定 ---------------- */
$('btn-run').addEventListener('click', function () { runPrompt(); });
promptEl.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runPrompt();
});

$('btn-sample').addEventListener('click', function () {
  sampleKind = (sampleKind + 1) % 3;
  sourceCanvas = PPFX_SAMPLE.makeSample(sampleKind, 1600, 900);
  if (pipeline && pipeline.ready) pipeline.uploadSource(sourceCanvas);
  showToast('示例图：' + (sourceCanvas.__name || sampleKind));
});

$('btn-upload').addEventListener('click', function () { $('file').click(); });
$('file').addEventListener('change', function (ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = function () {
    const MAX = 2048;
    const k = Math.min(1, MAX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(img.width * k));
    c.height = Math.max(2, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    sourceCanvas = c;
    if (pipeline && pipeline.ready) pipeline.uploadSource(c);
    showToast('已载入 ' + c.width + '×' + c.height);
    URL.revokeObjectURL(img.src);
  };
  img.onerror = function () { showToast('图片读取失败'); };
  img.src = URL.createObjectURL(f);
  ev.target.value = '';
});

$('btn-export').addEventListener('click', function () {
  if (!pipeline || !pipeline.ready) { showToast('渲染不可用，无法导出'); return; }
  pipeline.render(recipe, performance.now() / 1000);
  const a = document.createElement('a');
  const name = String(recipe.name || 'style').replace(/[\\/:*?"<>|\s]+/g, '_');
  a.href = glCanvas.toDataURL('image/png');
  a.download = 'postfx_' + name + '.png';
  a.click();
});

const btnCompare = $('btn-compare');
btnCompare.addEventListener('click', function () {
  compareOn = !compareOn;
  btnCompare.classList.toggle('on', compareOn);
  divider.style.display = compareOn ? '' : 'none';
});

divider.addEventListener('pointerdown', function (e) {
  dragging = true;
  try { divider.setPointerCapture(e.pointerId); } catch (err) {}
  e.preventDefault();
});
divider.addEventListener('pointermove', function (e) {
  if (!dragging) return;
  const r = viewport.getBoundingClientRect();
  split = Math.min(0.995, Math.max(0.005, (e.clientX - r.left) / r.width));
  divider.style.left = (split * 100) + '%';
});
divider.addEventListener('pointerup', function (e) {
  dragging = false;
  try { divider.releasePointerCapture(e.pointerId); } catch (err) {}
});

engineEl.addEventListener('change', function () {
  llmCfg.hidden = engineEl.value !== 'llm';
});

$('btn-test').addEventListener('click', async function () {
  llmHint.className = 'hint';
  llmHint.textContent = '连接中…';
  try {
    const ids = await PPFX.testLLM({ base: llmBase.value.trim(), model: llmModel.value.trim() });
    llmHint.className = 'hint ok';
    llmHint.textContent = '连接成功，可用模型 ' + ids.length + ' 个'
      + (ids.length ? '：' + ids.slice(0, 3).join(' / ') : '');
  } catch (e) {
    llmHint.className = 'hint';
    llmHint.textContent = '连接失败：' + (e && e.message ? e.message : e)
      + '　不影响使用 —— 会自动回落到本地词典。';
  }
});

if (window.ResizeObserver) {
  new ResizeObserver(function () { syncSize(); }).observe(viewport);
}
window.addEventListener('resize', syncSize);

/* ---------------- 启动 ---------------- */
function boot() {
  buildPassUI();
  buildChips();
  syncFlow();

  try {
    const saved = localStorage.getItem('ppfx.llm');
    if (saved) {
      const o = JSON.parse(saved);
      if (o.base) llmBase.value = o.base;
      if (o.model) llmModel.value = o.model;
    }
  } catch (e) {}

  sourceCanvas = PPFX_SAMPLE.makeSample(0, 1600, 900);
  syncSize();
  if (pipeline && pipeline.ready) {
    pipeline.uploadSource(sourceCanvas);
    if (pipeline.errors.length) {
      showToast('有 ' + pipeline.errors.length + ' 个 pass 编译失败，已自动禁用');
      if (window.console) pipeline.errors.forEach(function (x) { console.error('[pass ' + x.pass + ']', x.message); });
    }
  } else {
    hud.textContent = 'WebGL 不可用';
    showToast('WebGL2 初始化失败：' + glFail);
  }

  applyRecipe(PPFX.parseLocal(promptEl.value).recipe, PPFX.parseLocal(promptEl.value).meta);
  requestAnimationFrame(loop);
}

/* 自动化 / 验证钩子：无头环境下用来断言管线真的在按配方出图 */
window.__PPFX__ = {
  state: function () {
    return {
      glOk: !!(pipeline && pipeline.ready),
      glFail: glFail,
      canvas: pipeline && pipeline.ready ? [pipeline.canvasW, pipeline.canvasH] : null,
      passCount: passCount,
      errors: pipeline ? pipeline.errors : [],
      passes: passes.map(function (p) { return { id: p.def.id, enabled: p.enabled, broken: p.broken }; }),
      recipe: tidy(recipe),
      name: recipe.name
    };
  },
  apply: function (r) { applyRecipe(r, { engine: 'test', hits: [], mods: [] }); },
  parse: function (t) { return PPFX.parseLocal(t); },
  /* 渲染指定配方并返回 16×16 灰度签名 —— 用来断言"参数不同，出图不同" */
  sig: function (r) {
    if (r) applyRecipe(r, { engine: 'test', hits: [], mods: [] });
    if (!pipeline || !pipeline.ready) return null;
    pipeline.render(recipe, performance.now() / 1000);
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    x.drawImage(glCanvas, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    const out = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round((d[i] + d[i + 1] + d[i + 2]) / 3);
      out.push(g); sum += g;
    }
    return { px: out, mean: +(sum / out.length).toFixed(2) };
  },
  /* 以【固定时间】渲染并抓取 w×h 亮度阵列 —— 用于几何/量化分析。
     必须显式传 t：故障类效果按 uTime 抖动，若这里用 performance.now()，
     同一配方的两次抓取结果不可复现，隔离实验会得出随机结论。 */
  grab: function (r, w, h, t) {
    if (r) applyRecipe(r, { engine: 'test', hits: [], mods: [] });
    if (!pipeline || !pipeline.ready) return null;
    pipeline.render(recipe, (typeof t === 'number') ? t : 7.0);
    const W = w || 240, H = h || 180;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(glCanvas, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const lum = new Array(W * H);
    let sum = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      lum[j] = +g.toFixed(3); sum += g;
    }
    return { w: W, h: H, lum: lum, mean: +(sum / lum.length).toFixed(3) };
  },
  /* 原图的同规格签名 —— 用来断言"中性配方 == 原图"，即整条链没有偷偷改色 */
  sourceSig: function () {
    if (!sourceCanvas) return null;
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    // 必须复刻管线里的 cover 裁切，否则对比的是画面里两块不同的区域
    const iw = sourceCanvas.width, ih = sourceCanvas.height;
    const sa = iw / ih, ta = view.width / view.height;
    let sx = 1, sy = 1;
    if (sa > ta) sx = ta / sa; else sy = sa / ta;
    const cw = iw * sx, ch = ih * sy;
    x.drawImage(sourceCanvas, (iw - cw) / 2, (ih - ch) / 2, cw, ch, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    const out = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round((d[i] + d[i + 1] + d[i + 2]) / 3);
      out.push(g); sum += g;
    }
    return { px: out, mean: +(sum / out.length).toFixed(2) };
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
