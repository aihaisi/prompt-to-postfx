# -*- coding: utf-8 -*-
"""生成 sample.js 的变异体，验证 B7 断言真的能抓到旧写法。

    python _mutate.py

把「64 条窄带 + 横向软边渐变」的倒影换回
「一条纵向渐变 + 一个 fillRect」的旧写法，写到项目根的 _mutant_sample.js。
再跑   SMOKE_SAMPLE=_mutant_sample.js node _smoke.js   应当看到 B7 失败。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

OLD = """  const rg = ctx.createLinearGradient(0, horizon, 0, h);
  rg.addColorStop(0.00, 'rgba(255,214,156,0.50)');
  rg.addColorStop(1.00, 'rgba(255,150,90,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(sx - w * 0.022, horizon, w * 0.044, h - horizon);"""

START = '  /* 水面灯柱倒影。'
END = '  ctx.restore();'


def main():
    src = os.path.join(ROOT, 'src', 'sample.js')
    with io.open(src, 'r', encoding='utf-8') as f:
        text = f.read()

    i = text.index(START)
    j = text.index(END, i) + len(END)
    mutant = text[:i] + OLD + text[j:]

    out = os.path.join(ROOT, '_mutant_sample.js')
    with io.open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(mutant)
    print('wrote %s  (%d -> %d chars)' % (out, j - i, len(OLD)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
