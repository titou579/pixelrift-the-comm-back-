import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ASSETS } from './assetCatalog.js';

const loader = new GLTFLoader();
const rawCache = new Map();   // chemin -> Promise<Object3D>
const assetCache = new Map(); // clé de catalogue -> Promise<info>
const BASE = import.meta.env.BASE_URL || '/';

const DEBUG =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

/** Charge un .glb depuis /public/ (mis en cache). */
export function loadModel(path) {
  if (rawCache.has(path)) return rawCache.get(path);
  // blob: (aperçu d'un fichier choisi) et http(s) : utilisés tels quels
  const url = /^(blob:|https?:)/.test(path) ? path : encodeURI(`${BASE}${path}`.replace(/\/{2,}/g, '/'));
  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        // Sans carte d'environnement, un matériau très métallique apparaît tout noir.
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.25);
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.error(`❌ Échec chargement ${url} — vérifie le chemin et la casse.`, err);
        reject(err);
      }
    );
  });
  rawCache.set(path, promise);
  return promise;
}

export function cloneModel(model) {
  return SkeletonUtils.clone(model);
}

/**
 * Charge un asset du catalogue et le normalise :
 *  - mesure sa boîte englobante réelle,
 *  - calcule le facteur d'échelle pour atteindre la taille voulue (h / len / scale),
 *  - le recentre (pivot au milieu, pieds sur y = 0).
 * Retourne { scene, scale, center, minY, size (en m), meshes:[{geometry,material,local}], skinned }
 */
export function loadAsset(key) {
  if (assetCache.has(key)) return assetCache.get(key);
  const spec = ASSETS[key];
  if (!spec) return Promise.reject(new Error(`Asset inconnu : ${key}`));
  const p = loadModel(spec.file).then((scene) => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    let s = 1;
    if (spec.h) s = spec.h / Math.max(size.y, 1e-6);
    else if (spec.len) s = spec.len / Math.max(size.x, size.z, 1e-6);
    else if (spec.scale) s = spec.scale;
    if (!isFinite(s) || s <= 0) s = 1;

    const meshes = [];
    let skinned = false;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) { skinned = true; return; }
      meshes.push({ geometry: o.geometry, material: o.material, local: o.matrixWorld.clone() });
    });

    const info = {
      key, spec, scene, scale: s, center, minY: box.min.y,
      rawSize: size, size: size.clone().multiplyScalar(s), meshes, skinned,
    };
    if (DEBUG) {
      console.log(
        `[assets] ${key}: brut ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} → ×${s.toFixed(3)} → ` +
        `${info.size.x.toFixed(1)}×${info.size.y.toFixed(1)}×${info.size.z.toFixed(1)} m${skinned ? ' (animé)' : ''}`
      );
    }
    return info;
  });
  assetCache.set(key, p);
  return p;
}

export async function preloadModels(paths) {
  const results = await Promise.allSettled(paths.map((p) => loadModel(p)));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}
