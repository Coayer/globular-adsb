"""Re-encode animation videos from existing frames without regenerating them."""

import argparse
import logging

from globular_adsb.config import DIST_DIR
from globular_adsb.heatmap import encode_animation_video
from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-encode animation videos from existing frames."
    )
    parser.add_argument("--no-webm", action="store_true", help="Skip VP9/WebM encoding")
    parser.add_argument(
        "--no-h264", action="store_true", help="Skip H.264/MP4 encoding"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    heatmaps_dir = DIST_DIR / "heatmaps"
    encode_animation_video(
        heatmaps_dir / "frames",
        heatmaps_dir / "heatmap_animation.webm",
        webm=not args.no_webm,
        h264=not args.no_h264,
        darkmap_path=DIST_DIR / "darkmap.jpg",
    )


if __name__ == "__main__":
    main()
