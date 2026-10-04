#!/usr/bin/env python3
"""Serve the Project-Zero editor page from the repository root so the icon set resolves.

    python3 Frontier/Docs/Design/serve-editor.py [--port 8080]
"""
import argparse, functools, http.server, os, socketserver

PAGE = "/Frontier/Docs/Design/ProjectZeroEditor.html"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send_response(302); self.send_header("Location", PAGE); self.end_headers(); return
        super().do_GET()

if __name__ == "__main__":
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--port", type=int, default=8080)
    Args = Parser.parse_args()
    Root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", Args.port),
                                functools.partial(Handler, directory=Root)) as Server:
        print(f"Project-Zero editor on http://0.0.0.0:{Args.port}{PAGE}")
        Server.serve_forever()
