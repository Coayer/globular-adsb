import { ASSETS_BASE, EARTH_RADIUS_KM, FEET_TO_KM } from './constants.js';
import { airports, haversineKm, computeAirportObjects } from './airports.js';
import { globe } from './globe.js';
import { state } from './state.js';
import { refreshBusiestKey, refreshLongestKey, selectAirport, selectFlight } from './selection.js';

const timeDisplay = document.getElementById('time');
const busiestKeyBody = document.getElementById('busiest-key-body');
const longestKeyBody = document.getElementById('longest-key-body');

export function updateObjectsData() {
    const selCallsign = state.selectedFlightPoint?.callsign;
    const flights = state.liveTrafficEnabled
        ? state.allFlights.filter(f => !selCallsign || f.callsign !== selCallsign)
        : [];
    const apObjs = state.airportsEnabled ? state.airportObjects : [];
    const sel = state.selectedFlightPoint ? [state.selectedFlightPoint] : [];
    globe.objectsData([...flights, ...apObjs, ...sel]);
}

export function updateBusiestAirports() {
    const counts = {};
    for (const f of state.allFlights) {
        if (f.origin && airports[f.origin]) {
            if (!counts[f.origin]) counts[f.origin] = { out: 0, in: 0 };
            counts[f.origin].out++;
        }
        if (f.destination && airports[f.destination]) {
            if (!counts[f.destination]) counts[f.destination] = { out: 0, in: 0 };
            counts[f.destination].in++;
        }
    }

    const sorted = Object.entries(counts)
        .map(([code, c]) => ({ code, out: c.out, in: c.in, total: c.out + c.in }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    busiestKeyBody.innerHTML = '';
    for (let i = 0; i < sorted.length; i++) {
        const { code, out } = sorted[i];
        const row = document.createElement('div');
        row.className = 'busiest-row';
        row.innerHTML = `<span class="busiest-rank">${i + 1}</span><span class="busiest-code">${code}</span><span class="busiest-out">↑${out}</span><span class="busiest-in">↓${sorted[i].in}</span>`;
        const btn = document.createElement('button');
        btn.className = 'busiest-select-btn';
        btn.textContent = '→';
        btn.title = `Select ${code}`;
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const ap = airports[code];
            selectAirport({ _code: code });
            if (ap) globe.pointOfView({ lat: ap.lat, lng: ap.lng, altitude: 2.0 }, 1000);
        });
        row.appendChild(btn);
        busiestKeyBody.appendChild(row);
    }

    state.busiestHasData = sorted.length > 0;
    refreshBusiestKey();
}

export function updateLongestFlights() {
    const withDist = state.allFlights
        .filter(f => airports[f.origin] && airports[f.destination])
        .map(f => {
            const orig = airports[f.origin];
            const dest = airports[f.destination];
            return { ...f, dist: haversineKm(orig.lat, orig.lng, dest.lat, dest.lng) };
        })
        .sort((a, b) => b.dist - a.dist)
        .slice(0, 10);

    longestKeyBody.innerHTML = '';
    for (let i = 0; i < withDist.length; i++) {
        const f = withDist[i];
        const row = document.createElement('div');
        row.className = 'busiest-row';
        row.innerHTML = `<span class="busiest-rank">${i + 1}</span><span class="longest-dist">${Math.round(f.dist).toLocaleString()}km</span><span class="flight-route">${f.origin}→${f.destination}</span>`;
        const btn = document.createElement('button');
        btn.className = 'busiest-select-btn';
        btn.textContent = '→';
        btn.title = `Select ${f.callsign || f.origin + '→' + f.destination}`;
        btn.addEventListener('click', e => {
            e.stopPropagation();
            selectFlight(f);
            globe.pointOfView({ lat: f.lat, lng: f.lng, altitude: 2.0 }, 1000);
        });
        row.appendChild(btn);
        longestKeyBody.appendChild(row);
    }

    state.longestHasData = withDist.length > 0;
    refreshLongestKey();
}

export function refreshFlights() {
    fetch(`${ASSETS_BASE}/flights.json?t=${Date.now()}`)
        .then(r => r.json())
        .then(data => {
            if (data.timestamp) {
                const ts = new Date(data.timestamp * 1000);
                timeDisplay.textContent = `Traffic updated: ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
            }
            state.allFlights = data.flights.map(f => ({
                lat: f.latitude,
                lng: f.longitude,
                alt: (f.altitude * FEET_TO_KM) / EARTH_RADIUS_KM + Math.random() * 0.001,
                callsign: f.callsign,
                aircraftCode: f.aircraftCode,
                origin: f.originAirportIata,
                destination: f.destinationAirportIata,
                heading: f.heading,
            }));
            console.log('Flights loaded:', state.allFlights.length);
            if (state.airportsEnabled) state.airportObjects = computeAirportObjects(state.allFlights);
            updateObjectsData();
            updateBusiestAirports();
            updateLongestFlights();
        });
}
