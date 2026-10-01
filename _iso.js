/* ============================================================
   _iso.js — 单变量隔离驱动
   ------------------------------------------------------------
   用法：把本文件拼进单文件页面，用 hash 指定要关掉的那一项：
       file:///.../_iso.html#v=noGlitch
   页面 boot 完成后套用「该配方但关掉一个 pass/子项」的配方，
   让 app 自己的渲染循环继续跑，再用 --screenshot 截图。
   目的：定位风格化画面里那道硬边竖向色块到底由哪个环节产生。
   ============================================================ */
(function () {
  var PROMPT = '雨夜霓虹的赛博朋克城市，颗粒感重，轻微故障艺术';

  /* 每个变体：改哪些配方字段。全 null = 原配方不动 */
  var VARIANTS = {
    full:     {},
    noGlitch: { 'aberration.glitch': 0 },
    noAberr:  { 'aberration.amount': 0, 'aberration.glitch': 0 },
    noBloom:  { 'bloom.intensity': 0 },
    noGrain:  { 'grain.intensity': 0 },
    noScan:   { 'scanline.intensity': 0 },
    noHalf:   { 'halftone.mix': 0 },
    noEdge:   { 'edge.intensity': 0 },
    noVig:    { 'vignette.intensity': 0 },
    onlyGrade:{ 'aberration.amount': 0, 'aberration.glitch': 0, 'bloom.intensity': 0,
                'grain.intensity': 0, 'scanline.intensity': 0, 'halftone.mix': 0,
                'edge.intensity': 0, 'vignette.intensity': 0 }
  };

  function setPath(o, path, v) {
    var ks = path.split('.'), n = o;
    for (var i = 0; i < ks.length - 1; i++) { if (!n[ks[i]]) return; n = n[ks[i]]; }
    if (typeof n[ks[ks.length - 1]] === 'number') n[ks[ks.length - 1]] = v;
  }

  function mark(s) {
    var p = document.getElementById('__mk');
    if (!p) {
      p = document.createElement('pre');
      p.id = '__mk';
      p.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;margin:0;' +
                        'font:11px monospace;color:#0f0;background:#000;padding:2px 4px';
      document.body.appendChild(p);
    }
    p.textContent = s;
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      try {
        var S = window.__PPFX__;
        if (!S) { mark('NO_HOOK'); return; }

        var m = /v=([A-Za-z]+)/.exec(location.hash || '');
        var name = (m && VARIANTS[m[1]]) ? m[1] : 'full';
        var ops = VARIANTS[name];

        var r = JSON.parse(JSON.stringify(S.parse(PROMPT).recipe));
        Object.keys(ops).forEach(function (k) { setPath(r, k, ops[k]); });
        r.name = name;

        S.apply(r);

        var st = S.state();
        mark('VARIANT=' + name +
             '  canvas=' + JSON.stringify(st.canvas) +
             '  passes=' + st.passes.map(function (p) { return p.id + (p.enabled ? '' : 'x'); }).join(',') +
             '  turns=' + JSON.stringify(ops) +
             '  aberr=' + JSON.stringify(r.aberration || null) +
             '  grain=' + JSON.stringify(r.grain || null));
      } catch (e) {
        mark('EXC ' + (e && e.message ? e.message : e));
      }
    }, 900);
  });
})();
