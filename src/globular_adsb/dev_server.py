"""
Local dev server for testing.

Serves static/ for the frontend and dist/ for generated assets
(flights.json, heatmap.webp) and data/ for airports.csv — mirroring
what the CDN/bucket exposes in production.
"""

from flask import Flask, send_from_directory

from globular_adsb import config

app = Flask(__name__, static_folder=None)

_DIST_EXTENSIONS = {".webp", ".jpg", ".webm", ".mp4"}


@app.route("/flights.json")
def flights_json():
    return send_from_directory(config.DIST_DIR, "flights.json")


@app.route("/airports.csv")
def airports():
    return send_from_directory(config.DATA_DIR, "airports.csv")


@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def catch_all(path: str):
    from pathlib import PurePosixPath

    if PurePosixPath(path).suffix in _DIST_EXTENSIONS:
        return send_from_directory(config.DIST_DIR, path)
    return send_from_directory(config.STATIC_DIR, path)


def main() -> None:
    port = config.DEV_PORT
    print(f"Dev server running at http://localhost:{port}")
    print(f"  static/ → {config.STATIC_DIR}")
    print(f"  dist/   → {config.DIST_DIR}  (flights.json, *.webp)")
    print(f"  data/   → {config.DATA_DIR}  (airports.csv)")
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()
