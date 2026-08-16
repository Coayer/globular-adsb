"""Per-airport long-haul flight counts for the last complete UTC day.

The live panel counts aircraft airborne right now, which swings with the time of
day. This aggregates the archive instead, so each airport gets a stable measure
of how many long-haul flights it actually handled.

The window is midnight-to-midnight UTC rather than a rolling 24h so that it
matches heatmap_last24h.webp, which run() in heatmap.py renders over exactly the
same period — the panel and the globe underneath it describe the same day.
"""

import datetime
import json
import logging
import time
from collections import defaultdict
from pathlib import Path

from globular_adsb.flights import _BLANK, is_longhaul, load_airports

log = logging.getLogger(__name__)

HUB_WINDOW_HOURS = 24
# Archives carry no stable aircraft id, so a flight is identified by
# (callsign, origin, destination). Re-seeing that triple after a long silence
# means a later rotation of the same flight number, not the same leg: mid-cruise
# gaps are scan misses and run to about an hour, while a turnaround cannot.
ROTATION_GAP_SECONDS = 6 * 3600
# The panel shows 10, but it can only show airports that also have a flight
# airborne right now, so publish a deeper list than that.
HUB_TOP_N = 40


def previous_utc_day(now: float) -> tuple[int, int]:
    """[start, end) of the last complete UTC calendar day, as unix seconds."""
    today_midnight = datetime.datetime.fromtimestamp(
        now, datetime.timezone.utc
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    end = int(today_midnight.timestamp())
    return end - HUB_WINDOW_HOURS * 3600, end


def _snapshot_times(archive_dir: Path, start: int, end: int) -> list[tuple[int, Path]]:
    """In-window archive snapshots as (timestamp, path), oldest first."""
    snapshots = []
    for path in archive_dir.glob("*.json"):
        try:
            ts = int(path.stem)
        except ValueError:
            continue
        if start <= ts < end:
            snapshots.append((ts, path))
    snapshots.sort()
    return snapshots


def count_recent_flights(
    archive_dir: Path,
    airports: dict[str, tuple[float, float]],
    now: float | None = None,
) -> dict[str, dict[str, int]]:
    """Count distinct long-haul flights per airport over the last full UTC day.

    Returns {iata: {"out": n, "in": n}} for the busiest HUB_TOP_N airports.
    """
    if now is None:
        now = time.time()
    start, end = previous_utc_day(now)

    # (callsign, origin, destination) -> (last seen ts, legs counted so far).
    # Snapshots are read one at a time and discarded: the whole window is a few
    # GB of JSON, but only this dict has to stay resident.
    seen: dict[tuple[str, str, str], tuple[int, int]] = {}
    for ts, path in _snapshot_times(archive_dir, start, end):
        try:
            flights = json.loads(path.read_text()).get("flights", [])
        except (OSError, json.JSONDecodeError):
            continue
        for f in flights:
            callsign = f.get("callsign")
            if not callsign or callsign in _BLANK:
                continue
            if not is_longhaul(f, airports):
                continue
            key = (
                callsign,
                f["originAirportIata"],
                f["destinationAirportIata"],
            )
            prev = seen.get(key)
            if prev is None:
                seen[key] = (ts, 1)
            else:
                last_ts, legs = prev
                if ts - last_ts >= ROTATION_GAP_SECONDS:
                    legs += 1
                seen[key] = (ts, legs)

    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"out": 0, "in": 0})
    for (_callsign, origin, dest), (_last_ts, legs) in seen.items():
        counts[origin]["out"] += legs
        counts[dest]["in"] += legs

    top = sorted(counts.items(), key=lambda kv: -(kv[1]["out"] + kv[1]["in"]))
    log.info(
        "%d long-haul flights on %s across %d airports",
        sum(legs for _ts, legs in seen.values()),
        _day_label(start),
        len(counts),
    )
    return dict(top[:HUB_TOP_N])


def _day_label(start: int) -> str:
    return datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime(
        "%Y-%m-%d"
    )


def _already_current(path: Path, day: str) -> bool:
    """True if path already holds counts for this day.

    The window is a closed calendar day, so the answer only changes at midnight —
    but run() is called on the hourly render tick. Same idea as
    heatmap.needs_regeneration().
    """
    try:
        return json.loads(path.read_text()).get("day") == day
    except (OSError, json.JSONDecodeError):
        return False


def run(archive_dir: Path, dist_dir: Path, airports_csv: Path) -> Path:
    """Aggregate the last full UTC day and write dist/hubs24h.json."""
    dist_dir.mkdir(exist_ok=True)
    timestamp = int(time.time())
    start, end = previous_utc_day(timestamp)
    day = _day_label(start)

    path = dist_dir / "hubs24h.json"
    if _already_current(path, day):
        log.info("Skipping — %s already covers %s.", path.name, day)
        return path

    counts = count_recent_flights(archive_dir, load_airports(airports_csv), timestamp)
    path.write_text(
        json.dumps(
            {
                "timestamp": timestamp,
                "day": day,
                "windowStart": start,
                "windowEnd": end,
                "airports": counts,
            }
        )
    )
    log.info("Updated %s  (%s, %d airports)", path, day, len(counts))
    return path


def main() -> None:
    from globular_adsb.config import AIRPORTS_CSV, ARCHIVE_DIR, DIST_DIR
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run(ARCHIVE_DIR, DIST_DIR, AIRPORTS_CSV)


if __name__ == "__main__":
    main()
