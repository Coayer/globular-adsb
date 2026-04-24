import datetime
import json
import logging
import subprocess
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

from globular_adsb.flights import (
    distance_weight,
    haversine_km,
    is_longhaul,
    load_airports,
)

log = logging.getLogger(__name__)

WIDTH = 8192
HEIGHT = 4096
WINDOW_HOURS = 12
STEP_HOURS = 0.5
TOTAL_HOURS = 84
DILATION_RADIUS = 2
QUALITY_HIGH = 90
QUALITY_LOW = 100


def load_flights_window(
    archive_dir: Path, start_hours: float, end_hours: float
) -> list[dict]:
    """Load flights from end_hours ago up to start_hours ago."""
    now = time.time()
    earliest = now - end_hours * 3600
    latest = now - start_hours * 3600
    flights = []
    for path in archive_dir.glob("*.json"):
        try:
            ts = int(path.stem)
        except ValueError:
            continue
        if ts < earliest or ts > latest:
            continue
        data = json.loads(path.read_text())
        flights.extend(data.get("flights", []))
    return flights


def latlon_to_xy(lat: float, lon: float) -> tuple[int, int]:
    x = int((lon + 180) / 360 * WIDTH)
    y = int((90 - lat) / 180 * HEIGHT)
    return max(0, min(WIDTH - 1, x)), max(0, min(HEIGHT - 1, y))


def build_heatmap(
    flights: list[dict], airports: dict[str, tuple[float, float]]
) -> np.ndarray:
    density = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    skipped = 0
    r = DILATION_RADIUS
    for f in flights:
        if not is_longhaul(f, airports):
            skipped += 1
            continue
        origin = f["originAirportIata"]
        dest = f["destinationAirportIata"]
        dist = haversine_km(*airports[origin], *airports[dest])
        w = distance_weight(dist)
        w = 1.0
        x, y = latlon_to_xy(f["latitude"], f["longitude"])
        density[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1] += w

    log.info(
        "%d weighted, %d missing/short-haul skipped", len(flights) - skipped, skipped
    )
    return density


def density_to_rgba(density: np.ndarray) -> np.ndarray:
    vmax = np.percentile(density[density > 0], 99) if np.any(density > 0) else 1.0
    # Square-root compress before normalising so busy hubs don't dominate;
    # sparse routes stay visible while hot spots don't saturate the colour scale.
    normalized = np.clip(np.sqrt(density / vmax), 0, 1)

    colours = np.array(
        [
            [0, 0, 255],  # blue   at t=0.25
            [0, 255, 255],  # cyan   at t=0.50
            [255, 255, 0],  # yellow at t=0.75
            [255, 0, 0],  # red    at t=1.00
        ],
        dtype=np.float32,
    )

    ci = np.clip(normalized * 4 - 1, 0, 3)
    idx = np.clip(ci.astype(int), 0, 2)
    frac = (ci - idx)[..., np.newaxis]

    rgb = colours[idx] + frac * (colours[np.clip(idx + 1, 0, 3)] - colours[idx])

    rgba = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(normalized**0.5 * 255, 0, 255).astype(
        np.uint8
    )  # square root to boost faint pixels
    return rgba


def _expected_frame_paths(output_dir: Path) -> set[Path]:
    paths = {output_dir / "heatmap_last24h.webp"}
    max_n = TOTAL_HOURS - WINDOW_HOURS
    n = 1.0
    while n <= max_n + 1e-9:
        n_r = round(n, 10)
        paths.add(output_dir / f"heatmap_{n_r:g}h.webp")
        n = round(n + STEP_HOURS, 10)
    return paths


def needs_regeneration(output_dir: Path, interval_hours: float = STEP_HOURS) -> bool:
    if not (output_dir / "heatmap_animation.webm").exists():
        return True

    expected = _expected_frame_paths(output_dir)
    existing = set(output_dir.glob("heatmap_*.webp"))

    if expected - existing:
        return True
    if existing - expected:
        return True

    midnight_ts = (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .timestamp()
    )
    last24h = output_dir / "heatmap_last24h.webp"
    if last24h.stat().st_mtime < midnight_ts:
        return True

    slider_frames = existing - {last24h}
    if slider_frames:
        newest_mtime = max(p.stat().st_mtime for p in slider_frames)
        if (time.time() - newest_mtime) >= interval_hours * 3600:
            return True

    return False


def run_window(
    archive_dir: Path,
    airports: dict[str, tuple[float, float]],
    output_path: Path,
    start_hours: float,
    end_hours: float,
    quality: int = QUALITY_LOW,
) -> Path:
    # Subprocess workers don't inherit handlers from the parent process.
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)

    log.info("Loading flights %g–%gh ago …", start_hours, end_hours)
    flights = load_flights_window(archive_dir, start_hours, end_hours)
    log.info("%d flight records found", len(flights))

    if not flights:
        log.warning("No data — nothing to render.")
        return output_path

    log.info("Building density map …")
    density = build_heatmap(flights, airports)

    log.info("Rendering colours …")
    rgba = density_to_rgba(density)

    output_path.parent.mkdir(exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(output_path, format="WEBP", quality=quality)
    log.info("Saved %s  (%dx%d)", output_path, WIDTH, HEIGHT)
    return output_path


def run(archive_dir: Path, airports_csv: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(exist_ok=True)
    airports = load_airports(airports_csv)

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    today_midnight = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    hours_since_midnight = (now_utc - today_midnight).total_seconds() / 3600
    midnight_ts = today_midnight.timestamp()

    last24h_path = output_dir / "heatmap_last24h.webp"
    tasks: list[tuple] = [
        (
            archive_dir,
            airports,
            last24h_path,
            hours_since_midnight,
            hours_since_midnight + 24.0,
            QUALITY_HIGH,
        ),
    ]
    # Slider positions 1–(TOTAL_HOURS-WINDOW_HOURS) in STEP_HOURS increments.
    # n=1 → 2300Z yesterday, n=25 → 2300Z day-before, wrapping every 24.
    max_n = TOTAL_HOURS - WINDOW_HOURS
    n = 1.0
    while n <= max_n + 1e-9:
        n_r = round(n, 10)
        start_h = hours_since_midnight + (n_r - 1.0)
        tasks.append(
            (
                archive_dir,
                airports,
                output_dir / f"heatmap_{n_r:g}h.webp",
                start_h,
                start_h + WINDOW_HOURS,
                QUALITY_LOW,
            )
        )
        n = round(n + STEP_HOURS, 10)

    expected_paths = {t[2] for t in tasks}

    # Remove extraneous files not in the expected set.
    for p in sorted(output_dir.glob("heatmap_*.webp")):
        if p not in expected_paths:
            log.warning("Removing extraneous frame: %s", p.name)
            p.unlink()

    # last24h: regenerate if missing or generated before today's midnight.
    regen_last24h = (
        not last24h_path.exists() or last24h_path.stat().st_mtime < midnight_ts
    )
    if regen_last24h and last24h_path.exists():
        log.info(
            "heatmap_last24h.webp pre-dates midnight — regenerating for new calendar day"
        )

    # Slider frames: generate missing ones; full regeneration only when interval elapsed.
    slider_tasks = [t for t in tasks if t[2] != last24h_path]
    slider_paths = {t[2] for t in slider_tasks}
    existing_sliders = {p for p in slider_paths if p.exists()}
    missing_sliders = slider_paths - existing_sliders

    tasks_to_run = []
    if regen_last24h:
        tasks_to_run.extend(t for t in tasks if t[2] == last24h_path)

    if missing_sliders:
        log.info(
            "%d slider frame(s) missing — generating missing frames",
            len(missing_sliders),
        )
        tasks_to_run.extend(t for t in slider_tasks if t[2] in missing_sliders)
    elif existing_sliders:
        newest_mtime = max(p.stat().st_mtime for p in existing_sliders)
        if (time.time() - newest_mtime) >= STEP_HOURS * 3600:
            tasks_to_run.extend(slider_tasks)
    else:
        tasks_to_run.extend(slider_tasks)

    video_path = output_dir / "heatmap_animation.webm"

    if not tasks_to_run:
        log.info("All frames up to date.")
        if not video_path.exists():
            encode_animation_video(output_dir, video_path)
        return []

    log.info("Generating %d frame(s) …", len(tasks_to_run))
    outputs = []
    with ProcessPoolExecutor() as executor:
        futures = {executor.submit(run_window, *t): t[2] for t in tasks_to_run}
        for future in as_completed(futures):
            outputs.append(future.result())

    encode_animation_video(output_dir, video_path)
    return outputs


def encode_animation_video(output_dir: Path, output_path: Path, fps: int = 20) -> None:
    """Stitch slider frames into a WebM/VP9 video with alpha for globe VideoTexture playback."""
    max_n = TOTAL_HOURS - WINDOW_HOURS
    frame_paths = []
    n = 1.0
    while n <= max_n + 1e-9:
        n_r = round(n, 10)
        p = output_dir / f"heatmap_{n_r:g}h.webp"
        if p.exists():
            frame_paths.append(p)
        n = round(n + STEP_HOURS, 10)

    if not frame_paths:
        log.warning("No slider frames found — skipping animation video")
        return

    concat_list = output_dir / "_concat.txt"
    try:
        with open(concat_list, "w") as f:
            for path in frame_paths:
                f.write(f"file '{path.resolve()}'\n")
                f.write(f"duration {1 / fps:.4f}\n")

        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-vf",
            "scale=8192:4096",
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-auto-alt-ref",
            "0",
            "-crf",
            "33",
            "-b:v",
            "0",
            str(output_path),
        ]
        log.info(
            "Encoding animation video (%d frames @ %dfps) …", len(frame_paths), fps
        )
        subprocess.run(cmd, check=True)
        log.info("Saved %s", output_path)
    finally:
        concat_list.unlink(missing_ok=True)


def main() -> None:
    from globular_adsb.config import AIRPORTS_CSV, ARCHIVE_DIR, DIST_DIR
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run(ARCHIVE_DIR, AIRPORTS_CSV, DIST_DIR / "heatmaps")


if __name__ == "__main__":
    main()
