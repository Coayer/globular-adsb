import datetime
import json
from pathlib import Path

from globular_adsb import hubs

# Fixed clock so the window is deterministic regardless of when tests run.
# 1_700_000_000 is 2023-11-14 22:13:20 UTC, so the window under test is
# 2023-11-13 00:00 → 2023-11-14 00:00 UTC.
NOW = 1_700_000_000
DAY_START, DAY_END = hubs.previous_utc_day(NOW)


def _flight(callsign="TEST001", origin="JFK", dest="LHR", speed=500):
    return {
        "latitude": 51.0,
        "longitude": -30.0,
        "heading": 270,
        "altitude": 35000,
        "groundSpeed": speed,
        "aircraftCode": "B77W",
        "originAirportIata": origin,
        "destinationAirportIata": dest,
        "callsign": callsign,
    }


def _snapshot(archive_dir: Path, ts: int, flights: list[dict]) -> None:
    (archive_dir / f"{ts}.json").write_text(
        json.dumps({"timestamp": ts, "flights": flights})
    )


def _counts(archive_dir: Path, airports_csv: Path, now=NOW):
    from globular_adsb.flights import load_airports

    return hubs.count_recent_flights(archive_dir, load_airports(airports_csv), now)


def test_previous_utc_day_is_midnight_aligned():
    start, end = hubs.previous_utc_day(NOW)
    assert end - start == 86400
    for ts in (start, end):
        dt = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
        assert (dt.hour, dt.minute, dt.second) == (0, 0, 0)
    # The window must end at the midnight that opened the current day.
    today = datetime.datetime.fromtimestamp(NOW, datetime.timezone.utc).date()
    assert datetime.datetime.fromtimestamp(end, datetime.timezone.utc).date() == today


def test_single_flight_counts_once_each_way(archive_dir, airports_csv):
    _snapshot(archive_dir, DAY_START + 3600, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"] == {"out": 1, "in": 0}
    assert counts["LHR"] == {"out": 0, "in": 1}


def test_same_flight_across_snapshots_counted_once(archive_dir, airports_csv):
    # Eight consecutive 15-minute snapshots of one aircraft mid-cruise.
    for i in range(8):
        _snapshot(archive_dir, DAY_START + 3600 + i * 900, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1
    assert counts["LHR"]["in"] == 1


def test_scan_gap_does_not_split_a_leg(archive_dir, airports_csv):
    # A missed scan leaves an hour-long hole; that is still one flight.
    _snapshot(archive_dir, DAY_START + 3600, [_flight()])
    _snapshot(archive_dir, DAY_START + 7200, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1


def test_rotation_after_long_gap_counted_twice(archive_dir, airports_csv):
    # Same flight number on the same route, seven hours later: a second rotation.
    _snapshot(archive_dir, DAY_START + 3600, [_flight()])
    _snapshot(archive_dir, DAY_START + 3600 + 7 * 3600, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 2
    assert counts["LHR"]["in"] == 2


def test_snapshot_before_window_excluded(archive_dir, airports_csv):
    _snapshot(archive_dir, DAY_START - 1, [_flight(callsign="OLD001")])
    _snapshot(archive_dir, DAY_START, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1


def test_snapshot_from_today_excluded(archive_dir, airports_csv):
    # Today is still in progress; only the last complete day is reported.
    _snapshot(archive_dir, DAY_END, [_flight(callsign="TODAY1")])
    _snapshot(archive_dir, NOW - 600, [_flight(callsign="TODAY2")])
    _snapshot(archive_dir, DAY_END - 900, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1


def test_short_haul_and_blank_callsign_excluded(archive_dir, airports_csv):
    _snapshot(
        archive_dir,
        DAY_START + 3600,
        [
            _flight(callsign="SLOW01", speed=200),  # below SPEED_MIN
            _flight(callsign=""),  # no usable identity
            _flight(callsign="NOAP01", origin="ZZZ", dest="LHR"),  # unknown airport
            _flight(),
        ],
    )
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1
    assert counts["LHR"]["in"] == 1
    assert "ZZZ" not in counts


def test_distinct_flights_accumulate(archive_dir, airports_csv):
    _snapshot(
        archive_dir,
        DAY_START + 3600,
        [
            _flight(callsign="AAA111"),
            _flight(callsign="BBB222"),
            _flight(callsign="CCC333", origin="LHR", dest="JFK"),
        ],
    )
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"] == {"out": 2, "in": 1}
    assert counts["LHR"] == {"out": 1, "in": 2}


def test_top_n_truncates(archive_dir, airports_csv, monkeypatch):
    monkeypatch.setattr(hubs, "HUB_TOP_N", 2)
    _snapshot(
        archive_dir,
        DAY_START + 3600,
        [
            _flight(callsign="AAA111", origin="JFK", dest="LHR"),
            _flight(callsign="BBB222", origin="JFK", dest="LHR"),
            _flight(callsign="CCC333", origin="SYD", dest="SIN"),
        ],
    )
    counts = _counts(archive_dir, airports_csv)
    assert set(counts) == {"JFK", "LHR"}


def test_corrupt_snapshot_is_skipped(archive_dir, airports_csv):
    (archive_dir / f"{DAY_START + 900}.json").write_text("{not json")
    _snapshot(archive_dir, DAY_START + 3600, [_flight()])
    counts = _counts(archive_dir, airports_csv)
    assert counts["JFK"]["out"] == 1


def test_run_writes_well_formed_json(archive_dir, airports_csv, tmp_path):
    import time

    # run() stamps its own clock, so anchor the snapshot to the real prior day.
    start, _end = hubs.previous_utc_day(time.time())
    _snapshot(archive_dir, start + 3600, [_flight()])
    dist = tmp_path / "dist"
    path = hubs.run(archive_dir, dist, airports_csv)

    payload = json.loads(path.read_text())
    assert path.name == "hubs24h.json"
    assert payload["day"] == hubs._day_label(start)
    assert payload["windowEnd"] - payload["windowStart"] == 86400
    assert payload["airports"]["JFK"] == {"out": 1, "in": 0}


def test_run_skips_when_day_already_covered(archive_dir, airports_csv, tmp_path):
    import time

    start, _end = hubs.previous_utc_day(time.time())
    _snapshot(archive_dir, start + 3600, [_flight()])
    dist = tmp_path / "dist"
    path = hubs.run(archive_dir, dist, airports_csv)
    first = path.read_text()

    # A second flight appears, but the day is already published: no recompute.
    _snapshot(archive_dir, start + 7200, [_flight(callsign="BBB222")])
    hubs.run(archive_dir, dist, airports_csv)
    assert path.read_text() == first


def test_run_recomputes_for_a_new_day(archive_dir, airports_csv, tmp_path):
    import time

    start, _end = hubs.previous_utc_day(time.time())
    _snapshot(archive_dir, start + 3600, [_flight()])
    dist = tmp_path / "dist"
    path = hubs.run(archive_dir, dist, airports_csv)

    # Stale file from an earlier day must not suppress the rebuild.
    stale = json.loads(path.read_text())
    stale["day"] = "1999-01-01"
    stale["airports"] = {}
    path.write_text(json.dumps(stale))

    hubs.run(archive_dir, dist, airports_csv)
    payload = json.loads(path.read_text())
    assert payload["day"] == hubs._day_label(start)
    assert payload["airports"]["JFK"] == {"out": 1, "in": 0}
