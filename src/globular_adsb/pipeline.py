"""Run the full pipeline once: fetch flights → generate heatmap → upload to bucket."""

from globular_adsb import config
from globular_adsb import flights as flights_mod
from globular_adsb import heatmap as heatmap_mod
from globular_adsb import upload


def run() -> None:
    print("=== fetch flights ===")
    flights_mod.run(config.ARCHIVE_DIR, config.DIST_DIR, config.AIRPORTS_CSV)

    print("\n=== generate heatmap ===")
    if heatmap_mod.needs_regeneration(config.DIST_DIR / "heatmaps"):
        heatmap_mod.run(config.ARCHIVE_DIR, config.AIRPORTS_CSV, config.DIST_DIR / "heatmaps")
    else:
        print("  Skipping — last generation was less than 6h ago.")

    print("\n=== upload assets ===")
    if config.R2_ENDPOINT and config.R2_ACCESS_KEY and config.R2_SECRET_KEY:
        upload.upload_assets(config.DIST_DIR, config.AIRPORTS_CSV)
    else:
        print("R2 credentials not set, skipping upload.")

    print("\nPipeline complete.")


def main() -> None:
    run()


if __name__ == "__main__":
    main()
