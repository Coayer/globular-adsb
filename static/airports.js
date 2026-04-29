import { ASSETS_BASE } from './constants.js';

export const airports = {};

export async function loadAirports() {
    const r = await fetch(`${ASSETS_BASE}/airports.csv`);
    const csv = await r.text();
    csv.trim().split('\n').forEach(line => {
        const parts = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
        if (!parts || parts.length < 6) return;
        const [country, region, code, name, lat, lng] = parts.map(v => v.replace(/"/g, ''));
        airports[code] = { name, region, countryCode: country, lat: parseFloat(lat), lng: parseFloat(lng) };
    });
    console.log('Airports loaded:', Object.keys(airports).length);
}

export function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

export function computeAirportObjects(allFlights) {
    const seen = new Set();
    for (const f of allFlights) {
        if (f.origin && f.destination) {
            seen.add(f.origin);
            seen.add(f.destination);
        }
    }
    return [...seen]
        .filter(code => airports[code])
        .map(code => {
            const a = airports[code];
            return { lat: a.lat, lng: a.lng, alt: 0, _type: 'airport', _code: code, _name: a.name };
        });
}
