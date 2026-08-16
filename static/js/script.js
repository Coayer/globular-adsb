import { globe, isMobile } from './globe.js';
import { loadAirports, computeAirportObjects } from './airports.js';
import { state } from './state.js';
import { clearSelection, selectFlight, selectAirport, refreshBusiestKey } from './selection.js';
import { refreshFlights, updateObjectsData, fetchTraces, updateTracePaths, fetchHubs24h } from './flights.js';
import { initHeatmap, heatmapView } from './heatmap.js';
import { initAutopilot } from './autopilot.js';

const recenterBtn = document.getElementById('recenter-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
let userLocation = null;
let uiHidden = false;

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            userLocation = { lat: coords.latitude, lng: coords.longitude };
            globe.pointOfView(userLocation);
            recenterBtn.classList.add('visible');
        },
        err => console.warn('Geolocation error:', err)
    );
}

recenterBtn.addEventListener('click', () => {
    if (userLocation) {
        globe.pointOfView({ lat: userLocation.lat, lng: userLocation.lng, altitude: isMobile ? 4.0 : 2 }, 1000);
    }
});

fullscreenBtn.addEventListener('click', () => {
    uiHidden = !uiHidden;
    document.body.classList.toggle('ui-hidden', uiHidden);
    fullscreenBtn.classList.toggle('active', uiHidden);
    fullscreenBtn.innerHTML = uiHidden
        ? '✕<span class="fullscreen-text"> EXIT</span>'
        : '⛶<span class="fullscreen-text"> FULL</span>';
});

globe
    .onGlobeClick(clearSelection)
    .onObjectClick(d => d._type === 'airport' ? selectAirport(d) : selectFlight(d));

document.getElementById('airports-toggle').addEventListener('change', e => {
    state.airportsEnabled = e.target.checked;
    state.airportObjects = state.airportsEnabled ? computeAirportObjects(state.allFlights) : [];
    updateObjectsData();
    refreshBusiestKey();
});

document.getElementById('traces-toggle').addEventListener('change', e => {
    state.tracesEnabled = e.target.checked;
    if (state.tracesEnabled) {
        // Show the plain dark map (no heatmap overlay) so traces read clearly.
        heatmapView.enterTracesMode?.();
        // Only fetch traces.json once the user opts in, to save bandwidth.
        fetchTraces();
    } else {
        updateTracePaths();
        heatmapView.exitTracesMode?.();
    }
});

loadAirports();
refreshFlights();
setInterval(refreshFlights, 15 * 60 * 1000);
// Regenerated once an hour by the render tick, so there is nothing to gain
// from polling it at the 15-minute flight cadence.
fetchHubs24h();
setInterval(fetchHubs24h, 60 * 60 * 1000);
initHeatmap();
initAutopilot();
