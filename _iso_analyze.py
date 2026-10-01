# -*- coding: utf-8 -*-
"""量化各隔离变体：硬边竖向色块到底由哪个环节产生。

针对风格化一侧（右半画布）的水面区带，算三个指标：
  vee     —— 竖向边缘能量（列间亮度差），硬边会把它拉高
  steps   —— 列均值剖面上的「硬台阶」个数（相邻列跳变 > 阈值），
             这是单变量判定硬边来源最直接的指标
  flat    —— 列均值剖面的总起伏，衡量块状程度
"""
import glob
import os
import statistics

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
X0, X1 = 450, 1055          # 风格化侧
Y0, Y1 = 470, 870           # 画面下半部（水面/城市底部）

THRESH = 1.2                # 相邻列均值跳变阈值（0-255）


def analyze(path):
    im = Image.open(path).convert('L')
    px = im.load()
    W = X1 - X0

    # 竖向边缘能量
    d = []
    prof = []
    for x in range(X0, X1):
        col = [px[x, y] for y in range(Y0, Y1, 3)]
        prof.append(statistics.mean(col))
    for i in range(1, len(prof)):
        d.append(abs(prof[i] - prof[i - 1]))

    vee = statistics.mean(d)
    steps = sum(1 for v in d if v > THRESH)
    flat = max(prof) - min(prof)
    return vee, steps, flat, prof


def main():
    files = sorted(glob.glob(os.path.join(ROOT, '_out', 'iso_*.png')))
    rows = []
    for f in files:
        name = os.path.basename(f)[4:-4]
        vee, steps, flat, prof = analyze(f)
        rows.append((name, vee, steps, flat, prof))

    rows.sort(key=lambda r: -r[2])
    print('%-11s %8s %7s %7s' % ('variant', 'vee', 'steps', 'flat'))
    print('-' * 38)
    for n, v, s, fl, _ in rows:
        print('%-11s %8.2f %7d %7.1f' % (n, v, s, fl))

    # 极值：硬台阶最多的那个变体，把它的剖面台阶位置打出来
    worst = rows[0]
    print('\n硬台阶最多的是 %s（%d 个）。台阶所在列：' % (worst[0], worst[2]))
    prof = worst[4]
    hits = []
    for i in range(1, len(prof)):
        if abs(prof[i] - prof[i - 1]) > THRESH:
            hits.append((X0 + i, round(prof[i] - prof[i - 1], 1)))
    print(hits[:40])

    # 纵向拼图，便于肉眼复核
    names = [r[0] for r in rows]
    ims = [Image.open(os.path.join(ROOT, '_out', 'iso_%s.png' % n)).convert('RGB')
           .crop((X0, Y0, X1, Y1)) for n in names]
    w, h = ims[0].size
    sc = 0.75
    w2, h2 = int(w * sc), int(h * sc)
    sheet = Image.new('RGB', (w2 * 2 + 10, h2 * 5 + 50), (20, 20, 24))
    for i, im in enumerate(ims):
        cx, cy = i % 2, i // 2
        sheet.paste(im.resize((w2, h2), Image.LANCZOS), (cx * (w2 + 10), cy * (h2 + 10)))
    out = os.path.join(ROOT, '_out', 'iso_sheet.png')
    sheet.save(out)
    print('\n拼图顺序（左→右，上→下）：%s' % ', '.join(names))
    print('saved %s' % out)


if __name__ == '__main__':
    main()
