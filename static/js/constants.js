const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const ASSETS_BASE = isLocal ? '' : 'https://globular-adsb-assets.copey.dev';
export const EARTH_RADIUS_KM = 6371;
export const FEET_TO_KM = 0.0003048;

// Altitude (feet) range mapped onto the trace colour scale. Tightened to the
// band where long-haul cruise altitudes actually vary (most points sit in
// 33k-39k ft), so a couple-thousand-foot difference swings the whole gradient
// instead of everything crushing into the red end.
export const ALT_COLOR_MIN = 32000;
export const ALT_COLOR_MAX = 40000;

// Same blue -> cyan -> yellow -> red gradient as the heatmap colormap
// (see heatmap.py density_to_rgba); red = highest altitude.
const ALT_STOPS = [
    [0, 0, 255], // blue
    [0, 255, 255], // cyan
    [255, 255, 0], // yellow
    [255, 0, 0], // red
];

// `brightness` (0..1) scales the RGB toward black. globe.gl's fat-line paths
// ignore per-vertex alpha, so fading toward black is how we taper a trace's tail
// to nothing against the dark map.
export function altitudeToColor(ft, brightness = 1) {
    const span = ALT_COLOR_MAX - ALT_COLOR_MIN;
    const t = Math.max(0, Math.min(1, (ft - ALT_COLOR_MIN) / span));
    const pos = t * (ALT_STOPS.length - 1);
    const i = Math.min(Math.floor(pos), ALT_STOPS.length - 2);
    const frac = pos - i;
    const [r0, g0, b0] = ALT_STOPS[i];
    const [r1, g1, b1] = ALT_STOPS[i + 1];
    const r = Math.round((r0 + frac * (r1 - r0)) * brightness);
    const g = Math.round((g0 + frac * (g1 - g0)) * brightness);
    const b = Math.round((b0 + frac * (b1 - b0)) * brightness);
    return `rgb(${r},${g},${b})`;
}
