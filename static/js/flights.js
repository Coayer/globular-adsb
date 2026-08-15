import { ASSETS_BASE, EARTH_RADIUS_KM, FEET_TO_KM } from './constants.js';
import { airports, haversineKm, computeAirportObjects } from './airports.js';
import { globe } from './globe.js';
import { state } from './state.js';
import { refreshBusiestKey, refreshLongestKey, selectAirport, selectFlight, closeBusiestKey, closeLongestKey } from './selection.js';

const isMobile = window.innerWidth <= 600;

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

// Stop overlapping trace lines from z-fighting (which flickers as the camera
// moves): keep depthTest on so the globe still hides back-side lines, but turn
// off depthWrite so the lines don't fight each other for depth. globe.gl rebuilds
// the path line objects on each pathsData() call, so this is re-applied after.
function stopPathZFighting() {
    globe.scene().traverse(obj => {
        const m = obj.material;
        if (m && (obj.isLine2 || obj.isLineSegments2 || obj.isLine) && m.depthWrite !== false) {
            m.depthWrite = false;
            m.transparent = true;
            m.needsUpdate = true;
        }
    });
}

// Round off the harsh corners between recorded trace points with a *centripetal*
// Catmull-Rom spline (knot spacing ∝ distance^0.5). Uniform Catmull-Rom overshoots
// into loops/hooks where point spacing is very uneven — e.g. a just-departed plane
// that barely moved between two snapshots then jumped — so centripetal is used to
// avoid that. Subdivision is adaptive: a segment is only split where the curve bows
// more than SMOOTH_TOL° from the straight chord, so straight cruise legs stay cheap
// while bends get detail. One-time pass on load, not per frame. Longitudes are
// unwrapped first so Pacific-crossing traces don't swing across the 180° seam.
const SMOOTH_TOL = 0.05; // deg; smaller = smoother + more points
const SMOOTH_MAX_DEPTH = 7;
const SMOOTH_ALPHA = 0.5; // 0.5 = centripetal

const _mix = (a, b, wa, wb) => [
    a[0] * wa + b[0] * wb,
    a[1] * wa + b[1] * wb,
    a[2] * wa + b[2] * wb,
];
const _dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); // lat/lon only

// Perpendicular distance (deg) from point p to the chord a-b, in lat/lon space.
function chordDist(p, a, b) {
    const dy = b[0] - a[0], dx = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dy + (p[1] - a[1]) * dx) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dy), p[1] - (a[1] + t * dx));
}

function smoothPath(pts) {
    if (pts.length < 3) return pts;
    const lon = [pts[0][1]];
    for (let i = 1; i < pts.length; i++) {
        let d = pts[i][1] - pts[i - 1][1];
        if (d > 180) d -= 360;
        else if (d < -180) d += 360;
        lon.push(lon[i - 1] + d);
    }
    // Drop near-duplicate consecutive points so knot spacings can't degenerate.
    let P = [[pts[0][0], lon[0], pts[0][2]]];
    for (let i = 1; i < pts.length; i++) {
        const p = [pts[i][0], lon[i], pts[i][2]];
        if (_dist(p, P[P.length - 1]) > 1e-4) P.push(p);
    }
    const rewrap = p => [p[0], ((p[1] + 180) % 360 + 360) % 360 - 180, p[2]];
    if (P.length < 3) return P.map(rewrap);

    const at = i => P[Math.max(0, Math.min(P.length - 1, i))];
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        const k = (t, a, b) => t + Math.pow(Math.max(_dist(a, b), 1e-6), SMOOTH_ALPHA);
        const t0 = 0, t1 = k(t0, p0, p1), t2 = k(t1, p1, p2), t3 = k(t2, p2, p3);
        // Barry-Goldman evaluation of the non-uniform Catmull-Rom segment [t1,t2].
        const C = t => {
            const a1 = _mix(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
            const a2 = _mix(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
            const a3 = _mix(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
            const b1 = _mix(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
            const b2 = _mix(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
            return _mix(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
        };
        const cr = u => C(t1 + u * (t2 - t1));
        out.push(rewrap(p1)); // segment start (interior points added once)
        (function split(u0, u1, c0, c1, depth) {
            const um = (u0 + u1) / 2, cm = cr(um);
            if (depth < SMOOTH_MAX_DEPTH && chordDist(cm, c0, c1) > SMOOTH_TOL) {
                split(u0, um, c0, cm, depth + 1);
                out.push(rewrap(cm));
                split(um, u1, cm, c1, depth + 1);
            }
        })(0, 1, p1, cr(1), 0);
    }
    out.push(rewrap(P[P.length - 1])); // end exactly at the aircraft's position
    return out;
}

// Draw a polyline for each current flight that has a matching trace. Flights
// without a trace are simply skipped (and traces without a flight ignored).
export function updateTracePaths() {
    const paths = state.tracesEnabled
        ? state.allFlights
              .filter(f => state.traces[f.callsign])
              .map(f => ({ points: smoothPath(state.traces[f.callsign]) }))
        : [];
    globe.pathsData(paths);
    // The line objects finish building on the next frame, so patch them then
    // (and once more shortly after, in case the build spans a couple of frames).
    requestAnimationFrame(stopPathZFighting);
    setTimeout(stopPathZFighting, 150);
}

export function fetchTraces() {
    return fetch(`${ASSETS_BASE}/traces.json?t=${Date.now()}`)
        .then(r => r.json())
        .then(data => {
            state.traces = data.traces || {};
            updateTracePaths();
        });
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
        btn.textContent = '❯';
        btn.title = `Select ${code}`;
        const handler = () => {
            const ap = airports[code];
            selectAirport({ _code: code });
            if (ap) globe.pointOfView({ lat: ap.lat, lng: ap.lng, altitude: 2.0 }, 1000);
            if (isMobile) closeBusiestKey();
        };
        row.addEventListener('click', handler);
        btn.addEventListener('click', e => e.stopPropagation());
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
        btn.textContent = '❯';
        btn.title = `Select ${f.callsign || f.origin + '→' + f.destination}`;
        const handler = () => {
            selectFlight(f);
            globe.pointOfView({ lat: f.lat, lng: f.lng, altitude: 2.0 }, 1000);
            if (isMobile) closeLongestKey();
        };
        row.addEventListener('click', handler);
        btn.addEventListener('click', e => e.stopPropagation());
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
            state.allFlights = data.flights.map(f => ({
                lat: f.latitude,
                lng: f.longitude,
                alt: (f.altitude * FEET_TO_KM) / EARTH_RADIUS_KM + Math.random() * 0.001,
                callsign: f.callsign,
                aircraftCode: f.aircraftCode,
                altitude: f.altitude,
                groundSpeed: f.groundSpeed,
                origin: f.originAirportIata,
                destination: f.destinationAirportIata,
                heading: f.heading,
            }));
            console.log('Flights loaded:', state.allFlights.length);
            if (state.airportsEnabled) state.airportObjects = computeAirportObjects(state.allFlights);
            updateObjectsData();
            updateBusiestAirports();
            updateLongestFlights();
            if (state.tracesEnabled) fetchTraces();
        });
}
