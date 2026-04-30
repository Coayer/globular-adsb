"""Upload dist assets to the Cloudflare R2 bucket without running the pipeline."""

from globular_adsb import config, upload


def main() -> None:
    try:
        upload.upload_flights(config.DIST_DIR)
        upload.upload_heatmaps(config.DIST_DIR)
    except upload.CredentialsError as e:
        raise SystemExit(e)
    print("Upload complete.")


if __name__ == "__main__":
    main()
