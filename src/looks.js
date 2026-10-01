/* ============================================================
   looks.js — 风格解析层
   自然语言 → 结构化 StyleRecipe（后处理管线参数配方）
   两条可切换路径：
     1) 本地词典  parseLocal()    —— 零依赖、零 key、确定性
     2) 大模型    resolveViaLLM() —— OpenAI 兼容接口（可指向本机 llama.cpp）
   对外统一入口 resolveStyle()，失败自动回落。

   ---- 参数语义（务必区分，这是本文件唯一容易写错的地方）----
   锚点 patch  = 该风格的【绝对目标值】。没写的字段 = 保持基础值不变。
                 多个锚点命中时按占比加权插值，未分配的残差留在基础值上。
                 例：cyber.patch.gain = [0.90, 0.94, 1.30] 表示"增益就是这三个数"。
   修饰词 patch = 在结果之上追加的【增量】。
                 例：颗粒 +0.11 intensity 表示"再加一点颗粒"。
   ============================================================ */
(function (root) {
'use strict';

/* ---------- 基础配方：所有效果的"不变"值 ---------- */
function baseRecipe() {
  return {
    name: '原始',
    grade:      { exposure: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
                  sat: 1, temp: 0, contrast: 1, tint: [1, 1, 1] },
    bloom:      { intensity: 0, threshold: 0.70, radius: 1.0 },
    edge:       { intensity: 0, threshold: 0.25, color: [0.02, 0.02, 0.03] },
    halftone:   { mix: 0, scale: 4.0, angle: 0.35 },
    aberration: { amount: 0, glitch: 0 },
    scanline:   { intensity: 0, freq: 700 },
    grain:      { intensity: 0, scale: 1.4 },
    vignette:   { intensity: 0, softness: 0.55 }
  };
}

/* ---------- 风格锚点：字段值都是绝对目标值 ---------- */
const ANCHORS = [
  { id: 'cyber', name: '赛博朋克',
    words: ['赛博朋克', 'cyberpunk', '赛博', '霓虹', 'neon', '未来感', '科技感', '科幻', '义体', '夜城', '电子', '雨夜'],
    patch: { grade: { gain: [0.90, 0.94, 1.30], lift: [0.01, 0, 0.05], gamma: [1.06, 1.00, 0.94],
                      sat: 1.30, temp: -0.30, contrast: 1.16, tint: [0.92, 0.96, 1.10] },
             bloom: { intensity: 0.70, threshold: 0.62, radius: 1.6 },
             aberration: { amount: 1.0, glitch: 0.25 },
             scanline: { intensity: 0.16, freq: 900 },
             grain: { intensity: 0.05, scale: 1.5 },
             vignette: { intensity: 0.45, softness: 0.60 } } },

  { id: 'film', name: '胶片复古',
    words: ['胶片', '菲林', '老照片', '复古', '怀旧', '老电影', '年代感', '宝丽来'],
    patch: { grade: { gain: [1.06, 1.03, 0.98], lift: [0.04, 0.035, 0.03], gamma: [0.96, 0.97, 1.02],
                      sat: 0.72, temp: 0.22, contrast: 0.94, tint: [1.06, 1.00, 0.94] },
             grain: { intensity: 0.12, scale: 1.8 },
             vignette: { intensity: 0.30, softness: 0.75 },
             bloom: { intensity: 0.22, threshold: 0.72, radius: 1.2 } } },

  { id: 'ink', name: '水墨',
    words: ['水墨', '国画', '写意', '山水画', '宣纸', '墨色', '留白', '毛笔', '东方'],
    patch: { grade: { sat: 0.20, contrast: 1.35, exposure: 0.06, temp: 0.05,
                      gain: [1.02, 1.02, 1.01], gamma: [1.10, 1.10, 1.10] },
             edge: { intensity: 0.55, threshold: 0.10, color: [0.03, 0.03, 0.04] },
             bloom: { intensity: 0.30, threshold: 0.78, radius: 2.0 },
             grain: { intensity: 0.05, scale: 1.0 },
             vignette: { intensity: 0.25, softness: 0.70 } } },

  { id: 'comic', name: '漫画网点',
    words: ['漫画', '美漫', '动漫', '网点', '条漫', '黑白漫', '分镜风', 'comic'],
    patch: { grade: { sat: 1.55, contrast: 1.42, gamma: [1.05, 1.05, 1.05] },
             edge: { intensity: 0.70, threshold: 0.16, color: [0, 0, 0] },
             halftone: { mix: 0.55, scale: 3.4, angle: 0.40 },
             bloom: { intensity: 0.12, threshold: 0.85, radius: 1.0 },
             grain: { intensity: 0.03, scale: 1.2 } } },

  { id: 'vapor', name: '蒸汽波',
    words: ['蒸汽波', 'vaporwave', '复古未来', '80年代', '90年代', '千禧', 'y2k', '塑料感'],
    patch: { grade: { sat: 1.42, temp: -0.15, contrast: 1.05, gain: [1.10, 1.00, 1.14],
                      gamma: [0.96, 1.00, 0.96], tint: [1.10, 0.94, 1.12] },
             bloom: { intensity: 0.60, threshold: 0.68, radius: 1.8 },
             aberration: { amount: 1.4, glitch: 0.10 },
             scanline: { intensity: 0.12, freq: 560 },
             grain: { intensity: 0.06, scale: 1.2 },
             vignette: { intensity: 0.35, softness: 0.60 } } },

  { id: 'horror', name: '恐怖压抑',
    words: ['恐怖', '惊悚', '阴森', '诡异', '压抑', '恐怖片'],
    patch: { grade: { sat: 0.45, exposure: -0.18, contrast: 1.30, temp: -0.20,
                      gain: [0.95, 1.02, 0.98], tint: [0.96, 1.00, 0.92] },
             vignette: { intensity: 0.85, softness: 0.35 },
             grain: { intensity: 0.16, scale: 2.2 },
             bloom: { intensity: 0.15, threshold: 0.80, radius: 1.2 },
             edge: { intensity: 0.25, threshold: 0.22 } } },

  { id: 'fresh', name: '清新日系',
    words: ['清新', '日系', '治愈', '通透', '小清新', '晨光', '空气感'],
    patch: { grade: { exposure: 0.16, sat: 0.90, contrast: 0.86, temp: 0.10,
                      lift: [0.05, 0.05, 0.045], gamma: [0.94, 0.94, 0.94] },
             bloom: { intensity: 0.35, threshold: 0.75, radius: 2.2 },
             vignette: { intensity: 0.08, softness: 0.80 },
             grain: { intensity: 0.02, scale: 1.0 } } },

  { id: 'glitch', name: '故障艺术',
    words: ['故障艺术', '故障', 'glitch', '崩坏', '错位', '撕裂', '信号失真'],
    patch: { aberration: { amount: 2.2, glitch: 0.75 },
             scanline: { intensity: 0.28, freq: 1100 },
             grain: { intensity: 0.10, scale: 2.6 },
             grade: { sat: 1.10, contrast: 1.14, gain: [1.04, 0.98, 1.06] },
             bloom: { intensity: 0.35, threshold: 0.70, radius: 1.4 } } },

  { id: 'golden', name: '黄昏金色',
    words: ['黄昏', '落日', '夕阳', '暖阳', '黄金时刻', '午后', '金色', 'golden'],
    patch: { grade: { temp: 0.55, exposure: 0.08, sat: 1.22, contrast: 1.10, gain: [1.14, 1.05, 0.92] },
             bloom: { intensity: 0.65, threshold: 0.66, radius: 1.9 },
             vignette: { intensity: 0.30, softness: 0.65 },
             grain: { intensity: 0.03, scale: 1.2 } } },

  { id: 'cold', name: '冷冽寒冬',
    words: ['雪夜', '冷冽', '寒冬', '冰雪', '肃杀', '冷峻', '北国'],
    patch: { grade: { temp: -0.55, exposure: 0.05, sat: 0.75, contrast: 1.14, gain: [0.98, 1.03, 1.14] },
             bloom: { intensity: 0.40, threshold: 0.74, radius: 1.6 },
             grain: { intensity: 0.05, scale: 1.6 },
             vignette: { intensity: 0.30, softness: 0.60 } } },

  { id: 'mono', name: '黑白极简',
    words: ['黑白', '灰阶', '单色', '极简', '性冷淡', '无彩色', 'mono'],
    patch: { grade: { sat: 0.05, contrast: 1.20 },
             grain: { intensity: 0.07, scale: 1.2 },
             vignette: { intensity: 0.28, softness: 0.65 },
             bloom: { intensity: 0.20, threshold: 0.80, radius: 1.4 } } },

  { id: 'dream', name: '梦核柔光',
    words: ['梦核', 'dreamcore', '柔光', '朦胧', '薄雾', '梦幻', '仙气'],
    patch: { bloom: { intensity: 0.90, threshold: 0.58, radius: 2.8 },
             grade: { exposure: 0.10, sat: 0.85, contrast: 0.82, lift: [0.06, 0.06, 0.07] },
             grain: { intensity: 0.03, scale: 1.0 },
             vignette: { intensity: 0.12, softness: 0.85 } } },

  { id: 'oil', name: '油画厚涂',
    words: ['油画', '厚涂', '笔触', '印象派', '颜料', '绘画'],
    patch: { grade: { sat: 1.35, contrast: 1.18, gamma: [1.02, 1.02, 1.02] },
             edge: { intensity: 0.35, threshold: 0.12 },
             halftone: { mix: 0.18, scale: 6.5, angle: 0.20 },
             bloom: { intensity: 0.25, threshold: 0.76, radius: 1.4 },
             grain: { intensity: 0.05, scale: 2.0 } } },

  { id: 'cinema', name: '电影感',
    words: ['电影感', '电影', '高级灰', '青橙', '大片感', '银幕'],
    patch: { grade: { gain: [1.06, 1.02, 0.94], lift: [0, 0.015, 0.045], gamma: [1.00, 1.00, 1.02],
                      sat: 1.10, temp: 0.10, contrast: 1.26, tint: [1.04, 1.00, 0.96] },
             bloom: { intensity: 0.30, threshold: 0.74, radius: 1.5 },
             vignette: { intensity: 0.35, softness: 0.60 },
             grain: { intensity: 0.04, scale: 1.3 } } }
];

/* ---------- 修饰词：用户直接点名的效果，在锚点结果之上追加增量 ---------- */
const MODIFIERS = [
  { id: 'grainer', label: '颗粒', words: ['颗粒感', '颗粒', '噪点', '噪波', 'grain'], patch: { grain: { intensity: 0.11 } } },
  { id: 'vig',     label: '暗角', words: ['暗角', '晕影', '四角压暗', 'vignette'],    patch: { vignette: { intensity: 0.32 } } },
  { id: 'ca',      label: '色差', words: ['色差', '色散', '紫边', 'chromatic'],      patch: { aberration: { amount: 1.0 } } },
  { id: 'scan',    label: '扫描线', words: ['扫描线', '显像管', '老电视', 'crt'],     patch: { scanline: { intensity: 0.24 } } },
  { id: 'glow',    label: '辉光', words: ['发光', '光晕', '辉光', '泛光', 'glow'],     patch: { bloom: { intensity: 0.42 } } },
  { id: 'line',    label: '描边', words: ['描边', '轮廓线', '勾线', '线稿'],           patch: { edge: { intensity: 0.50 } } },
  { id: 'halft',   label: '网点', words: ['网点', '半调', '印刷质感', 'halftone'],    patch: { halftone: { mix: 0.35 } } },
  { id: 'jit',     label: '抖动', words: ['抖动', '信号干扰', '噪波干扰'],            patch: { aberration: { glitch: 0.35 } } },
  { id: 'hict',    label: '高对比', words: ['高对比', '强对比', '硬朗'],              patch: { grade: { contrast: 0.28 } } },
  { id: 'loct',    label: '低对比', words: ['低对比', '灰雾', '雾感', '柔和对比'],     patch: { grade: { contrast: -0.24 } } },
  { id: 'hisa',    label: '高饱和', words: ['高饱和', '浓郁', '艳丽', '鲜艳'],        patch: { grade: { sat: 0.42 } } },
  { id: 'losa',    label: '低饱和', words: ['低饱和', '褪色', '寡淡', '素雅'],        patch: { grade: { sat: -0.40 } } },
  { id: 'warm',    label: '偏暖', words: ['暖色', '暖调', '偏暖', '偏黄'],            patch: { grade: { temp: 0.40 } } },
  { id: 'cool',    label: '偏冷', words: ['冷色', '冷调', '偏冷', '偏蓝'],            patch: { grade: { temp: -0.40 } } },
  { id: 'up',      label: '提亮', words: ['过曝', '高调', '提亮'],                    patch: { grade: { exposure: 0.20 } } },
  { id: 'down',    label: '压暗', words: ['压暗', '低调', '昏暗', '暗沉'],            patch: { grade: { exposure: -0.20 } } }
];

/* ---------- 程度词 ---------- */
const EMPH_UP   = ['非常', '特别', '超级', '极其', '十分', '格外', '相当', '极', '超', '很'];
const EMPH_DOWN = ['稍微', '微微', '轻微', '略微', '一点点', '些许', '稍', '略'];

/* ---------- 数值范围（钳制只作兜底：正常路径不该碰到它） ---------- */
const RANGES = {
  'grade.exposure': [-0.60, 0.60], 'grade.sat': [0, 2.40], 'grade.temp': [-1, 1],
  'grade.contrast': [0.40, 2.20], 'grade.gamma': [0.50, 2.00], 'grade.gain': [0.20, 2.00],
  'grade.lift': [-0.25, 0.35], 'grade.tint': [0.60, 1.40],
  'bloom.intensity': [0, 2.50], 'bloom.threshold': [0.20, 0.98], 'bloom.radius': [0.40, 4.00],
  'edge.intensity': [0, 1.50], 'edge.threshold': [0.02, 0.70], 'edge.color': [0, 1],
  'halftone.mix': [0, 1], 'halftone.scale': [2, 16], 'halftone.angle': [0, 3.14],
  'aberration.amount': [0, 6], 'aberration.glitch': [0, 1],
  'scanline.intensity': [0, 0.80], 'scanline.freq': [150, 2200],
  'grain.intensity': [0, 0.40], 'grain.scale': [0.60, 6.00],
  'vignette.intensity': [0, 1.30], 'vignette.softness': [0.08, 1.00]
};

/* ============================================================
   匹配：长词优先 + 区间互斥，避免「赛博朋克」同时命中「赛博」
   ============================================================ */
function scanMatches(text, rules) {
  const t = String(text || '').toLowerCase();
  const cands = [];
  rules.forEach(function (r) {
    r.words.forEach(function (w) { cands.push({ id: r.id, w: w.toLowerCase() }); });
  });
  cands.sort(function (a, b) { return b.w.length - a.w.length; });

  const used = new Array(t.length).fill(false);
  const hits = [];
  for (let c = 0; c < cands.length; c++) {
    const cand = cands[c];
    let i = 0;
    while (i <= t.length - cand.w.length) {
      const idx = t.indexOf(cand.w, i);
      if (idx < 0) break;
      let free = true;
      for (let k = idx; k < idx + cand.w.length; k++) { if (used[k]) { free = false; break; } }
      if (free) {
        for (let k = idx; k < idx + cand.w.length; k++) used[k] = true;
        hits.push({ id: cand.id, word: cand.w, at: idx, len: cand.w.length });
        i = idx + cand.w.length;
      } else { i = idx + 1; }
    }
  }
  return hits;
}

/* 在关键词前后 4 字窗口内找程度词。
   关键点：程度词不能落在任何已命中关键词的内部 —— 否则「极简」里的「极」、
   「超现实」里的「超」都会被当成程度词，把权重顶到 1 以上。
   mask 是所有关键词的字位掩码。 */
function ewordFound(t, hit, mask, list) {
  const from = Math.max(0, hit.at - 4);
  const to = Math.min(t.length, hit.at + hit.len + 2);
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    let at = t.indexOf(w, from);
    while (at >= 0 && at + w.length <= to) {
      let free = true;
      for (let k = at; k < at + w.length; k++) {
        if (mask[k] || (k >= hit.at && k < hit.at + hit.len)) { free = false; break; }
      }
      if (free) return true;
      at = t.indexOf(w, at + 1);
    }
  }
  return false;
}

function emphasisAt(text, hit, mask) {
  const t = String(text || '').toLowerCase();
  const m = mask || [];
  if (ewordFound(t, hit, m, EMPH_DOWN)) return 0.55;
  if (ewordFound(t, hit, m, EMPH_UP)) return 1.45;
  const after = t.slice(hit.at + hit.len, hit.at + hit.len + 2);
  if (/[重强烈浓明显十足]/.test(after)) return 1.35;
  if (/[淡弱轻]/.test(after)) return 0.60;
  return 1;
}

/* 按路径深取值，取不到返回 undefined */
function deepGet(obj, path) {
  const parts = String(path).split('.');
  let v = obj;
  for (let i = 0; i < parts.length; i++) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = v[parts[i]];
  }
  return v;
}

/* ============================================================
   锚点融合：out = base × 残差 + Σ(占比 × 该锚点目标值)
   某个锚点没写这个字段 → 它的目标值就是 base（等于不改变）
   未分配的残差留在 base 上，等价于"混合得越弱越接近原始"
   占比之和若被程度词顶到 1 以上，先归一化，避免过驱动
   ============================================================ */
function blendAnchors(entries) {
  const list = entries.slice();
  let sum = 0;
  list.forEach(function (e) { sum += e.k; });
  if (sum > 1) {
    list.forEach(function (e) { e.k = e.k / sum; });
    sum = 1;
  }
  const residual = Math.max(0, 1 - sum);
  const base = baseRecipe();
  const out = baseRecipe();

  (function walk(node, baseNode, prefix) {
    Object.keys(node).forEach(function (key) {
      if (key === 'name') return;
      const path = prefix ? prefix + '.' + key : key;
      const nv = node[key];
      const bv = baseNode ? baseNode[key] : undefined;

      if (typeof nv === 'number') {
        const b = (typeof bv === 'number') ? bv : 0;
        let acc = b * residual;
        list.forEach(function (e) {
          const v = deepGet(e.patch, path);
          acc += e.k * ((typeof v === 'number') ? v : b);
        });
        node[key] = acc;
      } else if (Array.isArray(nv)) {
        const b = Array.isArray(bv) ? bv : nv.map(function () { return 0; });
        for (let i = 0; i < nv.length; i++) {
          const bi = (typeof b[i] === 'number') ? b[i] : 0;
          let acc = bi * residual;
          list.forEach(function (e) {
            const v = deepGet(e.patch, path);
            const vi = (Array.isArray(v) && typeof v[i] === 'number') ? v[i] : bi;
            acc += e.k * vi;
          });
          nv[i] = acc;
        }
      } else if (nv && typeof nv === 'object') {
        walk(nv, bv, path);
      }
    });
  })(out, base, '');

  return out;
}

/* 修饰词：在结果之上按系数 k 累加增量 */
function addScaled(target, patch, k) {
  if (!patch || !k) return;
  for (const group in patch) {
    const src = patch[group];
    if (typeof src === 'number') { target[group] = (target[group] || 0) + src * k; continue; }
    if (Array.isArray(src)) {
      if (!Array.isArray(target[group])) target[group] = src.map(function () { return 0; });
      for (let i = 0; i < src.length; i++) target[group][i] += src[i] * k;
      continue;
    }
    if (typeof src !== 'object' || src === null) continue;
    if (typeof target[group] !== 'object' || target[group] === null) target[group] = {};
    for (const key in src) {
      const v = src[key];
      if (typeof v === 'number') { target[group][key] = (target[group][key] || 0) + v * k; }
      else if (Array.isArray(v)) {
        if (!Array.isArray(target[group][key])) target[group][key] = v.map(function () { return 0; });
        for (let i = 0; i < v.length; i++) target[group][key][i] += v[i] * k;
      }
    }
  }
}

/* ============================================================
   钳制：兜底用。正常路径下所有锚点 + 修饰词组合都应天然落在区间内
   ============================================================ */
function clampRecipe(r) {
  (function walk(node, prefix) {
    Object.keys(node).forEach(function (key) {
      const path = prefix ? prefix + '.' + key : key;
      const v = node[key];
      if (typeof v === 'number') {
        const rg = RANGES[path];
        if (rg) node[key] = Math.min(rg[1], Math.max(rg[0], v));
      } else if (Array.isArray(v)) {
        const rg = RANGES[path];
        if (rg) for (let i = 0; i < v.length; i++) v[i] = Math.min(rg[1], Math.max(rg[0], v[i]));
      } else if (v && typeof v === 'object') {
        walk(v, path);
      }
    });
  })(r, '');
  return r;
}

/* 用默认值补齐 LLM 可能漏掉的字段 */
function mergeDefaults(obj) {
  const base = baseRecipe();
  const merge = function (dst, src) {
    if (!src || typeof src !== 'object') return dst;
    for (const key in src) {
      const sv = src[key], dv = dst[key];
      if (typeof sv === 'number') dst[key] = sv;
      else if (Array.isArray(sv) && Array.isArray(dv)) {
        for (let i = 0; i < dv.length; i++) if (typeof sv[i] === 'number') dv[i] = sv[i];
      } else if (sv && typeof sv === 'object' && dv && typeof dv === 'object') merge(dv, sv);
    }
    return dst;
  };
  merge(base, obj);
  if (obj && typeof obj.name === 'string') base.name = obj.name.slice(0, 12);
  return base;
}

/* ============================================================
   本地词典解析
   ============================================================ */
function parseLocal(text) {
  const all = ANCHORS.map(function (a) { return { id: a.id, words: a.words }; })
    .concat(MODIFIERS.map(function (m) { return { id: 'MOD:' + m.id, words: m.words }; }));
  const hits = scanMatches(text, all);

  // 锚点：w = 命中词长度和（相关度占比）；e = 加权平均程度倍数
  const acc = {};
  const modHits = [];
  // 关键词字位掩码：程度词不能落在关键词内部（"极简"里的"极"不是程度词）
  const mask = new Array(String(text || '').length).fill(false);
  hits.forEach(function (h) {
    for (let i = h.at; i < h.at + h.len; i++) mask[i] = true;
  });

  hits.forEach(function (h) {
    if (h.id.indexOf('MOD:') === 0) {
      modHits.push({ id: h.id.slice(4), word: h.word, scale: emphasisAt(text, h, mask) });
    } else {
      const e = emphasisAt(text, h, mask);
      if (!acc[h.id]) acc[h.id] = { w: 0, ew: 0 };
      acc[h.id].w += h.len;
      acc[h.id].ew += h.len * e;
    }
  });

  const entries = Object.keys(acc).map(function (id) {
    return { id: id, w: acc[id].w, e: acc[id].ew / acc[id].w };
  }).sort(function (a, b) { return b.w - a.w; });

  const total = entries.reduce(function (s, x) { return s + x.w; }, 0);
  const metaHits = [];
  let recipe;

  if (total > 0) {
    const blend = entries.map(function (x) {
      const def = ANCHORS.find(function (a) { return a.id === x.id; });
      const share = x.w / total;
      metaHits.push({ name: def.name, weight: +share.toFixed(2) });
      return { patch: def.patch, k: share * x.e };
    });
    recipe = blendAnchors(blend);
    recipe.name = metaHits.slice(0, 2).map(function (h) { return h.name; }).join(' · ');
  } else {
    recipe = baseRecipe();
  }

  // 修饰词在锚点结果之上追加（同名最多计 3 次，防止刷词爆表）
  const modCount = {};
  const metaMods = [];
  modHits.forEach(function (m) {
    modCount[m.id] = (modCount[m.id] || 0) + 1;
    if (modCount[m.id] > 3) return;
    const def = MODIFIERS.find(function (x) { return x.id === m.id; });
    addScaled(recipe, def.patch, m.scale);
  });
  Object.keys(modCount).forEach(function (id) {
    const def = MODIFIERS.find(function (x) { return x.id === id; });
    metaMods.push({ label: def.label, times: modCount[id] });
  });

  if (!metaHits.length && metaMods.length) recipe.name = '局部调整';
  clampRecipe(recipe);

  return {
    recipe: recipe,
    meta: { engine: 'local', hits: metaHits, mods: metaMods, words: hits.length }
  };
}

/* ============================================================
   LLM 路径：OpenAI 兼容 /chat/completions
   决策目标与本地词典完全一致 —— 只输出参数，不生成图像
   ============================================================ */
const LLM_SYSTEM = [
  '你是实时渲染后处理管线的参数决策器。用户用一句中文描述想要的画面风格。',
  '你的输出会直接驱动一个 GPU 后处理管线，意味着"把画面调成这个样子"，而不是生成新图像。',
  '只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。所有字段都是【绝对目标值】且必填。',
  '从未提及的维度一律保持在"不变"值上（见下方括号里的中和值）。',
  '字段与区间：',
  'name: string(≤6字)',
  'grade.exposure: -0.6~0.6 (0=不变)',
  'grade.lift: [r,g,b] 每项 -0.25~0.35 (0/0/0=不变, 抬暗部)',
  'grade.gamma: [r,g,b] 每项 0.5~2.0 (1/1/1=不变, 中间调)',
  'grade.gain: [r,g,b] 每项 0.2~2.0 (1/1/1=不变, 高光增益)',
  'grade.sat: 0~2.4 (1=不变)',
  'grade.temp: -1~1 (-1冷/蓝, 1暖/黄, 0=不变)',
  'grade.contrast: 0.4~2.2 (1=不变)',
  'grade.tint: [r,g,b] 每项 0.6~1.4 (1/1/1=不变)',
  'bloom.intensity: 0~2.5 (0=关闭), bloom.threshold: 0.2~0.98, bloom.radius: 0.4~4',
  'edge.intensity: 0~1.5 (0=关闭), edge.threshold: 0.02~0.7, edge.color: [r,g,b] 0~1',
  'halftone.mix: 0~1 (0=关闭), halftone.scale: 2~16, halftone.angle: 0~3.14',
  'aberration.amount: 0~6 (0=关闭), aberration.glitch: 0~1',
  'scanline.intensity: 0~0.8 (0=关闭), scanline.freq: 150~2200',
  'grain.intensity: 0~0.4 (0=关闭), grain.scale: 颗粒直径像素 0.6~6',
  'vignette.intensity: 0~1.3 (0=关闭), vignette.softness: 0.08~1',
  '输出示例（仅示意格式与量级，数值请按语义重新决定）：',
  '{"name":"赛博朋克","grade":{"exposure":0,"lift":[0.01,0,0.05],"gamma":[1.06,1,0.94],"gain":[0.9,0.94,1.3],"sat":1.3,"temp":-0.3,"contrast":1.16,"tint":[0.92,0.96,1.1]},"bloom":{"intensity":0.7,"threshold":0.62,"radius":1.6},"edge":{"intensity":0,"threshold":0.25,"color":[0.02,0.02,0.03]},"halftone":{"mix":0,"scale":4,"angle":0.35},"aberration":{"amount":1,"glitch":0.25},"scanline":{"intensity":0.16,"freq":900},"grain":{"intensity":0.05,"scale":1.5},"vignette":{"intensity":0.45,"softness":0.6}}'
].join('\n');

function stripFence(s) {
  return String(s || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
}

async function postChat(base, payload) {
  const res = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message &&
          data.choices[0].message.content) || '';
}

async function resolveViaLLM(text, cfg) {
  const base = cfg.base || 'http://127.0.0.1:8080/v1';
  const model = cfg.model || 'local-model';
  const payload = {
    model: model,
    temperature: 0.2,
    messages: [{ role: 'system', content: LLM_SYSTEM }, { role: 'user', content: text }]
  };
  let raw;
  try {
    raw = await postChat(base, Object.assign({ response_format: { type: 'json_object' } }, payload));
  } catch (e) {
    // 部分服务端不支持 response_format，降级重试一次
    raw = await postChat(base, payload);
  }
  const obj = JSON.parse(stripFence(raw));
  const recipe = clampRecipe(mergeDefaults(obj));
  return {
    recipe: recipe,
    meta: { engine: 'llm', model: model, hits: [], mods: [], words: 0,
            note: 'LLM 直接输出参数配方' }
  };
}

async function testLLM(cfg) {
  const base = (cfg.base || '').replace(/\/+$/, '');
  const res = await fetch(base + '/models', { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return ((data && data.data) || []).map(function (m) { return m.id; });
}

/* ============================================================
   统一入口：引擎可切换，LLM 失败自动回落到本地词典
   ============================================================ */
async function resolveStyle(text, engine, cfg) {
  if (engine === 'llm') {
    try { return await resolveViaLLM(text, cfg || {}); }
    catch (e) {
      const r = parseLocal(text);
      r.meta.note = 'LLM 不可用（' + e.message + '），已回落本地词典';
      return r;
    }
  }
  return parseLocal(text);
}

const API = {
  baseRecipe: baseRecipe, ANCHORS: ANCHORS, MODIFIERS: MODIFIERS, RANGES: RANGES,
  scanMatches: scanMatches, emphasisAt: emphasisAt, addScaled: addScaled,
  blendAnchors: blendAnchors, deepGet: deepGet,
  clampRecipe: clampRecipe, mergeDefaults: mergeDefaults,
  parseLocal: parseLocal, resolveViaLLM: resolveViaLLM, resolveStyle: resolveStyle,
  testLLM: testLLM, LLM_SYSTEM: LLM_SYSTEM
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.PPFX = API;
})(typeof window !== 'undefined' ? window : globalThis);
