"""Fetch flights and generate heatmap without uploading."""

import logging

from globular_adsb import config
from globular_adsb import heatmap as heatmap_mod

log = logging.getLogger(__name__)


def run() -> None:
    log.info("=== generate heatmap ===")
    heatmap_mod.run(config.ARCHIVE_DIR, config.AIRPORTS_CSV, config.DIST_DIR / "heatmaps")

    log.info("Generation complete.")


def main() -> None:
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run()


if __name__ == "__main__":
    main()
