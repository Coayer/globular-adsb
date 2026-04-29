import * as solar from "https://esm.sh/solar-calculator";

export function getSunPosition(timestamp) {
    const midnight = new Date(+timestamp).setUTCHours(0, 0, 0, 0);
    const t = solar.century(timestamp);
    const longitude = ((midnight - timestamp) / 864e5) * 360 - 180;
    return [longitude - solar.equationOfTime(t) / 4, solar.declination(t)];
}
