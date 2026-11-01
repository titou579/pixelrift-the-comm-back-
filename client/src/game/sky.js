import * as THREE from 'three';

// Ciel dégradé + soleil. Le dôme suit la caméra, donc l'horizon est toujours à la bonne place.
export const SKY = {
  top: 0x2d6fd2,
  horizon: 0xcfe6ff,
  ground: 0x8fa58a,
  sunDir: new THREE.Vector3(0.45, 0.62, 0.35).normalize(),
};

export function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(SKY.top) },
      horizonColor: { value: new THREE.Color(SKY.horizon) },
      groundColor: { value: new THREE.Color(SKY.ground) },
      sunDir: { value: SKY.sunDir.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0
          ? mix(horizonColor, topColor, pow(h, 0.5))
          : mix(horizonColor, groundColor, pow(-h, 0.5));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.92, 0.7) * pow(s, 900.0) * 4.0;   // disque solaire
        col += vec3(1.0, 0.75, 0.45) * pow(s, 14.0) * 0.28;  // halo
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 20), material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  return dome;
}
