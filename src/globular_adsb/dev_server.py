"""
Local dev server for testing.

Serves static/ for the frontend and dist/ for generated assets
(flights.json, heatmap.webp) and data/ for airports.csv — mirroring
what the CDN/bucket exposes in production.
"""

import http.server
import socketserver
from pathlib import Path

from globular_adsb import config

_DIST_ROUTES = {"/flights.json"}
_DATA_ROUTES = {"/airports.csv"}


class _Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        clean = path.split("?")[0]
        if clean in _DIST_ROUTES or clean.endswith(".webp") or clean.endswith(".jpg"):
            return str(config.DIST_DIR / clean.lstrip("/"))
        if clean in _DATA_ROUTES:
            return str(config.DATA_DIR / clean.lstrip("/"))
        # Default: serve from static/
        rel = super().translate_path(path)
        # SimpleHTTPRequestHandler roots at cwd; remap into static/
        from http.server import SimpleHTTPRequestHandler
        import os
        rel_to_cwd = os.path.relpath(rel, os.getcwd())
        return str(config.STATIC_DIR / rel_to_cwd)

    def log_message(self, fmt: str, *args) -> None:
        print(f"  {self.address_string()} {fmt % args}")


def main() -> None:
    port = config.DEV_PORT
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), _Handler) as httpd:
        print(f"Dev server running at http://localhost:{port}")
        print(f"  static/ → {config.STATIC_DIR}")
        print(f"  dist/   → {config.DIST_DIR}  (flights.json, *.webp)")
        print(f"  data/   → {config.DATA_DIR}  ({', '.join(sorted(_DATA_ROUTES))})")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
