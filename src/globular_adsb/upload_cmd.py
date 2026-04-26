"""Upload dist assets to the Cloudflare R2 bucket without running the pipeline."""

from globular_adsb import config, upload


def main() -> None:
    if not (config.R2_ENDPOINT and config.R2_ACCESS_KEY and config.R2_SECRET_KEY):
        raise SystemExit("R2 credentials not set.")
    upload.upload_assets(config.DIST_DIR)
    print("Upload complete.")


if __name__ == "__main__":
    main()
