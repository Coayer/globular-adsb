import numpy as np
import pytest
from pathlib import Path

from globular_adsb.heatmap import (
    HEIGHT,
    WIDTH,
    build_heatmap,
    density_to_rgba,
    distance_weight,
    gaussian_kernel,
    haversine_km,
    latlon_to_xy,
    load_airports,
    load_recent_flights,
    run,
)


def test_latlon_to_xy_poles():
    x, y = latlon_to_xy(90, -180)
    assert x == 0
    assert y == 0

    x, y = latlon_to_xy(-90, 180)
    assert x == WIDTH - 1
    assert y == HEIGHT - 1


def test_latlon_to_xy_origin():
    x, y = latlon_to_xy(0, 0)
    assert x == WIDTH // 2
    assert y == HEIGHT // 2


def test_latlon_to_xy_clamps():
    x, y = latlon_to_xy(999, 999)
    assert 0 <= x < WIDTH
    assert 0 <= y < HEIGHT


def test_gaussian_kernel_sums_to_one():
    k = gaussian_kernel(4)
    assert abs(k.sum() - 1.0) < 1e-6
    assert k.shape == (9, 9)


def test_haversine_known_distance():
    # JFK → LHR ≈ 5540 km
    dist = haversine_km(40.6398, -73.7789, 51.4775, -0.4614)
    assert 5400 < dist < 5700


def test_distance_weight_boundaries():
    assert distance_weight(0) == 0.0
    assert distance_weight(4_000) == 0.0
    assert distance_weight(8_000) == 1.0
    assert distance_weight(100_000) == 1.0
    w = distance_weight(6_000)
    assert 0.0 < w < 1.0


def test_load_airports(airports_csv: Path):
    airports = load_airports(airports_csv)
    assert "JFK" in airports
    assert "LHR" in airports
    lat, lon = airports["JFK"]
    assert abs(lat - 40.6398) < 0.01


def test_build_heatmap_skips_slow_flights(airports_csv: Path):
    airports = load_airports(airports_csv)
    slow_flight = {
        "latitude": 51.0, "longitude": 0.0, "groundSpeed": 100,
        "originAirportIata": "JFK", "destinationAirportIata": "LHR",
    }
    density = build_heatmap([slow_flight], airports)
    assert density.sum() == 0.0


def test_build_heatmap_skips_short_haul(airports_csv: Path):
    airports = load_airports(airports_csv)
    # JFK→LHR is ~5500 km — above DIST_MIN so it counts
    long_flight = {
        "latitude": 51.0, "longitude": -30.0, "groundSpeed": 500,
        "originAirportIata": "JFK", "destinationAirportIata": "LHR",
    }
    density = build_heatmap([long_flight], airports)
    assert density.sum() > 0.0


def test_density_to_rgba_shape_and_range():
    density = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    density[100, 200] = 1.0
    rgba = density_to_rgba(density)
    assert rgba.shape == (HEIGHT, WIDTH, 4)
    assert rgba.dtype == np.uint8
    assert rgba[..., 3].max() > 0  # some non-zero alpha


def test_density_to_rgba_transparent_where_zero():
    density = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    rgba = density_to_rgba(density)
    assert rgba[..., 3].sum() == 0


def test_load_recent_flights_respects_cutoff(archive_with_flights: Path):
    # hours=24 should include the freshly-written fixture
    flights = load_recent_flights(archive_with_flights, hours=24)
    assert len(flights) == 3


def test_load_recent_flights_excludes_old(archive_dir: Path):
    import json, time
    old_ts = int(time.time()) - 48 * 3600
    payload = {"timestamp": old_ts, "flights": [{"latitude": 0}]}
    (archive_dir / f"{old_ts}.json").write_text(json.dumps(payload))

    flights = load_recent_flights(archive_dir, hours=24)
    assert len(flights) == 0


def test_run_produces_webp(archive_with_flights: Path, airports_csv: Path, tmp_path: Path):
    output = tmp_path / "heatmap.webp"
    run(archive_with_flights, airports_csv, output)
    assert output.exists()
    assert output.stat().st_size > 0
