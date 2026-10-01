/* ============================================================
   _smoke.js — 无浏览器冒烟测试
   用 node 的 vm 直接把 src 里的纯逻辑模块加载起来断言。
   覆盖两层：
     A) looks.js    解析层 —— 锚点命中、程度词、区间钳制、配对权重
     B) renderer.js 管线接线 —— pass 拓扑、uniform 路径、UI 参数区间、GLSL 静态结构
   跑法： node _smoke.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function load(file) {
  const sandbox = { module: { exports: {} }, console: console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}

const L = load('looks.js');     // 解析层
const R = load('renderer.js');  // 管线层

let nPass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { nPass++; console.log('   ok   ' + name); }
  else { fails.push(name); console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}

function group(title) { console.log('\n== ' + title + ' =='); }

/* ---------------- A. 解析层 ---------------- */

group('A1 中性基线');
const base = L.baseRecipe();
ok('baseRecipe 含全部 8 个效果分组',
   ['grade', 'bloom', 'edge', 'halftone', 'aberration', 'scanline', 'grain', 'vignette']
     .every(k => base[k] && typeof base[k] === 'object'));
ok('基线中性的色彩参数', base.grade.sat === 1 && base.grade.contrast === 1 && base.grade.exposure === 0);
ok('基线中性的效果强度',
   base.bloom.intensity === 0 && base.edge.intensity === 0 && base.grain.intensity === 0 &&
   base.vignette.intensity === 0 && base.aberration.amount === 0 && base.halftone.mix === 0 &&
   base.scanline.intensity === 0);

group('A2 锚点 → 参数方向');
const cyber = L.parseLocal('赛博朋克雨夜，霓虹');
ok('赛博朋克：蓝通道增益高于红通道',
   cyber.recipe.grade.gain[2] > cyber.recipe.grade.gain[0],
   JSON.stringify(cyber.recipe.grade.gain));
ok('赛博朋克：辉光被打开', cyber.recipe.bloom.intensity > 0.3, cyber.recipe.bloom.intensity);
ok('赛博朋克：色差被打开', cyber.recipe.aberration.amount > 0.3, cyber.recipe.aberration.amount);

const ink = L.parseLocal('水墨写意山水');
ok('水墨：饱和度显著降低', ink.recipe.grade.sat < 0.5, ink.recipe.grade.sat);
ok('水墨：开启描边', ink.recipe.edge.intensity > 0.2, ink.recipe.edge.intensity);

const mono = L.parseLocal('黑白极简');
ok('黑白：饱和度趋近 0', mono.recipe.grade.sat <= 0.05, mono.recipe.grade.sat);

const horror = L.parseLocal('恐怖阴森');
ok('恐怖：暗角显著加重', horror.recipe.vignette.intensity > 0.5, horror.recipe.vignette.intensity);

const glitch = L.parseLocal('故障艺术，撕裂错位');
ok('故障：行错位强度显著', glitch.recipe.aberration.glitch > 0.3, glitch.recipe.aberration.glitch);

const comic = L.parseLocal('美式漫画网点');
ok('漫画：网点被打开', comic.recipe.halftone.mix > 0.2, comic.recipe.halftone.mix);

group('A3 匹配去重与程度词');
ok('长词优先：赛博朋克不会被"赛博"重复计数',
   cyber.meta.hits.length === 1, JSON.stringify(cyber.meta.hits));
ok('同一锚点内的多个词合并为一个命中',
   comic.meta.hits.length === 1, JSON.stringify(comic.meta.hits));

const strong = L.parseLocal('非常重的颗粒感');
const weak = L.parseLocal('轻微颗粒感');
ok('程度词生效：非常 > 轻微',
   strong.recipe.grain.intensity > weak.recipe.grain.intensity,
   strong.recipe.grain.intensity + ' vs ' + weak.recipe.grain.intensity);
ok('程度词方向正确：轻微应低于基线增量 0.11',
   weak.recipe.grain.intensity < 0.11, weak.recipe.grain.intensity);

group('A4 区间钳制');
const extreme = L.parseLocal('非常非常极度过曝，极高对比，极高饱和，极强暗角');
ok('极端措辞下曝光不越过上限 0.6', extreme.recipe.grade.exposure <= 0.6001, extreme.recipe.grade.exposure);
ok('极端措辞下对比度不越过上限 2.2', extreme.recipe.grade.contrast <= 2.2001, extreme.recipe.grade.contrast);
ok('极端措辞下饱和度不越过上限 2.4', extreme.recipe.grade.sat <= 2.4001, extreme.recipe.grade.sat);
ok('极端措辞下暗角不越过上限 1.3', extreme.recipe.vignette.intensity <= 1.3001, extreme.recipe.vignette.intensity);

const wild = L.baseRecipe();
wild.grade.exposure = 5; wild.grade.sat = 99;
wild.halftone.scale = -3; wild.bloom.radius = 0.01;
L.clampRecipe(wild);
ok('clampRecipe 把越界标量压回上界', wild.grade.exposure === 0.6 && wild.grade.sat === 2.4);
ok('clampRecipe 把越界标量压回下界', wild.halftone.scale === 2 && wild.bloom.radius === 0.4);

const finite = function (o) {
  return Object.keys(o).every(function (k) {
    const v = o[k];
    if (typeof v === 'number') return isFinite(v);
    if (Array.isArray(v)) return v.every(function (x) { return isFinite(x); });
    if (v && typeof v === 'object') return finite(v);
    return true;
  });
};

/* 这一组是回归防线：锚点 patch 的语义一旦被写乱（例如 gamma 写成绝对值），
   合成结果就会冲出区间、被 clampRecipe 悄悄削平，肉眼看只是"颜色不太对"。
   所以必须断言：单独应用任何锚点都天然落在区间内，钳制不该在正常路径上生效。 */
group('A4b 锚点语义：绝对目标值');
let overflow = '';
L.ANCHORS.forEach(function (a) {
  const soloR = L.blendAnchors([{ patch: a.patch, k: 1 }]);
  Object.keys(L.RANGES).forEach(function (p) {
    const v = L.deepGet(soloR, p);
    if (typeof v !== 'number') return;
    const rg = L.RANGES[p];
    if (v < rg[0] - 1e-6 || v > rg[1] + 1e-6) overflow = a.id + ' ' + p + '=' + v.toFixed(3);
  });
});
ok('任意锚点单独应用都天然落在区间内，不依赖钳制兜底', overflow === '', overflow);

function soloOf(id) {
  const a = L.ANCHORS.find(function (x) { return x.id === id; });
  return L.blendAnchors([{ patch: a.patch, k: 1 }]);
}
const cyberSolo = soloOf('cyber');
ok('赛博朋克：伽马就是 1.06 / 1.00 / 0.94，不是叠加后的 1.7',
   Math.abs(cyberSolo.grade.gamma[0] - 1.06) < 1e-6 && Math.abs(cyberSolo.grade.gamma[2] - 0.94) < 1e-6,
   JSON.stringify(cyberSolo.grade.gamma));
ok('赛博朋克：增益就是 0.90 / 0.94 / 1.30',
   Math.abs(cyberSolo.grade.gain[0] - 0.90) < 1e-6 && Math.abs(cyberSolo.grade.gain[2] - 1.30) < 1e-6,
   JSON.stringify(cyberSolo.grade.gain));
ok('锚点没写的字段保持基础值（曝光仍为 0，网点仍未开）',
   cyberSolo.grade.exposure === 0 && cyberSolo.halftone.mix === 0);

const cyberPatch = L.ANCHORS.find(function (x) { return x.id === 'cyber'; }).patch;
const monoPatch = L.ANCHORS.find(function (x) { return x.id === 'mono'; }).patch;
const pair = L.blendAnchors([{ patch: cyberPatch, k: 0.5 }, { patch: monoPatch, k: 0.5 }]);
ok('双锚点等权混合 = 两者中点（饱和 1.30 与 0.05 → 0.675）',
   Math.abs(pair.grade.sat - 0.675) < 1e-6, pair.grade.sat);
ok('等权混合残差为 0，不会额外拉回基础值（辉光 = (0.70+0.20)/2）',
   Math.abs(pair.bloom.intensity - 0.45) < 1e-6, pair.bloom.intensity);
const half = L.blendAnchors([{ patch: cyberPatch, k: 0.5 }]);
ok('占比不满 1 时残差留在基础值上（半强度赛博朋克：饱和 ≈ 1.15）',
   Math.abs(half.grade.sat - 1.15) < 1e-6, half.grade.sat);
const over = L.blendAnchors([{ patch: cyberPatch, k: 1.5 }]);
ok('占比之和超过 1 时先归一化，不过驱动（饱和仍为 1.30）',
   Math.abs(over.grade.sat - 1.30) < 1e-6, over.grade.sat);

const monoEmph = L.parseLocal('黑白极简');
ok('风格词内部的字不被误判成程度词（"极简"里的"极"）',
   Math.abs(monoEmph.recipe.grade.sat - 0.05) < 1e-6, monoEmph.recipe.grade.sat);
ok('"极简"仍被正确识别为黑白极简锚点',
   monoEmph.recipe.name.indexOf('黑白极简') >= 0, monoEmph.recipe.name);

group('A5 全锚点遍历');
let anchorBad = '';
L.ANCHORS.forEach(function (a) {
  if (!finite(L.parseLocal(a.words[0]).recipe)) anchorBad = a.id;
  if (!finite(L.parseLocal(a.words.join(' ')).recipe)) anchorBad = a.id + '(全词)';
  if (!finite(soloOf(a.id))) anchorBad = a.id + '(solo)';
});
ok(L.ANCHORS.length + ' 个锚点单独解析 / 全词解析 / 直接应用都产出有限数值',
   anchorBad === '', anchorBad);

L.MODIFIERS.forEach(function (m) {
  const r = L.parseLocal(m.words[0]).recipe;
  if (!finite(r)) anchorBad = m.id;
});
ok(L.MODIFIERS.length + ' 个修饰词逐个单独解析都产出有限数值', anchorBad === '', anchorBad);

group('A6 无命中回落');
const blank = L.parseLocal('zzz qqq');
ok('完全无命中时回落到中性配方', blank.recipe.name === '原始', blank.recipe.name);
ok('无命中时辉光/描边/网点均为 0',
   blank.recipe.bloom.intensity === 0 && blank.recipe.edge.intensity === 0 &&
   blank.recipe.halftone.mix === 0);
ok('无命中时不会误开任何 pass 开关',
   !R.PASS_DEFS.find(function (d) { return d.id === 'edge'; }).autoOn(blank.recipe));

group('A7 钳制区间覆盖度');
const paths = [];
(function walk(o, pre) {
  Object.keys(o).forEach(function (k) {
    if (k === 'name') return;
    const p = pre ? pre + '.' + k : k;
    const v = o[k];
    if (typeof v === 'number' || Array.isArray(v)) paths.push(p);
    else if (v && typeof v === 'object') walk(v, p);
  });
})(base, '');
const noRange = paths.filter(function (p) { return !L.RANGES[p]; });
ok('baseRecipe 的 ' + paths.length + ' 个数值字段全部登记了钳制区间',
   noRange.length === 0, noRange.join(', '));

group('A8 LLM 兜底合并');
const merged = L.mergeDefaults({ name: '测试', grade: { sat: 1.5 } });
ok('mergeDefaults 补齐缺失分组', !!(merged.bloom && merged.edge && merged.halftone && merged.vignette));
ok('mergeDefaults 保留已有值', merged.grade.sat === 1.5);
ok('mergeDefaults 保留风格名', merged.name === '测试');
ok('mergeDefaults 缺失字段回到中性值', merged.grade.contrast === 1 && merged.bloom.intensity === 0);
const messy = L.mergeDefaults({ grade: { gain: 'oops' }, bloom: null });
ok('mergeDefaults 容忍脏类型不抛异常', !!(messy.grade && messy.bloom) && isFinite(messy.grade.contrast));

group('A9 LLM 契约');
const LLM_PATHS = ['grade.exposure', 'grade.lift', 'grade.gamma', 'grade.gain', 'grade.sat',
  'grade.temp', 'grade.contrast', 'grade.tint', 'bloom.intensity', 'bloom.threshold',
  'bloom.radius', 'edge.intensity', 'edge.threshold', 'edge.color', 'halftone.mix',
  'halftone.scale', 'halftone.angle', 'aberration.amount', 'aberration.glitch',
  'scanline.intensity', 'scanline.freq', 'grain.intensity', 'grain.scale',
  'vignette.intensity', 'vignette.softness'];
const missPaths = LLM_PATHS.filter(function (p) { return L.LLM_SYSTEM.indexOf(p) < 0; });
ok('LLM system prompt 覆盖全部 ' + LLM_PATHS.length + ' 条参数路径', missPaths.length === 0, missPaths.join(', '));
ok('LLM prompt 明确"不生成新图像"（守住 AI 只做决策的定位）',
   L.LLM_SYSTEM.indexOf('不是生成新图像') >= 0);
ok('LLM prompt 要求只输出 JSON', L.LLM_SYSTEM.indexOf('只输出一个 JSON') >= 0);
ok('导出契约完整',
   ['parseLocal', 'resolveStyle', 'resolveViaLLM', 'testLLM', 'clampRecipe', 'mergeDefaults']
     .every(function (k) { return typeof L[k] === 'function'; }));

/* ---------------- B. 管线接线 ---------------- */

group('B1 注册表完整性');
ok('注册表共 8 个 pass', R.PASS_DEFS.length === 8, String(R.PASS_DEFS.length));
const byId = {};
R.PASS_DEFS.forEach(function (d) { byId[d.id] = d; });
const missingFs = R.PASS_DEFS.filter(function (d) { return !R.FS[d.fs]; }).map(function (d) { return d.fs; });
ok('每个 pass 引用的着色器都存在', missingFs.length === 0, missingFs.join(', '));

group('B2 uniform 路径可解析');
let uBad = '';
R.PASS_DEFS.forEach(function (d) {
  (d.uniforms || []).forEach(function (u) {
    const v = R.pick(base, u[1]);
    if (v === undefined || v === null) uBad = d.id + ':' + u[1];
    else if (typeof v === 'object' && !Array.isArray(v)) uBad = d.id + ':' + u[1] + ' 指向对象';
    else if (Array.isArray(v) && v.length !== 3) uBad = d.id + ':' + u[1] + ' 数组长度 ' + v.length + ' 不是 vec3';
  });
});
ok('全部 uniform 的 recipe 路径都能取到标量或 vec3', uBad === '', uBad);

group('B3 UI 参数区间');
let pBad = '';
R.PASS_DEFS.forEach(function (d) {
  (d.params || []).forEach(function (pr) {
    const v = R.pick(base, pr.path);
    if (typeof v !== 'number') pBad = d.id + ':' + pr.path + ' 不是数值';
    else if (v < pr.min || v > pr.max) pBad = d.id + ':' + pr.path + ' 默认 ' + v + ' 越界 [' + pr.min + ',' + pr.max + ']';
  });
});
ok('全部 UI 滑杆路径可写且默认值落在区间内', pBad === '', pBad);
const allPaths = [].concat.apply([], R.PASS_DEFS.map(function (d) {
  return (d.params || []).map(function (p) { return p.path; });
}));
ok('UI 滑杆总数 ' + allPaths.length + ' 个（美术可调面）', allPaths.length >= 15, String(allPaths.length));

group('B4 pass 拓扑');
ok('分级/描边/色差/网点为 full',
   byId.grade.kind === 'full' && byId.edge.kind === 'full' &&
   byId.aberration.kind === 'full' && byId.halftone.kind === 'full');
ok('辉光三段为 aux', byId.bloomBright.kind === 'aux' && byId.bloomBlurH.kind === 'aux' && byId.bloomBlurV.kind === 'aux');
ok('辉光以半分辨率运行', byId.bloomBright.scale === 0.5 && byId.bloomBlurH.scale === 0.5 && byId.bloomBlurV.scale === 0.5);
ok('辉光链无读写冲突（bright→A, blurH A→B, blurV B→A）',
   byId.bloomBright.readFrom === 'chain' && byId.bloomBright.writeTo === 'bloomA' &&
   byId.bloomBlurH.readFrom === 'bloomA' && byId.bloomBlurH.writeTo === 'bloomB' &&
   byId.bloomBlurV.readFrom === 'bloomB' && byId.bloomBlurV.writeTo === 'bloomA');
ok('模糊方向正交',
   byId.bloomBlurH.dir[0] === 1 && byId.bloomBlurH.dir[1] === 0 &&
   byId.bloomBlurV.dir[0] === 0 && byId.bloomBlurV.dir[1] === 1);
ok('composite 是唯一 final pass',
   R.PASS_DEFS.filter(function (d) { return d.kind === 'final'; }).length === 1 && byId.composite.kind === 'final');

group('B5 autoOn 判定');
const neutral = {};
R.PASS_DEFS.forEach(function (d) { neutral[d.id] = !!d.autoOn(base); });
ok('中性配方下辉光/描边/色差/网点全部关闭',
   !neutral.bloomBright && !neutral.bloomBlurH && !neutral.bloomBlurV &&
   !neutral.edge && !neutral.aberration && !neutral.halftone, JSON.stringify(neutral));
ok('中性配方下分级与合成保持开启', neutral.grade === true && neutral.composite === true);
const onCyber = {};
R.PASS_DEFS.forEach(function (d) { onCyber[d.id] = !!d.autoOn(cyber.recipe); });
ok('赛博朋克配方会点亮辉光与色差', onCyber.bloomBright === true && onCyber.aberration === true);
ok('赛博朋克配方不会误开网点', onCyber.halftone === false);
const onComic = {};
R.PASS_DEFS.forEach(function (d) { onComic[d.id] = !!d.autoOn(comic.recipe); });
ok('漫画配方会点亮描边与网点', onComic.edge === true && onComic.halftone === true);

group('B6 GLSL 静态结构');
Object.keys(R.FS).forEach(function (k) {
  const src = R.FS[k];
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  ok('FS.' + k + ' 花括号配平且含 main()',
     open === close && open > 0 && /void\s+main\s*\(/.test(src), open + ' / ' + close);
});
ok('顶点着色器声明 location = 0', /layout\s*\(\s*location\s*=\s*0\s*\)/.test(R.VS));
ok('公共前缀以 #version 300 es 开头（必须位于首行）', R.PRELUDE.indexOf('#version 300 es') === 0);
ok('公共前缀声明 luma 与 hash 工具函数',
   /float\s+luma\s*\(/.test(R.PRELUDE) && /float\s+hash\s*\(/.test(R.PRELUDE));
ok('composite 同时采样主链与辉光图',
   byId.composite.fs === 'composite' && R.FS.composite.indexOf('uBloom') >= 0);
ok('网点着色器使用分辨率 uniform（保证不同画布下网点密度一致）',
   R.FS.halftone.indexOf('uRes') >= 0);

/* ---------------- B7. 示例图几何 ----------------
   sample.js 此前一条断言都没有，而几何缺陷恰恰只有它能挡：
   水面灯柱倒影原本用「一条纵向渐变 + 一个 fillRect」画出来，
   纵向有衰减、左右是刀切直边 —— 硬边在调色拉高对比后变成刺眼亮块，
   看起来像后处理链出了 bug。76 条断言全绿，只有截图看得见。
   这里用记录式 canvas 桩，把「画出来的形状」断言下来。 */
group('B7 示例图几何（记录式 canvas 桩）');

function loadSample() {
  const calls = [];
  function Grad(type, x0, y0, x1, y1) {
    this.type = type; this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.stops = [];
  }
  Grad.prototype.addColorStop = function (o, c) { this.stops.push({ o: o, c: c }); };

  const target = { _fs: '#000', _ss: '#000' };
  const ctx = new Proxy(target, {
    get: function (t, k) {
      if (k === 'createLinearGradient') {
        return function (x0, y0, x1, y1) {
          const g = new Grad('linear', x0, y0, x1, y1);
          t._grads = (t._grads || []).concat(g); return g;
        };
      }
      if (k === 'createRadialGradient') {
        return function () { return new Grad('radial', 0, 0, 0, 0); };
      }
      if (k === 'fillRect') {
        return function (x, y, w, h) { calls.push({ op: 'fillRect', x: x, y: y, w: w, h: h, fill: t.fillStyle }); };
      }
      if (k in t) return t[k];
      return function () {};              // 其余绘图方法一律 no-op
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });

  const canvas = { width: 0, height: 0, getContext: function () { return ctx; } };
  const sandbox = {
    module: { exports: {} }, console: console,
    document: { createElement: function () { return canvas; } }
  };
  vm.createContext(sandbox);
  /* SMOKE_SAMPLE 允许指向变异体，用来验证 B7 的断言真的能抓到旧写法
     （只是断言通过不等于断言有效；空集恒真那条就是这么被抓出来的） */
  const file = process.env.SMOKE_SAMPLE || path.join('src', 'sample.js');
  const full = path.resolve(ROOT, file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: path.basename(full) });
  return { api: sandbox.module.exports, calls: calls };
}

const SM = loadSample();
const W0 = 1200, H0 = 800;
const sample = SM.api.makeSample(0, W0, H0);
const horizon = H0 * 0.62;

ok('makeSample 返回画布并带场景名',
   sample && sample.width === W0 && sample.height === H0 && typeof sample.__name === 'string',
   sample && sample.__name);

const waterRects = SM.calls.filter(function (c) { return c.op === 'fillRect' && c.y >= horizon - 2; });
const narrow = waterRects.filter(function (c) { return c.w <= W0 * 0.15; });   // 倒影是窄条，水面底色是全宽

/* 回归本条：旧写法就是「窄条 + 纵向渐变」，正是硬边来源。
   必须同时断言 narrow 非空 —— 否则一旦录制桩失效、narrow 为空，
   这条会以「0 条硬边」恒真通过，反而掩盖了桩本身坏掉。 */
const hardEdge = narrow.filter(function (c) {
  return c.fill && c.fill.type === 'linear' && c.fill.x0 === c.fill.x1;
});
ok('水面确有窄条倒影被录到（防止本组断言空集恒真）', narrow.length > 0, narrow.length + ' 条窄条');
ok('水面没有「窄条 + 纵向渐变」的倒影（刀切直边回归）',
   narrow.length > 0 && hardEdge.length === 0, hardEdge.length + ' 条硬边窄条');

/* 新写法：倒影切成多条窄带，每条内部是横向软边渐变 */
const bands = narrow.filter(function (c) {
  return c.fill && c.fill.type === 'linear' && c.fill.x0 < c.fill.x1 && c.fill.y0 === c.fill.y1;
});
ok('倒影由多条窄带构成（不是一整块）', bands.length >= 40, bands.length + ' 条');

ok('每条倒影带都是横向渐变（左右软边）',
   bands.length > 0 && bands.every(function (c) {
     const s = c.fill.stops;
     return s.length === 3 && /,\s*0\)\s*$/.test(s[0].c) && /,\s*0\)\s*$/.test(s[2].c);
   }));

const widths = bands.map(function (c) { return c.w; });
let monoW = true;
for (let i = 1; i < widths.length; i++) if (widths[i] < widths[i - 1] - 0.01) monoW = false;
ok('倒影带宽度随深度单调变宽', bands.length >= 40 && monoW,
   '首 ' + (widths[0] || 0).toFixed(1) + ' → 末 ' + (widths[widths.length - 1] || 0).toFixed(1));

ok('倒影带沿深度无缝隙（相邻带重叠）',
   bands.length >= 2 && (function () {
     const ys = bands.slice().sort(function (a, b) { return a.y - b.y; });
     for (let i = 1; i < ys.length; i++) {
       if (ys[i].y > ys[i - 1].y + ys[i - 1].h + 0.01) return false;
     }
     return true;
   })());

/* 水面底色仍然是整块全宽渐变 —— 别为了修倒影把底色也切了 */
ok('水面底色仍为整块全宽填充',
   waterRects.some(function (c) {
     return Math.abs(c.w - W0) < 0.5 && c.fill && c.fill.type === 'linear' && c.fill.x0 === c.fill.x1;
   }));

/* ---------------- 汇总 ---------------- */
console.log('\n----------------------------------------');
console.log('  passed ' + nPass + '   failed ' + fails.length);
if (fails.length) {
  console.log('  failing:');
  fails.forEach(function (f) { console.log('    - ' + f); });
}
console.log('----------------------------------------');
process.exit(fails.length ? 1 : 0);
