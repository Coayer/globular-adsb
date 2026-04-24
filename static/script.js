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
                uniform sampler2D darkTexture;
                uniform sampler2D heatmapTexture;
                uniform sampler2D bordermapTexture;
                uniform vec2 sunPosition;
                uniform vec2 globeRotation;
                uniform float heatmapMode;
                uniform float bordermapEnabled;

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

                    float blend = smoothstep(-0.1, 0.1, intensity);
                    vec4 dayNightBase = mix(texture2D(nightTexture, vUv), texture2D(dayTexture, vUv), blend);
                    vec4 base = mix(dayNightBase, texture2D(darkTexture, vUv), heatmapMode);
                    vec4 border = texture2D(bordermapTexture, vUv);
                    vec3 baseWithBorder = mix(base.rgb, border.rgb, border.a * bordermapEnabled);
                    vec4 heat = texture2D(heatmapTexture, vUv);
                    gl_FragColor = vec4(mix(baseWithBorder, heat.rgb, heat.a), base.a);
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
let allFlights = [];
let heatmapEnabled = true;
let liveTrafficEnabled = true;
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
    .labelColor(() => "cyan")
    .labelSize(0.8)
    .labelDotRadius(0.15)
    .labelAltitude(0.01);

// Try to center on user
let userLocation = null;
const recenterBtn = document.getElementById("recenter-btn");
const recenterSep = document.getElementById("recenter-sep");

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
            userLocation = { lat: coords.latitude, lng: coords.longitude };
            globe.pointOfView(userLocation);
            recenterBtn.classList.add("visible");
            recenterSep.style.display = "";
        },
        (err) => console.warn("Geolocation error:", err)
    );
}

recenterBtn.addEventListener("click", () => {
    if (userLocation) {
        globe.pointOfView({ lat: userLocation.lat, lng: userLocation.lng, altitude: 2.5 }, 1000);
    }
});

function refreshFlights() {
    fetch(`${ASSETS_BASE}/flights.json?t=${Date.now()}`)
        .then((r) => r.json())
        .then((data) => {
            if (data.timestamp) {
                const ts = new Date(data.timestamp * 1000);
                timeDisplay.textContent = `Data last updated: ${String(ts.getUTCHours()).padStart(2, "0")}:${String(ts.getUTCMinutes()).padStart(2, "0")} UTC`;
            }
            allFlights = data.flights.map((f) => ({
                lat: f.latitude,
                lng: f.longitude,
                alt: (f.altitude * FEET_TO_KM) / EARTH_RADIUS_KM + Math.random() * 0.001,
                callsign: f.callsign,
                aircraftCode: f.aircraftCode,
                origin: f.originAirportIata,
                destination: f.destinationAirportIata,
                heading: f.heading,
            }));
            console.log("Flights loaded:", allFlights.length);
            if (liveTrafficEnabled) globe.objectsData(allFlights);
        });
}

refreshFlights();
setInterval(refreshFlights, 15 * 60 * 1000);

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
    new TextureLoader().loadAsync(`${ASSETS_BASE}/daymap.webp`),
    new TextureLoader().loadAsync(`${ASSETS_BASE}/nightmap.webp`),
    new TextureLoader().loadAsync(
        "//cdn.jsdelivr.net/npm/three-globe/example/img/earth-dark.jpg"
    ),
    new TextureLoader().loadAsync(`${ASSETS_BASE}/bordermap.webp`),
]).then(([dayTexture, nightTexture, darkTexture, bordermapTexture]) => {
    const canvas1x1 = document.createElement("canvas");
    canvas1x1.width = canvas1x1.height = 1;
    const blankTexture = new THREE.CanvasTexture(canvas1x1);

    const material = new ShaderMaterial({
        uniforms: {
            dayTexture: { value: dayTexture },
            nightTexture: { value: nightTexture },
            darkTexture: { value: darkTexture },
            heatmapTexture: { value: blankTexture },
            bordermapTexture: { value: bordermapTexture },
            sunPosition: { value: new Vector2() },
            globeRotation: { value: new Vector2() },
            heatmapMode: { value: 0.0 },
            bordermapEnabled: { value: 0.0 },
        },
        vertexShader: dayNightShader.vertexShader,
        fragmentShader: dayNightShader.fragmentShader,
    });

    // Video element for animation — src is set after user downloads
    const animationVideo = document.createElement('video');
    animationVideo.loop = true;
    animationVideo.muted = true;
    const animationVideoTexture = new THREE.VideoTexture(animationVideo);
    animationVideoTexture.minFilter = THREE.LinearFilter;
    animationVideoTexture.magFilter = THREE.LinearFilter;

    const heatmapExtra = document.getElementById("heatmap-extra");
    const heatmapProgress = document.getElementById("heatmap-progress");
    const progressFill = document.getElementById("heatmap-progress-fill");
    const progressCount = document.getElementById("heatmap-progress-count");
    const videoDownloadBtn = document.getElementById("video-download-btn");
    const videoPlayBtn = document.getElementById("video-play-btn");
    const videoTimeSlider = document.getElementById("heatmap-time");
    const last24hBtn = document.getElementById("last24h-btn");

    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const yday = new Date();
    yday.setUTCDate(yday.getUTCDate() - 1);
    last24hBtn.textContent = `${String(yday.getUTCDate()).padStart(2,'0')}${months[yday.getUTCMonth()]}${yday.getUTCFullYear()}`;

    // Load heatmap_last24h.webp onto the globe
    let last24hTexture = null;
    function loadLast24h() {
        if (last24hTexture) {
            material.uniforms.heatmapTexture.value = last24hTexture;
            return;
        }
        const url = `${ASSETS_BASE}/heatmaps/heatmap_last24h.webp?t=${Math.floor(Date.now() / 3600000)}`;
        fetch(url)
            .then(r => r.blob())
            .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY' }))
            .then(bitmap => {
                const tex = new THREE.CanvasTexture(bitmap);
                tex.flipY = false;
                globe.renderer().initTexture(tex);
                last24hTexture = tex;
                material.uniforms.heatmapTexture.value = tex;
            });
    }

    last24hBtn.addEventListener("click", () => {
        last24hBtn.classList.add("active");
        animationVideo.pause();
        videoPlayBtn.textContent = '▶ PLAY';
        videoTimeSlider.disabled = true;
        loadLast24h();
        setLiveTrafficEnabled(true);
    });

    videoDownloadBtn.addEventListener("click", async () => {
        videoDownloadBtn.style.display = 'none';
        heatmapProgress.style.display = 'flex';
        progressFill.style.width = '0%';
        progressCount.textContent = '0%';

        const url = `${ASSETS_BASE}/heatmaps/heatmap_animation.webm`;
        const response = await fetch(url);
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : null;
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total) {
                const pct = Math.round((received / total) * 100);
                progressFill.style.width = `${pct}%`;
                progressCount.textContent = `${pct}%`;
            }
        }

        const blob = new Blob(chunks, { type: 'video/webm' });
        animationVideo.src = URL.createObjectURL(blob);

        await new Promise(resolve => {
            animationVideo.addEventListener('loadedmetadata', resolve, { once: true });
        });

        heatmapProgress.style.display = 'none';
        videoPlayBtn.style.display = 'inline-block';
        videoTimeSlider.style.display = 'inline-block';
        last24hBtn.classList.remove("active");

        material.uniforms.heatmapTexture.value = animationVideoTexture;
        setLiveTrafficEnabled(false);
        animationVideo.play();
        videoPlayBtn.textContent = '⏸ PAUSE';
    });

    videoPlayBtn.addEventListener("click", () => {
        if (animationVideo.paused) {
            last24hBtn.classList.remove("active");
            material.uniforms.heatmapTexture.value = animationVideoTexture;
            setLiveTrafficEnabled(false);
            if (videoTimeSlider.disabled) {
                animationVideo.currentTime = 0;
                videoTimeSlider.value = 0;
            }
            videoTimeSlider.disabled = false;
            animationVideo.play();
            videoPlayBtn.textContent = '⏸ PAUSE';
        } else {
            animationVideo.pause();
            videoPlayBtn.textContent = '▶ PLAY';
        }
    });

    videoTimeSlider.addEventListener("input", () => {
        if (animationVideo.duration) {
            animationVideo.currentTime = (parseInt(videoTimeSlider.value, 10) / 1000) * animationVideo.duration;
        }
    });

    function setLiveTrafficEnabled(enabled) {
        liveTrafficEnabled = enabled;
        document.getElementById("heatmap-toggle").checked = enabled;
        globe.objectsData(enabled ? allFlights : []);
    }

    document.getElementById("heatmap-toggle").addEventListener("change", (e) => {
        if (e.target.checked && !last24hBtn.classList.contains("active")) {
            animationVideo.pause();
            videoPlayBtn.textContent = '▶ PLAY';
            videoTimeSlider.disabled = true;
            last24hBtn.classList.add("active");
            loadLast24h();
            liveTrafficEnabled = true;
            globe.objectsData(allFlights);
            return;
        }
        liveTrafficEnabled = e.target.checked;
        globe.objectsData(liveTrafficEnabled ? allFlights : []);
    });

    document.getElementById("bordermap-toggle").addEventListener("change", (e) => {
        material.uniforms.bordermapEnabled.value = e.target.checked ? 1.0 : 0.0;
    });

    document.getElementById("autopilot-toggle").addEventListener("change", (e) => {
        if (e.target.checked) {
            autopilotStep();
        } else {
            clearTimeout(autopilotTimeout);
            autopilotTimeout = null;
            autopilotSpinning = false;
            stopManualSpin();
        }
    });

    const liveTrafficLabel = document.getElementById("heatmap-label");

    document.getElementById("heatmap-enable-toggle").addEventListener("change", (e) => {
        heatmapEnabled = e.target.checked;
        if (!heatmapEnabled) {
            animationVideo.pause();
            videoPlayBtn.textContent = '▶ PLAY';
            heatmapExtra.classList.remove("visible");
            material.uniforms.heatmapMode.value = 0.0;
            material.uniforms.heatmapTexture.value = blankTexture;
            liveTrafficLabel.style.display = "none";
            setLiveTrafficEnabled(true);
        } else {
            heatmapExtra.classList.add("visible");
            material.uniforms.heatmapMode.value = 1.0;
            last24hBtn.classList.add("active");
            loadLast24h();
            liveTrafficLabel.style.display = "";
        }
    });

    // Activate heatmap on startup
    last24hBtn.classList.add("active");
    material.uniforms.heatmapMode.value = 1.0;
    loadLast24h();

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
        if (!animationVideo.paused && animationVideo.duration) {
            videoTimeSlider.value = Math.round((animationVideo.currentTime / animationVideo.duration) * 1000);
        }
        requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
});

// Resize renderer on window resize
window.addEventListener("resize", () => {
    globe.width(window.innerWidth).height(window.innerHeight);
});

// Autopilot: select a random flight and pan from origin to destination
let autopilotTimeout = null;
let autopilotSpinning = false;

// --- Autopilot: heatmap-only spin mode ---
// Active when autopilot is on, heatmap is enabled, and live traffic is off.
let spinLng = 0;
let spinCurrentLat = 40;
let spinTargetLat = 40;   // smoothed intermediate target
let spinRawTargetLat = 40; // raw centroid, updated on interval
let spinRaf = null;
let spinLatTimer = null;
let spinPaused = false;

function centroidLatNear(centerLng, lngWindow = 80, minCount = 10) {
    const inWindow = allFlights.filter(f => {
        let d = Math.abs(f.lng - centerLng) % 360;
        if (d > 180) d = 360 - d;
        return d <= lngWindow;
    });
    const src = inWindow.length >= minCount ? inWindow : allFlights;
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
        // Ease the raw centroid into a smooth intermediate target, then
        // aggressively drive the camera toward that smoothed target.
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
    const flights = globe.objectsData() || [];
    const eligible = flights.filter(
        (f) => airports[f.origin] && airports[f.destination]
    );
    if (!eligible.length) {
        if (heatmapEnabled && !liveTrafficEnabled) {
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

    // Haversine angular distance in degrees
    const toRad = (d) => (d * Math.PI) / 180;
    const lat1 = toRad(origin.lat), lat2 = toRad(dest.lat);
    const dlat = lat2 - lat1, dlng = toRad(dest.lng - origin.lng);
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
    const angularDist = (2 * Math.asin(Math.sqrt(a)) * 180) / Math.PI;

    // Scale pan duration with distance: ~50ms per degree, clamped 1500–8000ms
    const panDuration = Math.min(7000, Math.max(2000, angularDist * 50));

    // Pan to origin first
    globe.pointOfView({ lat: origin.lat, lng: origin.lng, altitude: 1.5 }, 2000);

    // Then pan to destination at distance-scaled speed
    autopilotTimeout = setTimeout(() => {
        globe.pointOfView({ lat: dest.lat, lng: dest.lng, altitude: 1.5 }, panDuration);

        // Pick next flight after the pan completes
        autopilotTimeout = setTimeout(autopilotStep, panDuration + 1000);
    }, 2500);
}
