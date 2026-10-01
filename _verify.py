# -*- coding: utf-8 -*-
"""一键全量验证：构建 → 逻辑断言 → 真机渲染断言 → 出截图。

    python _verify.py

四步都跑，最后给一行总结。任何一步失败都回非零退出码。
    1) build.py            src/ → 单文件 index.html
    2) _smoke.js           node + vm 逻辑断言（含 B7 几何）
    3) _gltest.html        无头 Chrome + SwiftShader 真机渲染断言
    4) index.html          宽/窄两种视口各出一张截图供人工复核
"""
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def find_chrome():
    """Locate a Chrome/Chromium binary. $CHROME wins, then the usual places."""
    cands = []
    if os.environ.get('CHROME'):
        cands.append(os.environ['CHROME'])
    cands += [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"]
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'chrome'):
        cands.append(shutil.which(name))
    for c in cands:
        if c and os.path.exists(c):
            return c
    return 'chrome'


def find_node():
    """Locate node. $NODE wins, then PATH, then the usual Windows install dirs."""
    if os.environ.get('NODE') and os.path.exists(os.environ['NODE']):
        return os.environ['NODE']
    w = shutil.which('node')
    if w:
        return w
    for c in (r"C:\Program Files\nodejs\node.exe",
              os.path.join(os.environ.get('LOCALAPPDATA', ''),
                           'Programs', 'nodejs', 'node.exe')):
        if c and os.path.exists(c):
            return c
    return 'node'


CHROME = find_chrome()
PY = sys.executable
NODE = find_node()
SPLICE = os.path.join(ROOT, '_gltest.py')


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=600, **kw)


def head(title):
    print('\n' + '=' * 62)
    print('  ' + title)
    print('=' * 62)


def step_build():
    head('1/4 构建')
    r = run([PY, os.path.join(ROOT, 'build.py')])
    print(r.stdout.strip() or r.stderr.strip())
    return r.returncode == 0


def step_smoke():
    head('2/4 逻辑断言 (_smoke.js)')
    r = run([NODE, os.path.join(ROOT, '_smoke.js')])
    out = r.stdout
    for line in out.splitlines():
        if 'FAIL' in line or 'passed' in line or line.startswith('  failing') or line.strip().startswith('- '):
            print(line)
    return 'failed 0' in out


def step_gl():
    head('3/4 真机渲染断言 (_gltest.html @ headless SwiftShader)')
    r = run([PY, SPLICE, os.path.join(ROOT, 'index.html'),
             os.path.join(ROOT, '_gltest.js'), os.path.join(ROOT, '_gltest.html')])
    if r.returncode != 0:
        print('splice failed: %s' % (r.stdout or r.stderr))
        return False
    page = os.path.join(ROOT, '_gltest.html').replace('\\', '/')
    r = run([CHROME, '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
             '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
             '--virtual-time-budget=9000', '--dump-dom', 'file:///' + page])
    dom = r.stdout
    got = {}
    for key in ('GL_OK', 'GL_FAIL', 'CANVAS', 'PASS_COUNT', 'ERRORS', 'PASSES',
                'NEUTRAL_MEAN', 'SOURCE_MEAN', 'NEUTRAL_DRIFT', 'NEUTRAL_IDENTITY',
                'MEANS', 'DISTINCT_MEANS', 'GOLDEN_DELTA', 'RESULT'):
        # 第一行前面紧贴 <pre ...> 的 '>'，所以行首锚点不能只写 ^
        m = re.search(r'(?:^|>)[ \t]*' + key + r'=([^\n<]*)', dom, re.M)
        got[key] = m.group(1).strip() if m else '(missing)'
    for k in ('GL_OK', 'CANVAS', 'PASS_COUNT', 'ERRORS', 'NEUTRAL_MEAN', 'SOURCE_MEAN',
              'NEUTRAL_DRIFT', 'NEUTRAL_IDENTITY', 'DISTINCT_MEANS', 'GOLDEN_DELTA', 'RESULT'):
        print('  %-17s %s' % (k, got[k]))
    print('  %-17s %s' % ('PASSES', got['PASSES']))
    missing = [k for k in ('GL_OK', 'ERRORS', 'NEUTRAL_IDENTITY', 'DISTINCT_MEANS', 'RESULT')
               if got[k] == '(missing)']
    if missing:
        print('  抓取失败，字段缺失: %s' % missing)
        return False
    return got['RESULT'] == 'PASS' and got['GL_OK'] == 'true'


def shot(name, size, out):
    png = os.path.join(ROOT, '_out', out).replace('\\', '/')
    url = 'file:///' + os.path.join(ROOT, 'index.html').replace('\\', '/')
    r = run([CHROME, '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
             '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
             '--hide-scrollbars', '--window-size=' + size,
             '--virtual-time-budget=7000', '--screenshot=' + png, url])
    ok = os.path.exists(png)
    print('  %-10s %-10s %s' % (name, size, 'ok' if ok else 'FAILED'))
    return ok


def step_shots():
    head('4/4 截图')
    os.makedirs(os.path.join(ROOT, '_out'), exist_ok=True)
    a = shot('宽屏', '1500,940', 'shot3.png')
    b = shot('窄屏', '520,900', 'shot_narrow2.png')
    return a and b


def main():
    if not os.path.exists(CHROME) and not shutil.which(CHROME):
        print('chrome not found: %s' % CHROME)
        print('set CHROME=/path/to/chrome to point at your install')
        return 1
    print('  python  %s' % PY)
    print('  node    %s' % NODE)
    print('  chrome  %s' % CHROME)
    res = [step_build(), step_smoke(), step_gl(), step_shots()]
    head('总结')
    labels = ['构建', '逻辑断言', '真机渲染', '截图']
    for lab, r in zip(labels, res):
        print('  %-10s %s' % (lab, 'PASS' if r else 'FAIL'))
    print('\n  ALL=' + ('PASS' if all(res) else 'FAIL'))
    return 0 if all(res) else 1


if __name__ == '__main__':
    sys.exit(main())
