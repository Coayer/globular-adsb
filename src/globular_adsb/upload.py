"""Upload pipeline artifacts to the Cloudflare R2 (S3-compatible) assets bucket."""

import logging
import mimetypes
import time
from pathlib import Path

import boto3
from botocore.config import Config

from globular_adsb import config

log = logging.getLogger(__name__)


class CredentialsError(Exception):
    pass


def _client():
    if not (config.R2_ENDPOINT and config.R2_ACCESS_KEY and config.R2_SECRET_KEY):
        raise CredentialsError("R2 credentials not set")
    return boto3.client(
        "s3",
        endpoint_url=config.R2_ENDPOINT,
        aws_access_key_id=config.R2_ACCESS_KEY,
        aws_secret_access_key=config.R2_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_file(local_path: Path, key: str) -> None:
    content_type = (
        mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    )
    log.info("Uploading %s → s3://%s/%s", local_path, config.R2_BUCKET, key)
    _client().upload_file(
        str(local_path),
        config.R2_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )


def upload_flights(dist_dir: Path) -> None:
    upload_file(dist_dir / "flights.json", "flights.json")


def _recent(path: Path) -> bool:
    return path.exists() and (time.time() - path.stat().st_mtime) < 86400


def upload_heatmaps(dist_dir: Path) -> None:
    heatmap = dist_dir / "heatmaps" / "heatmap_last24h.webp"
    if _recent(heatmap):
        upload_file(heatmap, "heatmaps/heatmap_last24h.webp")
    video = dist_dir / "heatmaps" / "heatmap_animation.webm"
    if _recent(video):
        upload_file(video, "heatmaps/heatmap_animation.webm")
    mp4 = dist_dir / "heatmaps" / "heatmap_animation.mp4"
    if _recent(mp4):
        upload_file(mp4, "heatmaps/heatmap_animation.mp4")
    # upload_file(airports_csv, "airports.csv")
