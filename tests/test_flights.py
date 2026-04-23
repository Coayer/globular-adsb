import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from globular_adsb.flights import build_bounds_grid, fetch_flights_for_grid, run


def test_build_bounds_grid_covers_globe():
    grid = build_bounds_grid(overlap=0)
    assert len(grid) > 0
    for tile in grid:
        parts = [float(x) for x in tile.split(",")]
        assert len(parts) == 4
        y1, y2, x1, x2 = parts
        assert y1 > y2
        assert x1 < x2


def test_build_bounds_grid_overlap_expands_bounds():
    no_overlap = build_bounds_grid(overlap=0)
    with_overlap = build_bounds_grid(overlap=10)
    assert len(no_overlap) == len(with_overlap)

    y1_no, y2_no, x1_no, x2_no = (float(v) for v in no_overlap[0].split(","))
    y1_ov, y2_ov, x1_ov, x2_ov = (float(v) for v in with_overlap[0].split(","))
    assert y1_ov >= y1_no
    assert y2_ov <= y2_no


def _make_flight(fid: str, lat: float = 51.0, lng: float = 0.0):
    f = MagicMock()
    f.id = fid
    f.latitude = lat
    f.longitude = lng
    f.heading = 90
    f.altitude = 35000
    f.ground_speed = 500
    f.aircraft_code = "B77W"
    f.origin_airport_iata = "JFK"
    f.destination_airport_iata = "LHR"
    f.callsign = f"TEST{fid}"
    return f


def test_fetch_flights_deduplicates():
    fr_api = MagicMock()
    flight_a = _make_flight("1")
    flight_b = _make_flight("2")
    # Both tiles return flight_a; only tile 1 has flight_b
    fr_api.get_flights.side_effect = [
        [flight_a, flight_b],
        [flight_a],
    ]

    with patch("globular_adsb.flights.time.sleep"):
        flights, total_raw = fetch_flights_for_grid(fr_api, ["tile1", "tile2"], "test")

    assert total_raw == 3
    assert len(flights) == 2
    ids = {f["callsign"] for f in flights}
    assert ids == {"TEST1", "TEST2"}


def test_fetch_flights_handles_api_error():
    fr_api = MagicMock()
    fr_api.get_flights.side_effect = [RuntimeError("timeout"), [_make_flight("1")]]

    with patch("globular_adsb.flights.time.sleep"):
        flights, _ = fetch_flights_for_grid(fr_api, ["bad_tile", "good_tile"], "test")

    assert len(flights) == 1


def test_run_writes_archive_and_dist(tmp_path: Path):
    archive_dir = tmp_path / "archive"
    dist_dir = tmp_path / "dist"
    flight = _make_flight("42")

    mock_api = MagicMock()
    mock_api.get_flights.return_value = [flight]

    with (
        patch("globular_adsb.flights.FlightRadar24API", return_value=mock_api),
        patch("globular_adsb.flights.time.sleep"),
        patch("globular_adsb.flights.time.time", return_value=1_700_000_000),
    ):
        dist_path = run(archive_dir, dist_dir)

    assert dist_path == dist_dir / "flights.json"
    assert dist_path.exists()

    archive_files = list(archive_dir.glob("*.json"))
    assert len(archive_files) == 1

    data = json.loads(dist_path.read_text())
    assert "timestamp" in data
    assert len(data["flights"]) == 1
