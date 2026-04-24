"""Run the full pipeline once: fetch flights → generate heatmap → upload to bucket."""

import logging

from globular_adsb import config
from globular_adsb import flights as flights_mod
from globular_adsb import heatmap as heatmap_mod
from globular_adsb import upload

log = logging.getLogger(__name__)

_LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s"
_LOG_DATE = "%Y-%m-%d %H:%M:%S"


def run() -> None:
    log.info("=== fetch flights ===")
    flights_mod.run(config.ARCHIVE_DIR, config.DIST_DIR, config.AIRPORTS_CSV)

    log.info("=== generate heatmap ===")
    if heatmap_mod.needs_regeneration(config.DIST_DIR / "heatmaps"):
        heatmap_mod.run(config.ARCHIVE_DIR, config.AIRPORTS_CSV, config.DIST_DIR / "heatmaps")
    else:
        log.info("Skipping — frames up to date (interval %g min).", heatmap_mod.STEP_HOURS * 60)

    log.info("=== upload assets ===")
    if config.R2_ENDPOINT and config.R2_ACCESS_KEY and config.R2_SECRET_KEY:
        upload.upload_assets(config.DIST_DIR, config.AIRPORTS_CSV)
    else:
        log.warning("R2 credentials not set, skipping upload.")

    log.info("Pipeline complete.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run()


if __name__ == "__main__":
    main()
