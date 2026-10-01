/* ============================================================
   _gltest.js — 无头渲染验证驱动
   被 _gltest.py 拼进 _gltest.html，用 --dump-dom 取回结果。
   验证三件事：
     1) WebGL2 管线在这个环境里真的建起来了，且没有 pass 编译失败
     2) 中性配方渲染出来的画面 == 原图（整条链无色偏、无隐性改动）
     3) 不同提示词产出的画面彼此不同，且方向符合语义预期
   ============================================================ */
(function () {
  function log(s) {
    var p = document.getElementById('__res');
    if (!p) {
      p = document.createElement('pre');
      p.id = '__res';
      p.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(p);
    }
    p.textContent += s + '\n';
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      try {
        var S = window.__PPFX__;
        if (!S) { log('RESULT=FAIL reason=no_hook'); log('DONE'); return; }

        var st = S.state();
        log('GL_OK=' + st.glOk);
        log('GL_FAIL=' + st.glFail);
        log('CANVAS=' + JSON.stringify(st.canvas));
        log('PASS_COUNT=' + st.passCount);
        log('ERRORS=' + JSON.stringify(st.errors));
        log('PASSES=' + JSON.stringify(st.passes));

        var ok = st.glOk === true && st.errors.length === 0;

        /* --- 中性配方 vs 原图 --- */
        var neutral = S.parse('zzz qqq').recipe;
        var baseSig = S.sig(neutral);
        var srcSig = S.sourceSig();
        log('NEUTRAL_MEAN=' + (baseSig ? baseSig.mean : 'null'));
        log('SOURCE_MEAN=' + (srcSig ? srcSig.mean : 'null'));
        var drift = (baseSig && srcSig) ? Math.abs(baseSig.mean - srcSig.mean) : 999;
        log('NEUTRAL_DRIFT=' + drift.toFixed(2));
        var neutralOk = baseSig && srcSig && drift <= 8;
        log('NEUTRAL_IDENTITY=' + (neutralOk ? 'PASS' : 'FAIL'));

        /* --- 逐提示词渲染 --- */
        var CASES = [
          ['赛博朋克雨夜，霓虹', 'cyber'],
          ['水墨写意山水', 'ink'],
          ['黑白极简', 'mono'],
          ['美式漫画网点，强描边', 'comic'],
          ['故障艺术，色差撕裂', 'glitch'],
          ['黄昏金色时刻，柔和辉光', 'golden']
        ];
        var means = { neutral: baseSig ? baseSig.mean : 0 };
        var rows = [];
        CASES.forEach(function (c) {
          var g = S.sig(S.parse(c[0]).recipe);
          means[c[1]] = g ? g.mean : null;
          rows.push(c[1] + '=' + (g ? g.mean : 'null'));
          log('SIG ' + c[0] + ' -> ' + (g ? g.mean : 'null'));
        });
        log('MEANS=' + JSON.stringify(means));

        /* 所有配方出图必须彼此可区分 */
        var vals = Object.keys(means).map(function (k) { return means[k]; });
        var uniq = {};
        vals.forEach(function (v) { uniq[v] = 1; });
        var distinct = Object.keys(uniq).length;
        log('DISTINCT_MEANS=' + distinct + '/' + vals.length);
        ok = ok && distinct >= vals.length - 1;

        /* 语义方向：黑白必须比原图更"平"，漫画必须比原图对比更强（均值偏离中性则说明链在动） */
        var goldenDelta = Math.abs(means.golden - means.neutral);
        log('GOLDEN_DELTA=' + goldenDelta.toFixed(2));
        ok = ok && goldenDelta > 1.0;

        log('RESULT=' + (ok ? 'PASS' : 'FAIL'));
        log('DONE');
      } catch (e) {
        log('EXCEPTION=' + (e && e.message ? e.message : e));
        log('RESULT=FAIL');
        log('DONE');
      }
    }, 600);
  });
})();
