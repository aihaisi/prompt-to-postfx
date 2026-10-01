# -*- coding: utf-8 -*-
"""Local static server for the prototype. Binds 127.0.0.1 only (never 0.0.0.0)."""
import http.server
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('[srv] %s\n' % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        url = 'http://127.0.0.1:%d/' % PORT
        print('serving %s' % ROOT)
        print('open: %s' % url)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()


if __name__ == '__main__':
    main()
