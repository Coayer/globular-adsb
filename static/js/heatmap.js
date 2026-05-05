import { TextureLoader, ShaderMaterial, Vector2 } from "https://esm.sh/three";
import * as THREE from "https://esm.sh/three";
import { ASSETS_BASE } from './constants.js';
import { dayNightShader } from './shader.js';
import { getSunPosition } from './solar.js';
import { globe } from './globe.js';
import { state } from './state.js';
import { updateObjectsData } from './flights.js';
import { clearSelection, refreshBusiestKey, refreshLongestKey } from './selection.js';

export async function initHeatmap() {
    const darkTexture = await new TextureLoader().loadAsync(`${ASSETS_BASE}/darkmap.jpg`);

    const canvas1x1 = document.createElement('canvas');
    canvas1x1.width = canvas1x1.height = 1;
    const blankTexture = new THREE.CanvasTexture(canvas1x1);

    const material = new ShaderMaterial({
        uniforms: {
            dayTexture:      { value: blankTexture },
            nightTexture:    { value: blankTexture },
            darkTexture:     { value: darkTexture },
            heatmapTexture:  { value: blankTexture },
            bordermapTexture:{ value: blankTexture },
            sunPosition:     { value: new Vector2() },
            globeRotation:   { value: new Vector2() },
            heatmapMode:     { value: 0.0 },
            bordermapEnabled:{ value: 0.0 },
        },
        vertexShader: dayNightShader.vertexShader,
        fragmentShader: dayNightShader.fragmentShader,
    });

    const animationVideo = document.createElement('video');
    animationVideo.loop = true;
    animationVideo.muted = true;
    animationVideo.setAttribute('playsinline', '');
    const animationVideoTexture = new THREE.VideoTexture(animationVideo);
    animationVideoTexture.minFilter = THREE.LinearFilter;
    animationVideoTexture.magFilter = THREE.LinearFilter;

    const heatmapExtra      = document.getElementById('heatmap-extra');
    const heatmapProgress   = document.getElementById('heatmap-progress');
    const progressFill      = document.getElementById('heatmap-progress-fill');
    const progressCount     = document.getElementById('heatmap-progress-count');
    const videoDownloadBtn  = document.getElementById('video-download-btn');
    const videoPlayBtn      = document.getElementById('video-play-btn');
    const videoTimeSlider   = document.getElementById('heatmap-time');
    const heatmapSliderWrap = document.getElementById('heatmap-slider-wrap');
    const sliderDayTicks    = document.getElementById('slider-day-ticks');
    const last24hBtn        = document.getElementById('last24h-btn');
    const bordermapToggle   = document.getElementById('bordermap-toggle');
    const liveTrafficLabel  = document.getElementById('heatmap-label');

    let bordermapTexture = null;
    let last24hTexture = null;
    let allLast24hTexture = null;

    const allFlightsToggle = document.getElementById('all-flights-toggle');

    function setLiveTrafficEnabled(enabled) {
        state.liveTrafficEnabled = enabled;
        document.getElementById('heatmap-toggle').checked = enabled;
        updateObjectsData();
        refreshLongestKey();
    }

    function setBordermapDisabled(disabled) {
        bordermapToggle.disabled = disabled;
        bordermapToggle.closest('label').style.opacity = disabled ? '0.4' : '';
        bordermapToggle.closest('label').style.pointerEvents = disabled ? 'none' : '';
    }

    function setAllFlightsDisabled(disabled) {
        allFlightsToggle.disabled = disabled;
        const wrap = document.getElementById('all-flights-seg-wrap');
        wrap.style.opacity = disabled ? '0.4' : '';
        wrap.style.pointerEvents = disabled ? 'none' : '';
    }

    function buildDayTicks() {
        sliderDayTicks.innerHTML = '';
        const tickMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const todayMidnight = new Date();
        todayMidnight.setUTCHours(0, 0, 0, 0);
        const MAX_N = 72;
        for (let k = 1; k <= 2; k++) {
            const n = 1 + k * 24;
            if (n > MAX_N) break;
            const pct = (n - 1) / (MAX_N - 1) * 100;
            const midnight = new Date(todayMidnight - (k + 1) * 86400000);
            const label = `${String(midnight.getUTCDate()).padStart(2, '0')}${tickMonths[midnight.getUTCMonth()]}`;
            const tick = document.createElement('div');
            tick.className = 'slider-day-tick';
            tick.style.left = `${pct}%`;
            tick.innerHTML = `<div class="slider-day-tick-label">${label}</div><div class="slider-day-tick-line"></div>`;
            sliderDayTicks.appendChild(tick);
        }
    }

    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const yday = new Date();
    yday.setUTCDate(yday.getUTCDate() - 1);
    last24hBtn.textContent = `${String(yday.getUTCDate()).padStart(2, '0')} ${months[yday.getUTCMonth()]} · 24H`;

    function loadLast24h() {
        const allFlights = allFlightsToggle.checked;
        if (allFlights) {
            if (allLast24hTexture) {
                material.uniforms.heatmapTexture.value = allLast24hTexture;
                return;
            }
            const url = `${ASSETS_BASE}/heatmaps/heatmap_all_last24h.webp?t=${Math.floor(Date.now() / 3600000)}`;
            fetch(url)
                .then(r => r.blob())
                .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' }))
                .then(bitmap => {
                    const tex = new THREE.CanvasTexture(bitmap);
                    tex.flipY = false;
                    globe.renderer().initTexture(tex);
                    allLast24hTexture = tex;
                    material.uniforms.heatmapTexture.value = tex;
                });
        } else {
            if (last24hTexture) {
                material.uniforms.heatmapTexture.value = last24hTexture;
                return;
            }
            const url = `${ASSETS_BASE}/heatmaps/heatmap_last24h.webp?t=${Math.floor(Date.now() / 3600000)}`;
            fetch(url)
                .then(r => r.blob())
                .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' }))
                .then(bitmap => {
                    const tex = new THREE.CanvasTexture(bitmap);
                    tex.flipY = false;
                    globe.renderer().initTexture(tex);
                    last24hTexture = tex;
                    material.uniforms.heatmapTexture.value = tex;
                });
        }
    }

    state.onTimelapseAirportClick = () => {
        if (animationVideo.paused) return;
        animationVideo.pause();
        videoPlayBtn.textContent = '▶ PLAY';
        videoTimeSlider.disabled = true;
        setBordermapDisabled(false);
        setAllFlightsDisabled(false);
        last24hBtn.classList.add('active');
        state.timelapseIsPlaying = false;
        refreshBusiestKey();
        refreshLongestKey();
        loadLast24h();
    };

    last24hBtn.addEventListener('click', () => {
        last24hBtn.classList.add('active');
        state.timelapseIsPlaying = false;
        refreshBusiestKey();
        refreshLongestKey();
        animationVideo.pause();
        videoPlayBtn.textContent = '▶ PLAY';
        videoTimeSlider.disabled = true;
        setBordermapDisabled(false);
        setAllFlightsDisabled(false);
        loadLast24h();
    });

    const ua = navigator.userAgent;
    const isDesktopFirefox = ua.includes('Firefox/') && !ua.includes('FxiOS');
    const supportsVp9 = !isDesktopFirefox && window.innerWidth > 1440 &&
        document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '';
    const btnApprox = videoDownloadBtn.querySelector('.btn-approx');
    if (btnApprox) btnApprox.textContent = supportsVp9 ? ' · APPROX 50MB' : ' · APPROX 15MB';

    async function fetchWithProgress(url, mimeType) {
        const response = await fetch(url);
        const total = response.headers.get('content-length');
        const totalBytes = total ? parseInt(total, 10) : null;
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (totalBytes) {
                const pct = Math.round((received / totalBytes) * 100);
                progressFill.style.width = `${pct}%`;
                progressCount.textContent = `${pct}%`;
            }
        }
        return new Blob(chunks, { type: mimeType });
    }

    async function loadAndPlayVideo() {
        videoDownloadBtn.style.display = 'none';
        heatmapProgress.style.display = 'flex';
        progressFill.style.width = '0%';
        progressCount.textContent = '0%';

        const [url, mime] = supportsVp9
            ? [`${ASSETS_BASE}/heatmaps/heatmap_animation.webm`, 'video/webm']
            : [`${ASSETS_BASE}/heatmaps/heatmap_animation.mp4`, 'video/mp4'];

        const blob = await fetchWithProgress(url, mime);
        animationVideo.src = URL.createObjectURL(blob);
        await new Promise(resolve => animationVideo.addEventListener('loadedmetadata', resolve, { once: true }));

        heatmapProgress.style.display = 'none';
        videoPlayBtn.style.display = 'inline-block';
        buildDayTicks();
        heatmapSliderWrap.classList.add('visible');
        last24hBtn.classList.remove('active');
        state.timelapseIsPlaying = true;
        refreshBusiestKey();
        refreshLongestKey();
        material.uniforms.heatmapTexture.value = animationVideoTexture;
        setLiveTrafficEnabled(false);
        clearSelection();
        animationVideo.play();
        videoPlayBtn.textContent = '⏸ PAUSE';
        setBordermapDisabled(true);
        setAllFlightsDisabled(true);
    }

    videoDownloadBtn.addEventListener('click', loadAndPlayVideo);

    videoPlayBtn.addEventListener('click', () => {
        if (animationVideo.paused) {
            last24hBtn.classList.remove('active');
            state.timelapseIsPlaying = true;
            refreshBusiestKey();
            refreshLongestKey();
            material.uniforms.heatmapTexture.value = animationVideoTexture;
            setLiveTrafficEnabled(false);
            clearSelection();
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
            state.timelapseIsPlaying = false;
            refreshBusiestKey();
            refreshLongestKey();
        }
    });

    videoTimeSlider.addEventListener('input', () => {
        if (animationVideo.duration) {
            animationVideo.currentTime = (parseInt(videoTimeSlider.value, 10) / 1000) * animationVideo.duration;
        }
    });

    animationVideo.addEventListener('seeked', () => {
        animationVideoTexture.needsUpdate = true;
    });

    document.getElementById('heatmap-toggle').addEventListener('change', e => {
        if (e.target.checked && !last24hBtn.classList.contains('active')) {
            animationVideo.pause();
            videoPlayBtn.textContent = '▶ PLAY';
            videoTimeSlider.disabled = true;
            setBordermapDisabled(false);
            setAllFlightsDisabled(false);
            last24hBtn.classList.add('active');
            state.timelapseIsPlaying = false;
            refreshBusiestKey();
            refreshLongestKey();
            loadLast24h();
            state.liveTrafficEnabled = true;
            updateObjectsData();
            return;
        }
        state.liveTrafficEnabled = e.target.checked;
        updateObjectsData();
        refreshLongestKey();
    });

    bordermapToggle.addEventListener('change', e => {
        if (e.target.checked && !bordermapTexture) {
            new TextureLoader().loadAsync(`${ASSETS_BASE}/bordermap.webp`).then(tex => {
                bordermapTexture = tex;
                material.uniforms.bordermapTexture.value = tex;
                material.uniforms.bordermapEnabled.value = 1.0;
            });
            return;
        }
        material.uniforms.bordermapEnabled.value = e.target.checked ? 1.0 : 0.0;
    });

    allFlightsToggle.addEventListener('change', () => {
        if (last24hBtn.classList.contains('active')) {
            loadLast24h();
        }
    });

    const allFlightsSegWrap = document.getElementById('all-flights-seg-wrap');

    document.getElementById('heatmap-enable-toggle').addEventListener('change', e => {
        state.heatmapEnabled = e.target.checked;
        if (!state.heatmapEnabled) {
            animationVideo.pause();
            videoPlayBtn.textContent = '▶ PLAY';
            heatmapExtra.classList.remove('visible');
            material.uniforms.heatmapMode.value = 0.0;
            material.uniforms.heatmapTexture.value = blankTexture;
            liveTrafficLabel.style.display = 'none';
            allFlightsSegWrap.style.display = 'none';
            setBordermapDisabled(false);
            setLiveTrafficEnabled(true);
            state.timelapseIsPlaying = false;
            refreshBusiestKey();
            refreshLongestKey();
        } else {
            heatmapExtra.classList.add('visible');
            material.uniforms.heatmapMode.value = 1.0;
            last24hBtn.classList.add('active');
            state.timelapseIsPlaying = false;
            refreshBusiestKey();
            refreshLongestKey();
            loadLast24h();
            liveTrafficLabel.style.display = '';
            allFlightsSegWrap.style.display = '';
        }
    });

    last24hBtn.classList.add('active');
    material.uniforms.heatmapMode.value = 1.0;
    loadLast24h();

    globe
        .globeMaterial(material)
        .backgroundImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png');

    (window.requestIdleCallback || (cb => setTimeout(cb, 3000)))(() => {
        Promise.all([
            new TextureLoader().loadAsync(`${ASSETS_BASE}/daymap.webp`),
            new TextureLoader().loadAsync(`${ASSETS_BASE}/nightmap.webp`),
        ]).then(([dayTex, nightTex]) => {
            material.uniforms.dayTexture.value = dayTex;
            material.uniforms.nightTexture.value = nightTex;
        });
    });

    function animate() {
        state.now = Date.now();
        material.uniforms.sunPosition.value.set(...getSunPosition(state.now));
        const pov = globe.pointOfView();
        material.uniforms.globeRotation.value.set(pov.lng, pov.lat);
        if (!animationVideo.paused && animationVideo.duration) {
            videoTimeSlider.value = Math.round((animationVideo.currentTime / animationVideo.duration) * 1000);
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}
