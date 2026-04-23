import datetime
import json
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

WIDTH = 8192
HEIGHT = 4096
WINDOW_HOURS = 12
STEP_HOURS = 0.25
TOTAL_HOURS = 48
DILATION_RADIUS = 2
QUALITY_HIGH = 90
QUALITY_LOW = 30


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

    print(f"  {len(flights) - skipped} weighted, {skipped} missing/short-haul skipped")
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


def needs_regeneration(output_dir: Path, interval_hours: float = STEP_HOURS) -> bool:
    existing = list(output_dir.glob("heatmap_*.webp"))
    if not existing:
        return True
    newest_mtime = max(p.stat().st_mtime for p in existing)
    return (time.time() - newest_mtime) >= interval_hours * 3600


def run_window(
    archive_dir: Path,
    airports: dict[str, tuple[float, float]],
    output_path: Path,
    start_hours: float,
    end_hours: float,
    quality: int = QUALITY_LOW,
) -> Path:
    print(f"Loading flights {start_hours}–{end_hours}h ago …")
    flights = load_flights_window(archive_dir, start_hours, end_hours)
    print(f"  {len(flights)} flight records found")

    if not flights:
        print("No data — nothing to render.")
        return output_path

    print("Building density map …")
    density = build_heatmap(flights, airports)

    print("Rendering colours …")
    rgba = density_to_rgba(density)

    output_path.parent.mkdir(exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(output_path, format="WEBP", quality=quality)
    print(f"Saved {output_path}  ({WIDTH}×{HEIGHT})")
    return output_path


def run(archive_dir: Path, airports_csv: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(exist_ok=True)
    airports = load_airports(airports_csv)

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    today_midnight = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    hours_since_midnight = (now_utc - today_midnight).total_seconds() / 3600

    tasks: list[tuple] = [
        (
            archive_dir,
            airports,
            output_dir / "heatmap_last24h.webp",
            hours_since_midnight,
            hours_since_midnight + 24.0,
            QUALITY_HIGH,
        ),
    ]
    # Generate slider positions 1–(TOTAL_HOURS-WINDOW_HOURS) in STEP_HOURS increments.
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

    outputs = []
    with ProcessPoolExecutor() as executor:
        futures = {executor.submit(run_window, *t): t[2] for t in tasks}
        for future in as_completed(futures):
            outputs.append(future.result())
    return outputs


def main() -> None:
    from globular_adsb.config import ARCHIVE_DIR, AIRPORTS_CSV, DIST_DIR

    run(ARCHIVE_DIR, AIRPORTS_CSV, DIST_DIR / "heatmaps")


if __name__ == "__main__":
    main()
