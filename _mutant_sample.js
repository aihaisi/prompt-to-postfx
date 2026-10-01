/* ============================================================
   sample.js — 程序化示例图
   不依赖任何外部素材（无 CDN、无图片文件），双击即可出画面。
   三张内置场景分别覆盖不同视觉特征：
     0 黄昏城市水岸 —— 强光源 / 高频窗户细节 / 大面积渐变
     1 雾中山水     —— 低饱和 / 层次 / 大留白（适合水墨类）
     2 抽象构成     —— 高饱和色块 / 硬边（适合网点与故障类）
   ============================================================ */
(function (root) {
'use strict';

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---- 场景 0：黄昏城市水岸 ---- */
function sceneCity(ctx, w, h, rnd) {
  const horizon = h * 0.62;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0.00, '#0a0f2e');
  sky.addColorStop(0.40, '#3a2a63');
  sky.addColorStop(0.70, '#9d5468');
  sky.addColorStop(0.88, '#dd8b52');
  sky.addColorStop(1.00, '#f7c879');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  for (let i = 0; i < 16; i++) {
    const cy = rnd() * horizon * 0.8;
    ctx.fillStyle = 'rgba(255,214,178,' + (0.04 + rnd() * 0.14).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(rnd() * w, cy, w * (0.10 + rnd() * 0.34), h * (0.006 + rnd() * 0.020), 0, 0, 7);
    ctx.fill();
  }

  const sx = w * 0.68, sy = horizon - h * 0.055, sr = h * 0.070;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 7);
  glow.addColorStop(0.00, 'rgba(255,232,186,0.95)');
  glow.addColorStop(0.10, 'rgba(255,196,116,0.60)');
  glow.addColorStop(0.40, 'rgba(255,142,84,0.16)');
  glow.addColorStop(1.00, 'rgba(255,120,60,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(sx, sy, sr * 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff4d4';
  ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();

  const ridge = [[30, 26, 58], [24, 21, 50], [18, 16, 42]];
  for (let L = 0; L < 3; L++) {
    const baseY = horizon - h * 0.015 + L * h * 0.014;
    const amp = h * (0.055 + L * 0.030);
    const c = ridge[L];
    ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.94)';
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= w; x += w / 56) {
      const y = baseY - (Math.sin(x * 0.0045 + L * 2.2) * 0.5 + 0.5) * amp - amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, horizon + h); ctx.lineTo(0, horizon + h); ctx.closePath(); ctx.fill();
  }

  let x = -w * 0.02;
  while (x < w) {
    const bw = w * (0.020 + rnd() * 0.052);
    const bh = h * (0.030 + Math.pow(rnd(), 2.0) * 0.225);
    const y = horizon - bh;
    ctx.fillStyle = '#080a16';
    ctx.fillRect(x, y, bw, bh);
    const cols = Math.max(2, Math.floor(bw / (w * 0.0105)));
    const rows = Math.max(3, Math.floor(bh / (h * 0.021)));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (rnd() > 0.44) continue;
        const wx = x + (i + 0.5) * (bw / cols) - w * 0.0022;
        const wy = y + (j + 0.5) * (bh / rows) - h * 0.0040;
        ctx.fillStyle = rnd() > 0.74
          ? 'rgba(150,214,255,0.95)'
          : 'rgba(255,206,132,' + (0.45 + rnd() * 0.55).toFixed(2) + ')';
        ctx.fillRect(wx, wy, w * 0.0044, h * 0.0075);
      }
    }
    x += bw + w * 0.0022;
  }

  const water = ctx.createLinearGradient(0, horizon, 0, h);
  water.addColorStop(0.00, '#7d4c54');
  water.addColorStop(0.22, '#3a2a4a');
  water.addColorStop(1.00, '#0b0d1c');
  ctx.fillStyle = water;
  ctx.fillRect(0, horizon, w, h - horizon);

  for (let i = 0; i < 320; i++) {
    const t = Math.pow(rnd(), 1.6);
    const ry = horizon + t * (h - horizon);
    const len = w * (0.008 + rnd() * 0.085) * (1 - t * 0.6);
    const a = (0.05 + rnd() * 0.22) * (1 - t * 0.85);
    ctx.fillStyle = rnd() > 0.6
      ? 'rgba(255,192,124,' + a.toFixed(3) + ')'
      : 'rgba(255,124,84,' + (a * 0.7).toFixed(3) + ')';
    ctx.fillRect(rnd() * w, ry, len, Math.max(1, h * 0.0022));
  }

  const rg = ctx.createLinearGradient(0, horizon, 0, h);
  rg.addColorStop(0.00, 'rgba(255,214,156,0.50)');
  rg.addColorStop(1.00, 'rgba(255,150,90,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(sx - w * 0.022, horizon, w * 0.044, h - horizon);

  ctx.fillStyle = 'rgba(255,232,196,0.45)';
  ctx.fillRect(0, horizon - 1.5, w, 3);
}

/* ---- 场景 1：雾中山水 ---- */
function sceneInk(ctx, w, h, rnd) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, '#f0f3f0');
  g.addColorStop(0.55, '#dbe1dc');
  g.addColorStop(1.00, '#e9ece8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(w * 0.76, h * 0.15, h * 0.058, 0, 7); ctx.fill();

  const layers = 6, waterY = h * 0.80;
  for (let L = 0; L < layers; L++) {
    const t = L / (layers - 1);
    const baseY = h * (0.30 + t * 0.50);
    const amp = h * (0.185 - t * 0.115);
    const alpha = 0.16 + t * 0.52;
    const v = Math.round(58 + 42 * t);
    ctx.fillStyle = 'rgba(' + v + ',' + (v + 8) + ',' + (v + 8) + ',' + alpha.toFixed(2) + ')';

    ctx.beginPath();
    ctx.moveTo(-10, waterY);
    for (let x = -10; x <= w + 10; x += w / 72) {
      const y = baseY
        - (Math.sin(x * 0.0040 + L * 3.1) * 0.5 + 0.5) * amp
        - Math.sin(x * 0.0105 + L * 1.7) * amp * 0.20;
      ctx.lineTo(x, Math.min(y, waterY));
    }
    ctx.lineTo(w + 10, waterY); ctx.closePath(); ctx.fill();

    const mg = ctx.createLinearGradient(0, baseY - amp * 0.20, 0, waterY);
    mg.addColorStop(0.00, 'rgba(246,249,247,0)');
    mg.addColorStop(0.40, 'rgba(246,249,247,' + (0.48 - t * 0.34).toFixed(2) + ')');
    mg.addColorStop(1.00, 'rgba(246,249,247,0.10)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, baseY - amp * 0.20, w, waterY - baseY + amp * 0.20);
  }

  const wg = ctx.createLinearGradient(0, waterY, 0, h);
  wg.addColorStop(0.00, '#c9cfca');
  wg.addColorStop(1.00, '#eef1ee');
  ctx.fillStyle = wg;
  ctx.fillRect(0, waterY, w, h - waterY);

  for (let i = 0; i < 130; i++) {
    const ry = waterY + Math.pow(rnd(), 1.4) * (h - waterY);
    const a = 0.10 + rnd() * 0.24;
    ctx.fillStyle = 'rgba(120,132,128,' + a.toFixed(3) + ')';
    ctx.fillRect(rnd() * w, ry, w * (0.02 + rnd() * 0.12), Math.max(1, h * 0.0018));
  }
  ctx.fillStyle = 'rgba(150,160,156,0.55)';
  ctx.fillRect(0, waterY - 1, w, 2);
}

/* ---- 场景 2：抽象构成 ---- */
function sceneAbstract(ctx, w, h, rnd) {
  ctx.fillStyle = '#101219';
  ctx.fillRect(0, 0, w, h);

  const cols = ['#e94f37', '#3ec6c6', '#f6c75a', '#8e6bd8', '#f4f4f4', '#1f6feb', '#39d98a'];
  for (let i = 0; i < 30; i++) {
    ctx.save();
    ctx.translate(rnd() * w, rnd() * h);
    ctx.rotate(rnd() * Math.PI);
    ctx.globalAlpha = 0.22 + rnd() * 0.62;
    ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
    const r = Math.min(w, h) * (0.025 + rnd() * 0.155);
    if (rnd() > 0.5) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); }
    else { ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4); }
    ctx.restore();
  }

  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, w / 1400);
  for (let x = 0; x < w; x += w / 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += h / 17) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2, w / 500);
  ctx.strokeRect(w * 0.06, h * 0.10, w * 0.30, h * 0.34);
  ctx.beginPath();
  ctx.moveTo(w * 0.55, h * 0.86);
  ctx.bezierCurveTo(w * 0.68, h * 0.44, w * 0.86, h * 0.72, w * 0.95, h * 0.30);
  ctx.stroke();
}

const SCENES = [
  { name: '黄昏城市水岸', draw: sceneCity },
  { name: '雾中山水',     draw: sceneInk },
  { name: '抽象构成',     draw: sceneAbstract }
];

function makeSample(kind, w, h) {
  const idx = ((kind % SCENES.length) + SCENES.length) % SCENES.length;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  const ctx = c.getContext('2d');
  const rnd = mulberry32(20261001 + idx * 7919);
  SCENES[idx].draw(ctx, c.width, c.height, rnd);
  c.__name = SCENES[idx].name;
  return c;
}

const API = { makeSample: makeSample, SCENES: SCENES };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.PPFX_SAMPLE = API;
})(typeof window !== 'undefined' ? window : globalThis);
