import {
    TextureLoader,
    ShaderMaterial,
    Vector2,
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    Mesh,
    DoubleSide,
} from "https://esm.sh/three";
import * as solar from "https://esm.sh/solar-calculator";
import * as THREE from "https://esm.sh/three";

// Constants
const FRAME_RATE_SCALE = 1 / 60;
const ASSETS_BASE = location.hostname !== 'localhost'
    ? 'https://globular-adsb-assets.copey.dev'
    : '';
const EARTH_RADIUS_KM = 6371;
const FEET_TO_KM = 0.0003048;

// Day/Night blending shader
const dayNightShader = {
    vertexShader: `
                varying vec3 vNormal;
                varying vec2 vUv;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
    fragmentShader: `
                #define PI 3.141592653589793

                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec2 sunPosition;
                uniform vec2 globeRotation;

                varying vec3 vNormal;
                varying vec2 vUv;

                float toRad(float a) {
                    return a * PI / 180.0;
                }

                vec3 polarToCartesian(vec2 c) {
                    float theta = toRad(90.0 - c.x);
                    float phi = toRad(90.0 - c.y);

                    return vec3(
                        sin(phi) * cos(theta),
                        cos(phi),
                        sin(phi) * sin(theta)
                    );
                }

                void main() {
                    float invLon = toRad(globeRotation.x);
                    float invLat = -toRad(globeRotation.y);

                    mat3 rotX = mat3(
                        1, 0, 0,
                        0, cos(invLat), -sin(invLat),
                        0, sin(invLat),  cos(invLat)
                    );

                    mat3 rotY = mat3(
                        cos(invLon), 0, sin(invLon),
                        0, 1, 0,
                        -sin(invLon), 0, cos(invLon)
                    );

                    vec3 rotatedSun = rotX * rotY * polarToCartesian(sunPosition);
                    float intensity = dot(normalize(vNormal), normalize(rotatedSun));

                    vec4 day   = texture2D(dayTexture,   vUv);
                    vec4 night = texture2D(nightTexture, vUv);

                    float blend = smoothstep(-0.1, 0.1, intensity);

                    gl_FragColor = mix(night, day, blend);
                }
            `,
};

// Solar position helper
const getSunPosition = (timestamp) => {
    const midnight = new Date(+timestamp).setUTCHours(0, 0, 0, 0);
    const t = solar.century(timestamp);
    const longitude = ((midnight - timestamp) / 864e5) * 360 - 180;

    return [longitude - solar.equationOfTime(t) / 4, solar.declination(t)];
};

let now = Date.now();
const timeDisplay = document.getElementById("time");

// Airport lookup table
const airports = {};

// Load airport CSV
fetch(`${ASSETS_BASE}/airports.csv`)
    .then((r) => r.text())
    .then((csv) => {
        csv.trim()
            .split("\n")
            .forEach((line) => {
                const parts = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
                if (!parts || parts.length < 6) return;

                const [country, region, code, name, lat, lng] = parts.map((v) =>
                    v.replace(/"/g, "")
                );

                airports[code] = {
                    name,
                    region,
                    countryCode: country,
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                };
            });

        console.log("Airports loaded:", Object.keys(airports).length);
    });

// Initialize globe
const globe = new Globe(document.getElementById("globeViz"))
    .pointOfView({ lat: 35, lng: -25 })
    .objectLat("lat")
    .objectLng("lng")
    .objectAltitude("alt")
    .objectLabel("callsign")
    .objectThreeObject((flight) => {
        // Create simple aircraft marker (triangle)
        const geometry = new BufferGeometry();
        const thickness = 0.05;
        const verts = new Float32Array([
            // Front face
            0,
            0.7,
            thickness,
            -0.42,
            -0.7,
            thickness,
            0.42,
            -0.7,
            thickness,
            // Back face
            0,
            0.7,
            -thickness,
            -0.42,
            -0.7,
            -thickness,
            0.42,
            -0.7,
            -thickness,
        ]);

        geometry.setAttribute("position", new BufferAttribute(verts, 3));

        const material = new MeshBasicMaterial({
            color: "orange",
            side: DoubleSide,
        });

        const mesh = new Mesh(geometry, material);

        if (flight.heading !== undefined) {
            mesh.rotation.z = (-flight.heading * Math.PI) / 180;
        }

        return mesh;
    })
    .objectFacesSurface(true)
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcColor(() => "cyan")
    .arcStroke(0.5)
    .arcAltitudeAutoScale(0.3)
    .onGlobeClick(() => {
        globe.arcsData([]);
        globe.labelsData([]);
        globe.pointsData([]);
    })
    .labelLat((d) => d.lat)
    .labelLng((d) => d.lng)
    .labelText((d) => d.text)
    .labelColor(() => "lightblue")
    .labelSize(0.8)
    .labelDotRadius(0.15)
    .labelAltitude(0.01);

// Try to center on user
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            globe.pointOfView({
                lat: coords.latitude,
                lng: coords.longitude,
            });
        },
        (err) => console.warn("Geolocation error:", err)
    );
}

const timestamp = new Date().getTime();
// Load flights with cache buster
fetch(`${ASSETS_BASE}/flights.json?t=${timestamp}`)
    .then((r) => r.json())
    .then((data) => {
        if (data.timestamp) {
            const ts = new Date(data.timestamp * 1000);
            timeDisplay.textContent = `Data last updated: ${String(
                ts.getUTCHours()
            ).padStart(2, "0")}:${String(ts.getUTCMinutes()).padStart(
                2,
                "0"
            )} UTC`;
        }

        const flightObjects = data.flights.map((f) => ({
            lat: f.latitude,
            lng: f.longitude,
            alt:
                (f.altitude * FEET_TO_KM) / EARTH_RADIUS_KM +
                Math.random() * 0.001,
            callsign: f.callsign,
            aircraftCode: f.aircraftCode,
            origin: f.originAirportIata,
            destination: f.destinationAirportIata,
            heading: f.heading,
        }));

        console.log("Flights loaded:", flightObjects.length);
        globe.objectsData(flightObjects);
    });

// Flight click behavior
function selectFlight(flight) {
    console.log("Flight clicked:", flight);

    const origin = airports[flight.origin];
    if (!origin) return;

    const labels = [
        {
            lat: origin.lat,
            lng: origin.lng,
            text: `${origin.name}, ${origin.region}, ${origin.countryCode}`,
        },
    ];

    const arcs = [];
    const dest = airports[flight.destination];

    if (dest) {
        labels.push({
            lat: dest.lat,
            lng: dest.lng,
            text: `${dest.name}, ${dest.region}, ${dest.countryCode}`,
        });

        arcs.push({
            startLat: origin.lat,
            startLng: origin.lng,
            endLat: dest.lat,
            endLng: dest.lng,
        });
    }

    globe.arcsData(arcs);
    globe.labelsData(labels);
    globe.pointsData([{ lat: flight.lat, lng: flight.lng }]);
}

globe.onObjectClick(selectFlight);

// Load day/night textures and apply shader
Promise.all([
    new TextureLoader().loadAsync(
        "//cdn.jsdelivr.net/npm/three-globe/example/img/earth-day.jpg"
    ),
    new TextureLoader().loadAsync(
        "//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
    ),
]).then(([dayTexture, nightTexture]) => {
    const material = new ShaderMaterial({
        uniforms: {
            dayTexture: { value: dayTexture },
            nightTexture: { value: nightTexture },
            sunPosition: { value: new Vector2() },
            globeRotation: { value: new Vector2() },
        },
        vertexShader: dayNightShader.vertexShader,
        fragmentShader: dayNightShader.fragmentShader,
    });

    globe
        .globeMaterial(material)
        .backgroundImageUrl(
            "//cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png"
        );

    // Animation loop
    const animate = () => {
        now = Date.now();
        material.uniforms.sunPosition.value.set(...getSunPosition(now));
        const pov = globe.pointOfView();
        material.uniforms.globeRotation.value.set(pov.lng, pov.lat);
        requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
});

// Resize renderer on window resize
window.addEventListener("resize", () => {
    globe.width(window.innerWidth).height(window.innerHeight);
});

// Autopilot: select a random flight with known origin + destination every 5s
let autopilotInterval = null;

function selectRandomFlight() {
    const flights = globe.objectsData() || [];
    const eligible = flights.filter(
        (f) => airports[f.origin] && airports[f.destination]
    );
    if (!eligible.length) return;

    const flight = eligible[Math.floor(Math.random() * eligible.length)];
    selectFlight(flight);

    const origin = airports[flight.origin];
    const dest = airports[flight.destination];
    const toRad = (d) => (d * Math.PI) / 180;
    const lat1 = toRad(origin.lat), lng1 = toRad(origin.lng);
    const lat2 = toRad(dest.lat), lng2 = toRad(dest.lng);

    // Haversine angular distance in degrees
    const dlat = lat2 - lat1, dlng = lng2 - lng1;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
    const angularDist = (2 * Math.asin(Math.sqrt(a)) * 180) / Math.PI;

    // Spherical midpoint
    const Bx = Math.cos(lat2) * Math.cos(lng2 - lng1);
    const By = Math.cos(lat2) * Math.sin(lng2 - lng1);
    const midLat = (Math.atan2(Math.sin(lat1) + Math.sin(lat2), Math.sqrt((Math.cos(lat1) + Bx) ** 2 + By ** 2)) * 180) / Math.PI;
    const midLng = origin.lng + (Math.atan2(By, Math.cos(lat1) + Bx) * 180) / Math.PI;

    const altitude = Math.min(4, Math.max(1.2, angularDist / 50));
    globe.pointOfView({ lat: midLat, lng: midLng, altitude }, 2000);
}

document.getElementById("autopilot-toggle").addEventListener("change", (e) => {
    if (e.target.checked) {
        selectRandomFlight();
        autopilotInterval = setInterval(selectRandomFlight, 6000);
    } else {
        clearInterval(autopilotInterval);
        autopilotInterval = null;
    }
});

// reoload the page every hour to get fresh data
setTimeout(() => {
    location.reload();
}, 60 * 60 * 1000);
