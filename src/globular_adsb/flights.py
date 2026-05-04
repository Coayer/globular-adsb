import csv
import json
import logging
import math
import time
from pathlib import Path

from FlightRadar24.api import FlightRadar24API

log = logging.getLogger(__name__)

LAT_STEP = 15
LON_STEP = 30
OVERLAP = 5
DIST_MIN = 3700
DIST_MAX = 8000
SPEED_MIN = 300


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


def build_bounds_grid(overlap: float = 0) -> list[str]:
    """Return "y1,y2,x1,x2" strings tiling the globe with optional overlap."""
    bounds = []
    lat = 85
    while lat > -85:
        lat_bottom = max(lat - LAT_STEP, -85)
        lon = -180
        while lon < 180:
            lon_right = min(lon + LON_STEP, 180)
            y1 = min(lat + overlap, 85)
            y2 = max(lat_bottom - overlap, -85)
            x1 = max(lon - overlap, -180)
            x2 = min(lon_right + overlap, 180)
            bounds.append(f"{y1},{y2},{x1},{x2}")
            lon = lon_right
        lat = lat_bottom
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
        try:
            results = fr_api.get_flights(bounds=bounds)
            total_raw += len(results)
            new = 0
            for f in results:
                if f.id not in seen_ids:
                    seen_ids.add(f.id)
                    flights.append(
                        {
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
        except Exception as e:
            log.error("[%d/%d] error — %s", i, len(grid), e)

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


def run(archive_dir: Path, dist_dir: Path, airports_csv: Path) -> Path:
    """Fetch flights, write a timestamped archive file, and update dist/flights.json."""
    archive_dir.mkdir(exist_ok=True)
    dist_dir.mkdir(exist_ok=True)

    purge_old_archives(archive_dir)

    fr_api = FlightRadar24API()
    grid = build_bounds_grid(overlap=OVERLAP)
    flights, _ = fetch_flights_for_grid(fr_api, grid, f"{OVERLAP}° overlap")

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

    return dist_path


def main() -> None:
    from globular_adsb.config import AIRPORTS_CSV, ARCHIVE_DIR, DIST_DIR
    from globular_adsb.pipeline import _LOG_DATE, _LOG_FORMAT

    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt=_LOG_DATE)
    run(ARCHIVE_DIR, DIST_DIR, AIRPORTS_CSV)


if __name__ == "__main__":
    main()
