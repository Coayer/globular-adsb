import {
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    Mesh,
    DoubleSide,
} from "https://esm.sh/three";
import * as THREE from "https://esm.sh/three";

export const isMobile = window.innerWidth <= 768;

export const globe = new Globe(document.getElementById("globeViz"))
    .pointOfView({ lat: 35, lng: -25, altitude: isMobile ? 4.0 : 2 })
    .objectLat("lat")
    .objectLng("lng")
    .objectAltitude((d) => (d._type === "airport" ? 0 : d.alt))
    .objectLabel((d) =>
        d._type === "airport" ? `${d._code}: ${d._name}` : d.callsign,
    )
    .objectThreeObject((d) => {
        if (d._type === "airport") {
            const group = new THREE.Group();
            const mat = (color, opacity) => {
                const m = new MeshBasicMaterial({ color });
                if (opacity !== undefined) {
                    m.transparent = true;
                    m.opacity = opacity;
                }
                return m;
            };
            group.rotation.x = Math.PI / 2;
            group.scale.set(2, 2, 2);

            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.13, 0.17, 0.55, 6),
                mat("#c2c8cf"),
            );
            shaft.position.y = 0.275;
            group.add(shaft);

            const cab = new THREE.Mesh(
                new THREE.CylinderGeometry(0.4, 0.26, 0.22, 8),
                mat("#00d4ff", 0.6),
            );
            cab.position.y = 0.66;
            group.add(cab);

            return group;
        }

if (d._type === 'selected_flight') {
            const group = new THREE.Group();

            // --- 1. REALISTIC LIVERY & MODEL BASED ON CALLSIGN ---
            
            const getHashFromCallsign = (str) => {
                if (!str) return Math.random(); 
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    hash = (hash << 5) - hash + str.charCodeAt(i);
                    hash |= 0; 
                }
                return Math.abs(hash) % 1000 / 1000;
            };

            const hash = getHashFromCallsign(d.callsign);
            const secondaryHash = (hash * 17) % 1; // Used for livery colors
            const tertiaryHash = (hash * 31) % 1;  // Used for aircraft model!
            
            // --- AIRCRAFT MODEL SELECTION ---
            let planeModel = 'TWIN_ENGINE'; // 70% chance (B777, A350, etc)
            if (tertiaryHash < 0.30) planeModel = 'B747';

            const isB747 = planeModel === 'B747';

            // Scale adjustments based on model
            const wingSpanScale = isB747 ? 1.15 : 1.0;
            const fuselageZScale = isB747 ? 1.1 : 1.0;
            const fuselageXScale = isB747 ? 1.1 : 1.0; 
            
            // Generate the airline's brand color
            const brandColor = new THREE.Color().setHSL(hash, 0.8, 0.45);
            
            // Livery probability logic
            const isColoredFuselage = secondaryHash < 0.10; 
            const isColoredEngines = secondaryHash > 0.10 && secondaryHash < 0.50; 

            const whiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
            const wingMat = new THREE.MeshBasicMaterial({ color: '#e0e4e8' }); 
            const brandMat = new THREE.MeshBasicMaterial({ color: brandColor });
            
            const fuselageMat = isColoredFuselage ? brandMat : whiteMat;
            const engineMat = isColoredFuselage || isColoredEngines ? brandMat : whiteMat;
            const tailMat = brandMat; 

            const glassMat = new THREE.MeshBasicMaterial({ color: '#202124' }); 
            const cockpitMat = new THREE.MeshBasicMaterial({ color: '#8ab4f8' }); 

            // Inner group holds the plane
            const plane = new THREE.Group();
            
            // Make the 747 bigger in general
            if (isB747) {
                plane.scale.set(1.35, 1.35, 1.35);
            }
            
            // --- 2. DYNAMIC ALTITUDE ---
            const altMultiplier = 1000; 
            let planeZ = d.alt ? (d.alt * altMultiplier) : 0.8;
            plane.position.z = Math.max(0.15, planeZ); 
            group.add(plane);

            // --- 3. DYNAMIC SHADOW ---
            const shadowGeo = new THREE.CircleGeometry(0.3, 16);
            const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false });
            const shadow = new THREE.Mesh(shadowGeo, shadowMat);
            shadow.position.z = 0.01; 
            
            // Shadow gets bigger for 747s
            const baseShadowScale = isB747 ? 1.4 : 1.0;
            const shadowScale = baseShadowScale + (plane.position.z * 0.5);
            shadow.scale.set(shadowScale, shadowScale, shadowScale);
            shadow.material.opacity = Math.max(0.1, 0.3 - (plane.position.z * 0.2)); 
            group.add(shadow);


            // --- PLANE GEOMETRIES ---

            // Fuselage
            const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.03, 1.1, 16), fuselageMat);
            fuselage.scale.set(fuselageXScale, 1, fuselageZScale);
            plane.add(fuselage);

            // Nose cone 
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 16), fuselageMat);
            nose.scale.set(fuselageXScale, 2.2, fuselageZScale);
            nose.position.y = 0.55;
            plane.add(nose);

            // Boeing 747 Iconic Hump
            if (isB747) {
                const hump = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), fuselageMat);
                hump.scale.set(0.9, 4.0, 1.2);
                hump.position.set(0, 0.30, 0.055); // Positioned on the top front half
                hump.rotation.x = -0.05;
                plane.add(hump);
            }

            // Cockpit Windshield
            const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), cockpitMat);
            cockpit.scale.set(0.8, 1.5, 0.6);
            
            if (isB747) {
                // 747 cockpit is high up inside the hump
                cockpit.position.set(0, 0.48, 0.095);
                cockpit.rotation.x = -0.2;
            } else {
                // Standard Twin-Engine cockpit
                cockpit.position.set(0, 0.62, 0.035);
                cockpit.rotation.x = -0.15;
            }
            plane.add(cockpit);

            // Main Wings
            const wingGeo = new THREE.BoxGeometry(0.9 * wingSpanScale, 0.18, 0.015);
            
            const rWing = new THREE.Mesh(wingGeo, wingMat);
            rWing.position.set(0.4 * wingSpanScale, 0.05, 0);
            rWing.rotation.z = -0.35; 
            plane.add(rWing);

            const lWing = new THREE.Mesh(wingGeo, wingMat);
            lWing.position.set(-0.4 * wingSpanScale, 0.05, 0);
            lWing.rotation.z = 0.35; 
            plane.add(lWing);

            // Engines (4 for Jumbo Jets, 2 for Standard)
            const enginesPerWing = isB747 ? 2 : 1;
            
            for (const side of [-1, 1]) {
                for (let i = 0; i < enginesPerWing; i++) {
                    const engineGroup = new THREE.Group();
                    
                    // Default to Twin Engine positions
                    let xPos = side * 0.28;
                    let yPos = 0.18; 
                    
                    // If Quad-Engine, stagger an inner and an outer engine
                    if (enginesPerWing === 2) {
                        if (i === 0) {
                            xPos = side * 0.25; // Inner engine
                            yPos = 0.25;        // Brought forward significantly (was 0.18)
                        } else {
                            xPos = side * 0.62; // Outer engine moved further out (was 0.46)
                            yPos = 0.1;        // Brought forward significantly (was 0.06)
                        }
                    }

                    engineGroup.position.set(xPos, yPos, -0.04);

                    // Engine housing
                    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.22, 16), engineMat);
                    engineGroup.add(eng);

                    // Engine intake
                    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), glassMat);
                    intake.position.y = 0.11; 
                    engineGroup.add(intake);

                    plane.add(engineGroup);
                }
            }

            // Horizontal Stabilizers 
            const hStabGeo = new THREE.BoxGeometry(0.35 * wingSpanScale, 0.12, 0.015);
            const rHStab = new THREE.Mesh(hStabGeo, wingMat);
            rHStab.position.set(0.15 * wingSpanScale, -0.45, 0);
            rHStab.rotation.z = -0.4;
            plane.add(rHStab);

            const lHStab = new THREE.Mesh(hStabGeo, wingMat);
            lHStab.position.set(-0.15 * wingSpanScale, -0.45, 0);
            lHStab.rotation.z = 0.4;
            plane.add(lHStab);

            // Vertical Stabilizer / Tail Fin
            const vStabGeo = new THREE.BoxGeometry(0.015, 0.18 * fuselageZScale, 0.22 * fuselageZScale);
            const vStab = new THREE.Mesh(vStabGeo, tailMat);
            vStab.position.set(0, -0.42, 0.12 * fuselageZScale);
            vStab.rotation.x = 0.35; 
            plane.add(vStab);

            // --- FINAL SCALING & ROTATION ---
            group.scale.set(3.5, 3.5, 3.5);
            if (d.heading !== undefined) group.rotation.z = (-d.heading * Math.PI) / 180;
            
            return group;
        }

        const geometry = new BufferGeometry();
        const thickness = 0.05;
        const verts = new Float32Array([
            0,
            0.7,
            thickness,
            -0.42,
            -0.7,
            thickness,
            0.42,
            -0.7,
            thickness,
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
        if (d.heading !== undefined)
            mesh.rotation.z = (-d.heading * Math.PI) / 180;
        return mesh;
    })
    .objectFacesSurface(true)
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcColor((d) =>
        d._direction === "outbound"
            ? "#00e676"
            : d._direction === "inbound"
              ? "#ff6d00"
              : d._direction === "both"
                ? "#c77dff"
                : "cyan",
    )
    .arcStroke(0.5)
    .arcAltitudeAutoScale(0.3)
    .labelLat((d) => d.lat)
    .labelLng((d) => d.lng)
    .labelText((d) => d.text)
    .labelTypeFace({})
    .labelColor((d) => (d._selected ? "#ffffff" : "#d4d4d4"))
    .labelSize((d) => (d._selected ? 1.4 : 0.9))
    .labelDotRadius((d) => (d._selected ? 0.25 : 0.15))
    .labelAltitude((d) => (d._selected ? 0.06 : 0.01));

fetch("/mono_bold.json")
    .then((r) => r.json())
    .then((typeface) => globe.labelTypeFace(typeface));

window.addEventListener("resize", () => {
    globe.width(window.innerWidth).height(window.innerHeight);
});
