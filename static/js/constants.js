const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const ASSETS_BASE = isLocal ? '' : 'https://globular-adsb-assets.copey.dev';
export const EARTH_RADIUS_KM = 6371;
export const FEET_TO_KM = 0.0003048;
