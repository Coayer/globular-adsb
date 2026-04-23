import json
import time
import pytest
from pathlib import Path


@pytest.fixture
def archive_dir(tmp_path: Path) -> Path:
    d = tmp_path / "archive"
    d.mkdir()
    return d


@pytest.fixture
def airports_csv(tmp_path: Path) -> Path:
    path = tmp_path / "airports.csv"
    path.write_text(
        "US,NY,JFK,John F Kennedy Intl,40.6398,-73.7789\n"
        "GB,ENG,LHR,Heathrow,51.4775,-0.4614\n"
        "JP,TK,NRT,Narita Intl,35.7647,140.3864\n"
        "AU,NSW,SYD,Sydney Kingsford Smith,-33.9461,151.1772\n"
        "SG,01,SIN,Singapore Changi,1.3502,103.9943\n"
    )
    return path


@pytest.fixture
def sample_flights() -> list[dict]:
    return [
        {
            "latitude": 51.0,
            "longitude": -30.0,
            "heading": 270,
            "altitude": 35000,
            "groundSpeed": 500,
            "aircraftCode": "B77W",
            "originAirportIata": "JFK",
            "destinationAirportIata": "LHR",
            "callsign": "TEST001",
        },
        {
            "latitude": 20.0,
            "longitude": 100.0,
            "heading": 90,
            "altitude": 38000,
            "groundSpeed": 520,
            "aircraftCode": "A388",
            "originAirportIata": "LHR",
            "destinationAirportIata": "SIN",
            "callsign": "TEST002",
        },
        # Short-haul — should be skipped by heatmap
        {
            "latitude": 51.5,
            "longitude": -0.1,
            "heading": 0,
            "altitude": 10000,
            "groundSpeed": 200,
            "aircraftCode": "A320",
            "originAirportIata": "LHR",
            "destinationAirportIata": "JFK",
            "callsign": "TEST003",
        },
    ]


@pytest.fixture
def archive_with_flights(archive_dir: Path, sample_flights: list[dict]) -> Path:
    ts = int(time.time())
    payload = {"timestamp": ts, "flights": sample_flights}
    (archive_dir / f"{ts}.json").write_text(json.dumps(payload))
    return archive_dir
