import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

ARCHIVE_DIR = ROOT / "archive"
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "static"
DIST_DIR = ROOT / "dist"
AIRPORTS_CSV = DATA_DIR / "airports.csv"

ASSETS_BUCKET_URL = "https://globular-adsb-assets.copey.dev"

R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")
R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY", "")
R2_SECRET_KEY = os.getenv("R2_SECRET_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "globular-adsb-assets")

SCHEDULE_INTERVAL_MINUTES = int(os.getenv("SCHEDULE_INTERVAL_MINUTES", "15"))
DEV_PORT = int(os.getenv("DEV_PORT", "8080"))
