# -*- coding: utf-8 -*-
"""单变量隔离实验：把 _iso.js 拼进单文件页面，逐个变体截图。

    python _iso.py

产出 _out/iso_<variant>.png，每个变体跑一次无头 Chrome。
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from _verify import find_chrome  # noqa: E402  (shared tool discovery)

CHROME = find_chrome()
SPLICE = os.path.join(ROOT, '_gltest.py')
VARIANTS = ['full', 'noGlitch', 'noAberr', 'noBloom', 'noGrain',
            'noScan', 'noHalf', 'noEdge', 'noVig', 'onlyGrade']


def splice():
    """把 _iso.js 拼进 index.html 的 </body> 之前（复用本项目的拼接脚本）。"""
    src = os.path.join(ROOT, 'index.html')
    drv = os.path.join(ROOT, '_iso.js')
    out = os.path.join(ROOT, '_iso.html')
    r = subprocess.run([sys.executable, SPLICE, src, drv, out],
                       capture_output=True, text=True)
    print('splice: rc=%d %s' % (r.returncode, (r.stdout or r.stderr).strip()))
    return out if r.returncode == 0 else None


def shot(page, name):
    png = os.path.join(ROOT, '_out', 'iso_%s.png' % name).replace('\\', '/')
    url = 'file:///' + page.replace('\\', '/') + '#v=' + name
    cmd = [CHROME, '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
           '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
           '--hide-scrollbars', '--window-size=1500,940',
           '--virtual-time-budget=6000',
           '--screenshot=' + png, url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    dom = r.stdout or ''
    mk = re.search(r'id="__mk"[^>]*>([^<]*)<', dom)
    ok = os.path.exists(png)
    print('%-10s rc=%d png=%s  %s' % (name, r.returncode, ok, (mk.group(1) if mk else '(no marker)')))
    if r.stderr.strip():
        print('           stderr: %s' % r.stderr.strip()[:200])
    return ok


def main():
    os.makedirs(os.path.join(ROOT, '_out'), exist_ok=True)
    page = splice()
    if not page:
        return 1
    if not os.path.exists(CHROME) and not shutil.which(CHROME):
        print('chrome not found at %s' % CHROME)
        print('set CHROME=/path/to/chrome to point at your install')
        return 1
    for v in VARIANTS:
        shot(page, v)
    return 0


if __name__ == '__main__':
    sys.exit(main())
