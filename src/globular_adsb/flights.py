import csv
import json
import logging
import math
import time
from pathlib import Path

from FlightRadar24.api import FlightRadar24API

log = logging.getLogger(__name__)

LAT_STEP_COARSE = 20
LON_STEP_COARSE = 40
LAT_STEP_DENSE = 5
LON_STEP_DENSE = 10
OVERLAP = 3
OVERLAP_COARSE = 8

# (south, north, west, east) bounding boxes for high-traffic airspace
DENSE_ZONES = [
    (24, 50, -125, -65),  # Continental US
    (35, 62, -10, 32),  # Western Europe
    (3, 47, 100, 145),  # East Asia: China coast, S Korea, Japan
    (1, 3, 103, 106),  # Singapore
    (-40, -20, 140, 155),  # Eastern Australia
    (-47, -34, 166, 178),  # New Zealand
]

DIST_MIN = 3700
DIST_MAX = 8000
SPEED_MIN = 300

# Pause between per-tile API calls so the (now two-pass) grid doesn't hammer
# FlightRadar24's unofficial endpoint and risk a rate-limit block. At ~434 tiles
# this adds a few minutes, still well inside the 15-minute fetch cadence.
REQUEST_DELAY_SECONDS = 0.5

# When a tile request fails (often a rate-limit/timeout), retry it after an
# exponentially growing pause (2s, 4s, 8s) before giving up on that tile. Backing
# off on errors keeps a temporary throttle from cascading into a hard block.
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 2.0

# How far back to look when threading a flight's past positions into a trace.
TRACE_WINDOW_HOURS = 3
_BLANK = {"", "N/A"}


def load_airports(airports_csv: Path) -> dict[str, tuple[float, float]]:
    airports: dict[str, tuple[float, float]] = {}
    with airports_csv.open(newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) < 6:
                continue
            iata, lat, lon = row[2].strip(), row[4].strip(), row[5].strip()
            if iata:
                airports[iata] = (float(lat), float(lon))
    return airports


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def distance_weight(dist_km: float) -> float:
    return max(0.0, min(1.0, (dist_km - DIST_MIN) / (DIST_MAX - DIST_MIN)))


def is_longhaul(flight: dict, airports: dict[str, tuple[float, float]]) -> bool:
    if flight.get("groundSpeed", 0) <= SPEED_MIN:
        return False
    origin = flight.get("originAirportIata")
    dest = flight.get("destinationAirportIata")
    if not origin or not dest or origin not in airports or dest not in airports:
        return False
    return haversine_km(*airports[origin], *airports[dest]) >= DIST_MIN


def _in_dense_zone(lat: float, lon: float) -> bool:
    return any(
        south <= lat <= north and west <= lon <= east
        for south, north, west, east in DENSE_ZONES
    )


def _tile(
    lat_top: float, lat_bot: float, lon_left: float, lon_right: float, overlap: float
) -> str:
    y1 = min(lat_top + overlap, 90)
    y2 = max(lat_bot - overlap, -90)
    x1 = max(lon_left - overlap, -180)
    x2 = min(lon_right + overlap, 180)
    return f"{y1},{y2},{x1},{x2}"


def _edges(hi: float, lo: float, step: float, shift: float) -> list[float]:
    """Descending tile boundaries from hi down to lo. The interior lattice is
    offset by `shift` fraction of a step; hi and lo are always included."""
    edges = [hi]
    e = hi - (shift * step if shift else step)
    while e > lo:
        edges.append(e)
        e -= step
    if edges[-1] != lo:
        edges.append(lo)
    return edges


def _edges_asc(lo: float, hi: float, step: float, shift: float) -> list[float]:
    """Ascending counterpart of _edges (lo up to hi)."""
    edges = [lo]
    e = lo + (shift * step if shift else step)
    while e < hi:
        edges.append(e)
        e += step
    if edges[-1] != hi:
        edges.append(hi)
    return edges


def build_bounds_grid(
    overlap: float = 0,
    overlap_coarse: float | None = None,
    lat_shift: float = 0.0,
    lon_shift: float = 0.0,
    coarse_only: bool = False,
) -> list[str]:
    """Return "y1,y2,x1,x2" strings tiling the globe with adaptive resolution.

    Dense airspace zones (US, Europe, Australasia) use fine tiles; oceans and
    sparsely trafficked regions use coarse tiles. `lat_shift`/`lon_shift` offset
    the tile lattice by a fraction of a step, so a second shifted pass re-covers
    aircraft dropped where a tile hit the API's per-request cap or fell on a seam.
    `coarse_only` skips the dense zones — used for that second pass, since the fine
    dense tiles never approach the cap and re-scanning them just wastes requests.
    """
    if overlap_coarse is None:
        overlap_coarse = overlap
    bounds: list[str] = []

    if not coarse_only:
        for south, north, west, east in DENSE_ZONES:
            lat_e = _edges(north, south, LAT_STEP_DENSE, lat_shift)
            lon_e = _edges_asc(west, east, LON_STEP_DENSE, lon_shift)
            for lat_top, lat_bot in zip(lat_e, lat_e[1:]):
                for lon_left, lon_right in zip(lon_e, lon_e[1:]):
                    bounds.append(
                        _tile(lat_top, lat_bot, lon_left, lon_right, overlap)
                    )

    lat_e = _edges(90, -90, LAT_STEP_COARSE, lat_shift)
    lon_e = _edges_asc(-180, 180, LON_STEP_COARSE, lon_shift)
    for lat_top, lat_bot in zip(lat_e, lat_e[1:]):
        for lon_left, lon_right in zip(lon_e, lon_e[1:]):
            if not _in_dense_zone((lat_top + lat_bot) / 2, (lon_left + lon_right) / 2):
                bounds.append(
                    _tile(lat_top, lat_bot, lon_left, lon_right, overlap_coarse)
                )

    return bounds


def fetch_flights_for_grid(
    fr_api: FlightRadar24API, grid: list[str], label: str
) -> tuple[list[dict], int]:
    """Fetch and deduplicate flights across all tiles. Returns (flights, total_raw)."""
    seen_ids: set[str] = set()
    flights: list[dict] = []
    total_raw = 0

    log.info("── %s (%d tiles) ──", label, len(grid))
    for i, bounds in enumerate(grid, 1):
        results = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                results = fr_api.get_flights(bounds=bounds)
                break
            except Exception as e:
                if attempt == MAX_RETRIES:
                    log.error(
                        "[%d/%d] giving up after %d retries — %s",
                        i,
                        len(grid),
                        MAX_RETRIES,
                        e,
                    )
                else:
                    backoff = BACKOFF_BASE_SECONDS * 2**attempt
                    log.warning(
                        "[%d/%d] error (attempt %d/%d), backing off %.0fs — %s",
                        i,
                        len(grid),
                        attempt + 1,
                        MAX_RETRIES,
                        backoff,
                        e,
                    )
                    time.sleep(backoff)

        if results is not None:
            total_raw += len(results)
            new = 0
            for f in results:
                if f.id not in seen_ids:
                    seen_ids.add(f.id)
                    flights.append(
                        {
                            "icao24": f.icao_24bit,
                            "latitude": f.latitude,
                            "longitude": f.longitude,
                            "heading": f.heading,
                            "altitude": f.altitude,
                            "groundSpeed": f.ground_speed,
                            "aircraftCode": f.aircraft_code,
                            "originAirportIata": f.origin_airport_iata,
                            "destinationAirportIata": f.destination_airport_iata,
                            "callsign": f.callsign,
                        }
                    )
                    new += 1
            log.info("[%d/%d] %d new / %d raw", i, len(grid), new, len(results))
        if i < len(grid):
            time.sleep(REQUEST_DELAY_SECONDS)

    return flights, total_raw


ARCHIVE_MAX_AGE = 1.25 * 7 * 24 * 3600  # 1.25 weeks in seconds


def purge_old_archives(archive_dir: Path) -> None:
    cutoff = time.time() - ARCHIVE_MAX_AGE
    for f in archive_dir.glob("*.json"):
        try:
            if int(f.stem) < cutoff:
                f.unlink()
                log.info("Deleted old archive %s", f.name)
        except ValueError:
            pass


def build_traces(archive_dir: Path, longhaul: list[dict]) -> dict[str, list]:
    """Thread each current long-haul aircraft's recent positions into a polyline.

    Keyed by callsign and scoped to the current leg via matching
    origin/destination, so a previous flight of the same callsign isn't joined.
    Callsign (not the ICAO hex) is used because it is present on essentially every
    long-haul flight and in all historical archives, so traces work immediately and
    stay continuous — hex would be empty until archives accumulate it post-deploy.
    Each point is [lat, lon, altitude] (rounded) in ascending time order.
    Flights with a blank callsign or fewer than two points are omitted.
    """
    # Current long-haul callsign -> (origin, destination) leg identity.
    legs: dict[str, tuple] = {}
    for f in longhaul:
        cs = f.get("callsign")
        if cs and cs not in _BLANK:
            legs[cs] = (
                f.get("originAirportIata"),
                f.get("destinationAirportIata"),
            )
    if not legs:
        return {}

    # In-window archive snapshots, oldest first (the current cycle's archive is
    # already written, so the latest position is included).
    cutoff = time.time() - TRACE_WINDOW_HOURS * 3600
    snapshots: list[tuple[int, list[dict]]] = []
    for path in archive_dir.glob("*.json"):
        try:
            ts = int(path.stem)
        except ValueError:
            continue
        if ts < cutoff:
            continue
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        snapshots.append((ts, data.get("flights", [])))
    snapshots.sort(key=lambda s: s[0])

    traces: dict[str, list] = {cs: [] for cs in legs}
    for _ts, flights in snapshots:
        for f in flights:
            leg = legs.get(f.get("callsign"))
            if leg is None:
                continue
            if (f.get("originAirportIata"), f.get("destinationAirportIata")) != leg:
                continue
            lat, lon = f.get("latitude"), f.get("longitude")
            if lat is None or lon is None:
                continue
            traces[f["callsign"]].append(
                [round(lat, 3), round(lon, 3), round(f.get("altitude") or 0)]
            )

    return {h: pts for h, pts in traces.items() if len(pts) >= 2}


def run(archive_dir: Path, dist_dir: Path, airports_csv: Path) -> Path:
    """Fetch flights, write a timestamped archive file, and update dist/flights.json."""
    archive_dir.mkdir(exist_ok=True)
    dist_dir.mkdir(exist_ok=True)

    purge_old_archives(archive_dir)

    fr_api = FlightRadar24API()
    # Base grid, plus a half-tile-shifted second pass over only the coarse tiles
    # (the big non-dense ones that can hit the per-request cap or drop planes on a
    # seam). fetch_flights_for_grid dedups the union by id.
    grid = build_bounds_grid(overlap=OVERLAP, overlap_coarse=OVERLAP_COARSE)
    grid += build_bounds_grid(
        overlap=OVERLAP,
        overlap_coarse=OVERLAP_COARSE,
        lat_shift=0.5,
        lon_shift=0.5,
        coarse_only=True,
    )
    flights, _ = fetch_flights_for_grid(
        fr_api,
        grid,
        f"adaptive grid ({OVERLAP}°/{OVERLAP_COARSE}° overlap, coarse re-scan)",
    )

    timestamp = int(time.time())
    payload = {"timestamp": timestamp, "flights": flights}

    archive_path = archive_dir / f"{timestamp}.json"
    archive_path.write_text(json.dumps(payload, indent=2))
    log.info("Saved %d flights → %s", len(flights), archive_path)

    airports = load_airports(airports_csv)
    longhaul = [f for f in flights if is_longhaul(f, airports)]
    dist_path = dist_dir / "flights.json"
    dist_path.write_text(json.dumps({"timestamp": timestamp, "flights": longhaul}))
    log.info("Updated %s  (%d/%d longhaul)", dist_path, len(longhaul), len(flights))

    traces = build_traces(archive_dir, longhaul)
    traces_path = dist_dir / "traces.json"
    traces_path.write_text(json.dumps({"timestamp": timestamp, "traces": traces}))
    log.info("Updated %s  (%d traces)", traces_path, len(traces))

    return dist_path


def main() -> None:
    from globular_adsb.config import AIRPORTS_CSV, ARCHIVE_DIR, DIST_DIR
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run(ARCHIVE_DIR, DIST_DIR, AIRPORTS_CSV)


if __name__ == "__main__":
    main()
