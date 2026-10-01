# -*- coding: utf-8 -*-
"""Splice a headless driver into the built single-file page.

    python _gltest.py [src.html] [driver.js] [dest.html]

Defaults are index.html + _gltest.js -> _gltest.html, so the bare command does
the render-verification splice. Pass explicit arguments to reuse the same
splice for other drivers (e.g. _iso.js -> _iso.html).
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def main(argv):
    src = argv[1] if len(argv) > 1 else os.path.join(ROOT, 'index.html')
    driver = argv[2] if len(argv) > 2 else os.path.join(ROOT, '_gltest.js')
    dest = argv[3] if len(argv) > 3 else os.path.join(ROOT, '_gltest.html')

    if not os.path.exists(src):
        print('ERROR: %s missing, run build.py first' % src)
        return 1
    if not os.path.exists(driver):
        print('ERROR: %s missing' % driver)
        return 1

    html = read(src)
    js = read(driver)
    if '</body>' not in html:
        print('ERROR: </body> not found in %s' % src)
        return 1

    html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')
    with io.open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)

    print('wrote %s' % dest)
    return 0


sys.exit(main(sys.argv))
