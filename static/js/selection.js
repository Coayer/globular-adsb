import { globe } from './globe.js';
import { airports } from './airports.js';
import { state } from './state.js';

const arcKey = document.getElementById('arc-key');
const busiestKey = document.getElementById('busiest-key');
const busiestKeyBody = document.getElementById('busiest-key-body');
const busiestKeyToggle = document.getElementById('busiest-key-toggle');
const longestKey = document.getElementById('longest-key');
const longestKeyBody = document.getElementById('longest-key-body');
const longestKeyToggle = document.getElementById('longest-key-toggle');

const isMobile = window.innerWidth <= 600;
let busiestBodyOpen = !isMobile;
let longestBodyOpen = !isMobile;

function updateBusiestToggleText() {
    busiestKeyToggle.textContent = `busiest airports ${busiestBodyOpen ? '[-]' : '[+]'}`;
}
function updateLongestToggleText() {
    longestKeyToggle.textContent = `longest flights ${longestBodyOpen ? '[-]' : '[+]'}`;
}
updateBusiestToggleText();
updateLongestToggleText();
busiestKeyBody.classList.toggle('visible', busiestBodyOpen);
longestKeyBody.classList.toggle('visible', longestBodyOpen);

busiestKeyToggle.addEventListener('click', () => {
    busiestBodyOpen = !busiestBodyOpen;
    if (busiestBodyOpen && longestBodyOpen) {
        longestBodyOpen = false;
        longestKeyBody.classList.remove('visible');
        updateLongestToggleText();
    }
    busiestKeyBody.classList.toggle('visible', busiestBodyOpen);
    updateBusiestToggleText();
});
longestKeyToggle.addEventListener('click', () => {
    longestBodyOpen = !longestBodyOpen;
    if (longestBodyOpen && busiestBodyOpen) {
        busiestBodyOpen = false;
        busiestKeyBody.classList.remove('visible');
        updateBusiestToggleText();
    }
    longestKeyBody.classList.toggle('visible', longestBodyOpen);
    updateLongestToggleText();
});

export function closeBusiestKey() {
    busiestBodyOpen = false;
    busiestKeyBody.classList.remove('visible');
    updateBusiestToggleText();
}

export function closeLongestKey() {
    longestBodyOpen = false;
    longestKeyBody.classList.remove('visible');
    updateLongestToggleText();
}

export function refreshBusiestKey() {
    busiestKey.style.display =
        (state.busiestHasData && state.airportsEnabled && !state.timelapseIsPlaying) ? '' : 'none';
}

export function refreshLongestKey() {
    longestKey.style.display =
        (state.longestHasData && state.liveTrafficEnabled && !state.timelapseIsPlaying) ? '' : 'none';
}

function refreshObjectsData() {
    globe.pointsData([]);
    const selCallsign = state.selectedFlightPoint?.callsign;
    const flights = state.liveTrafficEnabled
        ? state.allFlights.filter(f => !selCallsign || f.callsign !== selCallsign)
        : [];
    const apObjs = state.airportsEnabled ? state.airportObjects : [];
    const sel = state.selectedFlightPoint ? [state.selectedFlightPoint] : [];
    globe.objectsData([...flights, ...apObjs, ...sel]);
}

export function updatePointsData() {
    refreshObjectsData();
}

export function clearSelection() {
    globe.arcsData([]);
    globe.labelsData([]);
    state.selectedFlightPoint = null;
    arcKey.style.display = 'none';
    updatePointsData();
}

export function selectFlight(flight) {
    console.log('Flight clicked:', flight);
    const origin = airports[flight.origin];
    if (!origin) return;

    const labels = [{ lat: origin.lat, lng: origin.lng, text: `${origin.name}, ${origin.region}, ${origin.countryCode}` }];
    const arcs = [];
    const dest = airports[flight.destination];

    if (dest) {
        labels.push({ lat: dest.lat, lng: dest.lng, text: `${dest.name}, ${dest.region}, ${dest.countryCode}` });
        arcs.push({ startLat: origin.lat, startLng: origin.lng, endLat: dest.lat, endLng: dest.lng });
    }

    globe.arcsData(arcs);
    globe.labelsData(labels);
    arcKey.style.display = 'none';
    state.selectedFlightPoint = {
        lat: flight.lat, lng: flight.lng,
        alt: flight.alt, heading: flight.heading,
        callsign: flight.callsign,
        aircraftCode: flight.aircraftCode,
        altitude: flight.altitude,
        groundSpeed: flight.groundSpeed,
        origin: flight.origin,
        destination: flight.destination,
        _type: 'selected_flight',
    };
    updatePointsData();
}

export function selectAirport(airport) {
    state.onTimelapseAirportClick?.();
    const code = airport._code;
    const ap = airports[code];
    if (!ap) return;

    const outboundCodes = new Set();
    const inboundCodes = new Set();
    for (const f of state.allFlights) {
        if (f.origin === code && f.destination && airports[f.destination]) outboundCodes.add(f.destination);
        if (f.destination === code && f.origin && airports[f.origin]) inboundCodes.add(f.origin);
    }

    const arcs = [];
    const labels = [{ lat: ap.lat, lng: ap.lng, text: `${code}: ${ap.name}`, _selected: true }];
    const labeledCodes = new Set();

    const allAdjacentCodes = new Set([...outboundCodes, ...inboundCodes]);
    const bothCount = [...allAdjacentCodes].filter(c => outboundCodes.has(c) && inboundCodes.has(c)).length;
    console.log(`${code}: ${outboundCodes.size} outbound, ${inboundCodes.size} inbound, ${bothCount} bidirectional`);

    for (const adjCode of allAdjacentCodes) {
        const adj = airports[adjCode];
        const isOut = outboundCodes.has(adjCode);
        const isIn = inboundCodes.has(adjCode);
        const direction = isOut && isIn ? 'both' : isOut ? 'outbound' : 'inbound';
        arcs.push({ startLat: ap.lat, startLng: ap.lng, endLat: adj.lat, endLng: adj.lng, _direction: direction });
        if (!labeledCodes.has(adjCode)) {
            labels.push({ lat: adj.lat, lng: adj.lng, text: `${adjCode}: ${adj.name}` });
            labeledCodes.add(adjCode);
        }
    }

    globe.arcsData(arcs);
    globe.labelsData(labels);
    arcKey.style.display = '';
    state.selectedFlightPoint = null;
    updatePointsData();
}
