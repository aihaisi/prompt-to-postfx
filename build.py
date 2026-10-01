# -*- coding: utf-8 -*-
"""Inline src/* into a single self-contained index.html.

Output has zero external requests: stylesheet and all scripts are inlined,
so index.html can be opened by double-click with no server and no network.
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
SCRIPTS = ['looks.js', 'sample.js', 'renderer.js', 'app.js']


def read(name):
    with io.open(os.path.join(SRC, name), 'r', encoding='utf-8') as f:
        return f.read()


def main():
    html = read('body.html')
    css = read('styles.css')

    if '<!--STYLES-->' not in html or '<!--SCRIPTS-->' not in html:
        print('ERROR: <!--STYLES--> or <!--SCRIPTS--> placeholder missing in src/body.html')
        return 1

    chunks = []
    for name in SCRIPTS:
        chunks.append('/* ==================== src/%s ==================== */\n%s' % (name, read(name)))
    js = '\n\n'.join(chunks)

    html = html.replace('<!--STYLES-->', '<style>\n' + css + '\n</style>')
    html = html.replace('<!--SCRIPTS-->', '<script>\n' + js + '\n</script>')

    dest = os.path.join(ROOT, 'index.html')
    with io.open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)

    print('built index.html  %.1f KB  (%d scripts + 1 stylesheet inlined)'
          % (len(html.encode('utf-8')) / 1024.0, len(SCRIPTS)))
    return 0


sys.exit(main())
