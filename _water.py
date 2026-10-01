# -*- coding: utf-8 -*-
"""对比修复前后：水面灯柱倒影的左右边界是不是硬边。

同一个配方（iso_onlyGrade，只留调色，其他效果好全关），
唯一变量是 sample.js 里的倒影画法。

    python _water.py
"""
import os
import statistics

from PIL import Image, ImageDraw, ImageEnhance

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, '_out')

# 水面区带（页面坐标，1500×940 截图）
Y0, Y1 = 500, 880
# 倒影所在的横向范围：把中间的对比分割线（约 x=575）排除在外
XS, XE = 700, 960


def profile(path, y0=Y0, y1=Y1):
    im = Image.open(path).convert('L')
    px = im.load()
    prof = []
    for x in range(0, im.size[0]):
        col = [px[x, y] for y in range(y0, y1, 4)]
        prof.append(statistics.mean(col))
    return im, prof


def report(name, path):
    im, prof = profile(path)
    seg = prof[XS:XE]
    jumps = [(XS + i, round(seg[i] - seg[i - 1], 1)) for i in range(1, len(seg))]
    mx = max(jumps, key=lambda t: abs(t[1]))
    # 硬边 = 单列跳变；软边应当被摊到几十列上
    hard = [t for t in jumps if abs(t[1]) > 2.0]
    print('%-8s 段内最大单列跳变 %+6.1f @x=%d   跳变>2.0 的列数 %d' % (name, mx[1], mx[0], len(hard)))
    return im


old = os.path.join(OUT, 'iso_onlyGrade_old.png')
new = os.path.join(OUT, 'iso_onlyGrade.png')
print('=== 倒影边界锐度（x %d..%d，y %d..%d）===' % (XS, XE, Y0, Y1))
img_old = report('修复前', old)
img_new = report('修复后', new)

# 并排增强图，人工复核
def band(im):
    b = im.crop((600, Y0, 1060, Y1))
    b = ImageEnhance.Contrast(b).enhance(2.4)
    return ImageEnhance.Brightness(b).enhance(1.6)


a, b = band(img_old), band(img_new)
w, h = a.size
sheet = Image.new('RGB', (w, h * 2 + 26), (18, 18, 22))
sheet.paste(a, (0, 0))
sheet.paste(b, (0, h + 26))
d = ImageDraw.Draw(sheet)
d.text((6, h + 6), 'BEFORE  (hard vertical edges)', fill=(255, 140, 140))
d.text((6, h * 2 + 8), 'AFTER  (soft horizontal falloff)', fill=(120, 255, 150))
out = os.path.join(OUT, 'water_cmp.png')
sheet.save(out)
print('saved', out)
