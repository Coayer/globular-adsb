#!/usr/bin/env python3
"""Standalone archive collector — run with: nohup python collect_archive.py &
Writes timestamped JSON files to ./archive/ every INTERVAL_MINUTES minutes.
Only dependency beyond stdlib: flightradarapi  (pip install flightradarapi schedule)
"""

import json
import os
import time
from pathlib import Path

import schedule
from FlightRadar24.api import FlightRadar24API

ARCHIVE_DIR = Path(os.getenv("ARCHIVE_DIR", "archive"))
INTERVAL_MINUTES = int(os.getenv("INTERVAL_MINUTES", "15"))

LAT_STEP = 30
LON_STEP = 60
OVERLAP = 10


def build_grid() -> list[str]:
    bounds = []
    lat = 85
    while lat > -85:
        lat_bottom = max(lat - LAT_STEP, -85)
        lon = -180
        while lon < 180:
            lon_right = min(lon + LON_STEP, 180)
            bounds.append(
                f"{min(lat + OVERLAP, 85)},{max(lat_bottom - OVERLAP, -85)},"
                f"{max(lon - OVERLAP, -180)},{min(lon_right + OVERLAP, 180)}"
            )
            lon = lon_right
        lat = lat_bottom
    return bounds


def collect() -> None:
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Fetching flights…")
    fr_api = FlightRadar24API()
    grid = build_grid()
    seen: set[str] = set()
    flights: list[dict] = []

    for i, bounds in enumerate(grid, 1):
        try:
            results = fr_api.get_flights(bounds=bounds)
            new = 0
            for f in results:
                if f.id not in seen:
                    seen.add(f.id)
                    flights.append({
                        "latitude": f.latitude,
                        "longitude": f.longitude,
                        "heading": f.heading,
                        "altitude": f.altitude,
                        "groundSpeed": f.ground_speed,
                        "aircraftCode": f.aircraft_code,
                        "originAirportIata": f.origin_airport_iata,
                        "destinationAirportIata": f.destination_airport_iata,
                        "callsign": f.callsign,
                    })
                    new += 1
            print(f"  [{i}/{len(grid)}] {new} new / {len(results)} raw")
        except Exception as e:
            print(f"  [{i}/{len(grid)}] error — {e}")

    timestamp = int(time.time())
    ARCHIVE_DIR.mkdir(exist_ok=True)
    out = ARCHIVE_DIR / f"{timestamp}.json"
    out.write_text(json.dumps({"timestamp": timestamp, "flights": flights}))
    print(f"Saved {len(flights)} flights → {out}")



if __name__ == "__main__":
    print(f"Archive collector — every {INTERVAL_MINUTES}m → {ARCHIVE_DIR}/")
    collect()
    schedule.every(INTERVAL_MINUTES).minutes.do(collect)
    while True:
        schedule.run_pending()
        time.sleep(1)
