import { globe, isMobile } from './globe.js';
import { loadAirports, computeAirportObjects } from './airports.js';
import { state } from './state.js';
import { clearSelection, selectFlight, selectAirport, refreshBusiestKey } from './selection.js';
import { refreshFlights, updateObjectsData } from './flights.js';
import { initHeatmap } from './heatmap.js';
import { initAutopilot } from './autopilot.js';

const recenterBtn = document.getElementById('recenter-btn');
const recenterSep = document.getElementById('recenter-sep');
let userLocation = null;

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            userLocation = { lat: coords.latitude, lng: coords.longitude };
            globe.pointOfView(userLocation);
            recenterBtn.classList.add('visible');
            recenterSep.style.display = '';
        },
        err => console.warn('Geolocation error:', err)
    );
}

recenterBtn.addEventListener('click', () => {
    if (userLocation) {
        globe.pointOfView({ lat: userLocation.lat, lng: userLocation.lng, altitude: isMobile ? 4.0 : 2 }, 1000);
    }
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

loadAirports();
refreshFlights();
setInterval(refreshFlights, 15 * 60 * 1000);
initHeatmap();
initAutopilot();
