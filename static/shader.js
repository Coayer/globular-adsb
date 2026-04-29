export const dayNightShader = {
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
