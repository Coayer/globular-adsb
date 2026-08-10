"""Generate only the two 24-hour static heatmaps (longhaul and all-traffic)."""

import argparse
import datetime
import logging

from globular_adsb import config
from globular_adsb import heatmap as heatmap_mod
from globular_adsb.flights import load_airports

log = logging.getLogger(__name__)


def run(*, rolling: bool = False) -> None:
    log.info("=== generate 24h heatmaps (%s) ===", "rolling" if rolling else "calendar day")

    output_dir = config.DIST_DIR / "heatmaps"
    output_dir.mkdir(exist_ok=True)
    airports = load_airports(config.AIRPORTS_CSV)

    if rolling:
        start_h = 0.0
        end_h = 24.0
    else:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        today_midnight = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        hours_since_midnight = (now_utc - today_midnight).total_seconds() / 3600
        start_h = hours_since_midnight
        end_h = hours_since_midnight + 24.0

    heatmap_mod.run_window(
        config.ARCHIVE_DIR,
        airports,
        output_dir / "heatmap_last24h.webp",
        start_h,
        end_h,
        heatmap_mod.QUALITY_STATIC,
        True,
    )
    heatmap_mod.run_window(
        config.ARCHIVE_DIR,
        airports,
        output_dir / "heatmap_all_last24h.webp",
        start_h,
        end_h,
        heatmap_mod.QUALITY_STATIC,
        False,
    )

    log.info("Generation complete.")


def main() -> None:
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)

    parser = argparse.ArgumentParser(description="Generate 24h static heatmaps")
    parser.add_argument(
        "--rolling",
        action="store_true",
        help="Use a rolling 24h window (now − 24h to now) instead of the current calendar day (midnight to midnight)",
    )
    args = parser.parse_args()
    run(rolling=args.rolling)


if __name__ == "__main__":
    main()
