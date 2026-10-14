#!/usr/bin/env python3
"""Static dev server for the Slate SDF-GI demo.

Sends Cache-Control: no-store on every response. The demo compiles its WGSL
from JS modules at page load, so a heuristically cached module would keep
stale shaders running after a fix — no-store makes every reload pick up the
current sources.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), NoStoreHandler).serve_forever()
