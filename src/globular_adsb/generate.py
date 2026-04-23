"""Fetch flights and generate heatmap without uploading."""

from globular_adsb import config
from globular_adsb import heatmap as heatmap_mod


def run() -> None:
    print("\n=== generate heatmap ===")
    heatmap_mod.run(config.ARCHIVE_DIR, config.AIRPORTS_CSV, config.DIST_DIR / "heatmaps")

    print("\nGeneration complete.")


def main() -> None:
    run()


if __name__ == "__main__":
    main()
