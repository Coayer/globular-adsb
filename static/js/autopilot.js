import { globe } from './globe.js';
import { airports } from './airports.js';
import { state } from './state.js';
import { selectFlight, selectAirport } from './selection.js';

let autopilotTimeout = null;
let autopilotSpinning = false;
let autopilotAirportPrev = null;
let autopilotNextAirport = null;

let spinLng = 0;
let spinCurrentLat = 40;
let spinTargetLat = 40;
let spinRawTargetLat = 40;
let spinRaf = null;
let spinLatTimer = null;
let spinPaused = false;

function centroidLatNear(centerLng, lngWindow = 80, minCount = 10) {
    const inWindow = state.allFlights.filter(f => {
        let d = Math.abs(f.lng - centerLng) % 360;
        if (d > 180) d = 360 - d;
        return d <= lngWindow;
    });
    const src = inWindow.length >= minCount ? inWindow : state.allFlights;
    if (!src.length) return 40;
    return src.reduce((s, f) => s + f.lat, 0) / src.length;
}

function onSpinPointerDown() { spinPaused = true; }
function onSpinPointerUp() {
    const pov = globe.pointOfView();
    spinLng = pov.lng;
    spinCurrentLat = pov.lat;
    spinTargetLat = pov.lat;
    spinRawTargetLat = centroidLatNear(spinLng);
    spinPaused = false;
}

function doSpinFrame() {
    if (!autopilotSpinning) return;
    if (!spinPaused) {
        spinLng = (spinLng + 0.07) % 360;
        spinTargetLat += (spinRawTargetLat - spinTargetLat) * 0.025;
        spinCurrentLat += (spinTargetLat - spinCurrentLat) * 0.022;
        globe.pointOfView({ lat: spinCurrentLat, lng: spinLng, altitude: 2.0 });
    }
    spinRaf = requestAnimationFrame(doSpinFrame);
}

function startManualSpin() {
    if (spinRaf) return;
    const pov = globe.pointOfView();
    spinLng = pov.lng;
    spinCurrentLat = pov.lat;
    spinRawTargetLat = centroidLatNear(spinLng);
    spinTargetLat = spinRawTargetLat;
    globe.controls().autoRotate = false;
    spinLatTimer = setInterval(() => { spinRawTargetLat = centroidLatNear(spinLng); }, 1500);
    globe.renderer().domElement.addEventListener('pointerdown', onSpinPointerDown);
    window.addEventListener('pointerup', onSpinPointerUp);
    doSpinFrame();
}

function stopManualSpin() {
    cancelAnimationFrame(spinRaf);
    spinRaf = null;
    clearInterval(spinLatTimer);
    spinLatTimer = null;
    spinPaused = false;
    globe.renderer().domElement.removeEventListener('pointerdown', onSpinPointerDown);
    window.removeEventListener('pointerup', onSpinPointerUp);
}

function autopilotStep() {
    const toRad = d => (d * Math.PI) / 180;

    if (state.airportsEnabled && state.liveTrafficEnabled) {
        autopilotSpinning = false;
        stopManualSpin();

        let airport = autopilotNextAirport;
        const alreadyThere = !!airport;
        autopilotNextAirport = null;

        if (!airport) {
            const candidates = state.airportObjects.filter(a =>
                state.allFlights.some(f => f.origin === a._code && f.destination && airports[f.destination])
            );
            if (!candidates.length) {
                autopilotTimeout = setTimeout(autopilotStep, 3000);
                return;
            }
            const notPrev = candidates.filter(a => a._code !== autopilotAirportPrev);
            const pool = notPrev.length ? notPrev : candidates;
            airport = pool[Math.floor(Math.random() * pool.length)];
        }

        selectAirport(airport);
        globe.pointOfView({ lat: airport.lat, lng: airport.lng, altitude: 2.0 }, alreadyThere ? 0 : 2000);

        autopilotTimeout = setTimeout(() => {
            const adjacentCodes = [...new Set(
                state.allFlights
                    .filter(f => f.origin === airport._code && f.destination && airports[f.destination])
                    .map(f => f.destination)
            )];

            if (!adjacentCodes.length) {
                autopilotAirportPrev = null;
                autopilotNextAirport = null;
                autopilotTimeout = setTimeout(autopilotStep, 2000);
                return;
            }

            const notPrev = adjacentCodes.filter(c => c !== autopilotAirportPrev);
            const pool = notPrev.length ? notPrev : adjacentCodes;
            const adjacentCode = pool[Math.floor(Math.random() * pool.length)];
            const dest = airports[adjacentCode];

            const lat1 = toRad(airport.lat), lat2 = toRad(dest.lat);
            const dlat = lat2 - lat1, dlng = toRad(dest.lng - airport.lng);
            const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
            const angularDist = (2 * Math.asin(Math.sqrt(a)) * 180) / Math.PI;
            const panDuration = Math.min(7000, Math.max(2000, angularDist * 50));

            autopilotAirportPrev = airport._code;
            autopilotNextAirport = state.airportObjects.find(a => a._code === adjacentCode) || null;

            globe.labelsData(globe.labelsData().map(l =>
                l.lat === dest.lat && l.lng === dest.lng ? { ...l, _selected: true } : l
            ));
            globe.pointOfView({ lat: dest.lat, lng: dest.lng, altitude: 2.0 }, panDuration);
            autopilotTimeout = setTimeout(autopilotStep, panDuration + 500);
        }, alreadyThere ? 1500 : 2800);

        return;
    }

    const flights = globe.objectsData() || [];
    const eligible = flights.filter(f => airports[f.origin] && airports[f.destination]);
    if (!eligible.length) {
        if (state.heatmapEnabled && !state.liveTrafficEnabled) {
            if (!autopilotSpinning) {
                autopilotSpinning = true;
                startManualSpin();
            }
        }
        autopilotTimeout = setTimeout(autopilotStep, 3000);
        return;
    }
    autopilotSpinning = false;
    stopManualSpin();

    const flight = eligible[Math.floor(Math.random() * eligible.length)];
    selectFlight(flight);

    const origin = airports[flight.origin];
    const dest = airports[flight.destination];

    const lat1 = toRad(origin.lat), lat2 = toRad(dest.lat);
    const dlat = lat2 - lat1, dlng = toRad(dest.lng - origin.lng);
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
    const angularDist = (2 * Math.asin(Math.sqrt(a)) * 180) / Math.PI;
    const panDuration = Math.min(7000, Math.max(2000, angularDist * 50));

    globe.pointOfView({ lat: origin.lat, lng: origin.lng, altitude: 1.5 }, 2000);
    autopilotTimeout = setTimeout(() => {
        globe.pointOfView({ lat: dest.lat, lng: dest.lng, altitude: 1.5 }, panDuration);
        autopilotTimeout = setTimeout(autopilotStep, panDuration + 1000);
    }, 2500);
}

export function initAutopilot() {
    document.getElementById('autopilot-toggle').addEventListener('change', e => {
        if (e.target.checked) {
            autopilotStep();
        } else {
            clearTimeout(autopilotTimeout);
            autopilotTimeout = null;
            autopilotSpinning = false;
            autopilotAirportPrev = null;
            autopilotNextAirport = null;
            stopManualSpin();
        }
    });
}
