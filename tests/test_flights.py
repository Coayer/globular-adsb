import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from globular_adsb.flights import (
    build_bounds_grid,
    build_traces,
    fetch_flights_for_grid,
    run,
)


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
    f.icao_24bit = f"HEX{fid}"
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


def test_fetch_flights_retries_then_succeeds():
    fr_api = MagicMock()
    # First attempt on the tile fails, the retry succeeds.
    fr_api.get_flights.side_effect = [RuntimeError("timeout"), [_make_flight("1")]]

    with patch("globular_adsb.flights.time.sleep"):
        flights, _ = fetch_flights_for_grid(fr_api, ["tile"], "test")

    assert len(flights) == 1
    assert fr_api.get_flights.call_count == 2


def test_fetch_flights_gives_up_after_retries():
    from globular_adsb.flights import MAX_RETRIES

    fr_api = MagicMock()
    fr_api.get_flights.side_effect = RuntimeError("rate limited")

    with patch("globular_adsb.flights.time.sleep") as sleep:
        flights, total_raw = fetch_flights_for_grid(fr_api, ["tile"], "test")

    # One initial attempt plus MAX_RETRIES; the tile is skipped, not fatal.
    assert flights == []
    assert total_raw == 0
    assert fr_api.get_flights.call_count == MAX_RETRIES + 1
    # Backed off once per retry (not after the final give-up).
    assert sleep.call_count == MAX_RETRIES


def test_run_writes_archive_and_dist(tmp_path: Path, airports_csv: Path):
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
        dist_path = run(archive_dir, dist_dir, airports_csv)

    assert dist_path == dist_dir / "flights.json"
    assert dist_path.exists()

    archive_files = list(archive_dir.glob("*.json"))
    assert len(archive_files) == 1

    data = json.loads(dist_path.read_text())
    assert "timestamp" in data
    assert len(data["flights"]) == 1
    assert data["flights"][0]["icao24"] == "HEX42"

    # traces.json is written alongside; a single snapshot yields no drawable trace.
    traces = json.loads((dist_dir / "traces.json").read_text())
    assert traces["traces"] == {}


def _snapshot(archive_dir: Path, ts: int, flights: list[dict]) -> None:
    (archive_dir / f"{ts}.json").write_text(
        json.dumps({"timestamp": ts, "flights": flights})
    )


def _pos(callsign, lat, lon, spd, origin="JFK", dest="LHR", alt=35000):
    return {
        "callsign": callsign,
        "latitude": lat,
        "longitude": lon,
        "groundSpeed": spd,
        "altitude": alt,
        "originAirportIata": origin,
        "destinationAirportIata": dest,
    }


def test_build_traces_threads_scopes_and_filters(archive_dir: Path):
    import time

    now = int(time.time())
    t1, t2, t3 = now - 3600, now - 1800, now

    # Oldest snapshot written last to confirm output is ordered by time, not by
    # file iteration order.
    _snapshot(
        archive_dir,
        t3,
        [
            _pos("AAA", 51.0, -3.0, 520, alt=38000),
            _pos("BBB", 40.0, -50.0, 515),
            _pos("CCC", 45.0, -20.0, 505),  # only appears here -> single point
            _pos("N/A", 10.0, 10.0, 480),  # blank callsign -> skipped
        ],
    )
    _snapshot(
        archive_dir,
        t1,
        [
            _pos("AAA", 51.0, -1.0, 480, alt=30000),
            _pos("BBB", 40.0, -40.0, 500, dest="CDG"),  # wrong leg -> excluded
        ],
    )
    _snapshot(
        archive_dir,
        t2,
        [
            _pos("AAA", 51.0, -2.0, 500, alt=34000),
            _pos("BBB", 40.0, -45.0, 510),
        ],
    )

    longhaul = [
        _pos("AAA", 51.0, -3.0, 520, alt=38000),
        _pos("BBB", 40.0, -50.0, 515),
        _pos("CCC", 45.0, -20.0, 505),
        _pos("N/A", 10.0, 10.0, 480),
    ]

    traces = build_traces(archive_dir, longhaul)

    # AAA: three points threaded in ascending time order, [lat, lon, altitude].
    assert traces["AAA"] == [
        [51.0, -1.0, 30000],
        [51.0, -2.0, 34000],
        [51.0, -3.0, 38000],
    ]
    # BBB: the wrong-leg point (t1) is dropped, leaving two matching-leg points.
    assert traces["BBB"] == [[40.0, -45.0, 35000], [40.0, -50.0, 35000]]
    # CCC has a single point and N/A is blank -> neither is drawable.
    assert "CCC" not in traces
    assert "N/A" not in traces


def test_build_traces_ignores_out_of_window_archives(archive_dir: Path):
    import time

    now = int(time.time())
    old = now - 48 * 3600  # older than TRACE_WINDOW_HOURS

    _snapshot(archive_dir, old, [_pos("AAA", 51.0, -1.0, 480)])
    _snapshot(archive_dir, now, [_pos("AAA", 51.0, -3.0, 520)])

    traces = build_traces(archive_dir, [_pos("AAA", 51.0, -3.0, 520)])

    # Only the in-window snapshot survives -> single point -> nothing drawable.
    assert traces == {}
