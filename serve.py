#!/usr/bin/env python3
"""Static dev server for the fluid demo. Sends no-store headers so browsers never run stale shader/JS modules."""
import http.server, socketserver, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', port), NoCache) as httpd:
    print(f'Serving on http://0.0.0.0:{port}', flush=True)
    httpd.serve_forever()
