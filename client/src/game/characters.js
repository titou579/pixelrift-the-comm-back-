import * as THREE from 'three';
import { loadModel, cloneModel } from './assetLoader.js';
import { GUN_FILES } from './assetCatalog.js';
import { VIEW } from './weapon.js';

// ============================================================
// PERSONNAGES 3D
//  • « procedural » : mannequin construit en code (skin de base et variantes de couleur)
//  • « glb »        : modèle importé (Poly Pizza, Sketchfab…) déjà normalisé à 1,80 m
// Convention : pieds à y = 0, le personnage regarde vers +Z.
// L'arme est tenue à deux mains (poses précalculées pour les modèles riggés,
// cinématique inverse pour le mannequin).
// ============================================================

const PISTOLS = new Set(['pistol', 'deagle', 'revolver']);
export const holdClass = (weaponId) => (PISTOLS.has(weaponId) ? 'pistol' : 'rifle');

// Cibles des mains par rapport au milieu des épaules (M), en longueurs de bras (A)
const POSE_REL = {
  rifle:  { R: [-0.09, -0.45, 0.50], L: [null, -0.28, 0.80] },
  pistol: { R: [-0.10, -0.15, 0.95], L: [null, -0.17, 0.95] },
};
const GRIP_UP = 0.05;     // l'axe du canon est au-dessus de la main
const GRIP_BACK = 0.10;   // le centre de l'arme est devant la poignée (fraction de la longueur)

// ---------- Armes en main ----------
const weaponCache = new Map();
async function weaponModel(id) {
  if (!weaponCache.has(id)) {
    weaponCache.set(id, (async () => {
      const raw = await loadModel(GUN_FILES[id]);
      const inner = raw.clone(true);
      inner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const len = (VIEW[id] && VIEW[id].len) || 0.8;
      const s = len / Math.max(size.x, 1e-6);
      inner.scale.setScalar(s);
      inner.position.set(-c.x * s, -c.y * s, -c.z * s);
      const pivot = new THREE.Group();
      pivot.add(inner);
      pivot.rotation.y = -Math.PI / 2;   // canon vers +Z (le personnage regarde vers +Z)
      inner.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      return { pivot, len };
    })());
  }
  const { pivot, len } = await weaponCache.get(id);
  return { model: pivot.clone(true), len };
}

// ---------- Mannequin procédural ----------
const matCache = new Map();
function mat(color, glow = false) {
  const key = `${color}|${glow}`;
  if (!matCache.has(key)) {
    matCache.set(key, glow
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 }));
  }
  return matCache.get(key);
}
const geoCache = new Map();
function box(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function part(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(box(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

const L1 = 0.28, L2 = 0.28;   // bras : épaule → coude, coude → poignet (+ main)
function buildMannequin(p) {
  const root = new THREE.Group();
  const suit = mat(p.suit), vest = mat(p.vest), helmet = mat(p.helmet), skin = mat(p.skin);
  const accent = mat(p.accent, false), glow = mat(p.accent, !!p.glow), dark = mat(0x16181a);

  // jambes
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(sx * 0.10, 0.93, 0);
    hip.add(part(0.16, 0.44, 0.17, suit, 0, -0.22, 0));
    const knee = new THREE.Group(); knee.position.set(0, -0.45, 0);
    knee.add(part(0.14, 0.40, 0.15, suit, 0, -0.20, 0));
    knee.add(part(0.15, 0.09, 0.27, dark, 0, -0.43, 0.05));
    hip.add(knee); root.add(hip); legs.push(hip, knee);
  }
  // buste
  const torso = new THREE.Group(); root.add(torso);
  torso.add(part(0.34, 0.17, 0.21, vest, 0, 0.98, 0));
  torso.add(part(0.38, 0.50, 0.23, suit, 0, 1.31, 0));
  torso.add(part(0.40, 0.34, 0.07, vest, 0, 1.33, 0.12));
  torso.add(part(0.36, 0.04, 0.075, accent, 0, 1.40, 0.125));
  torso.add(part(0.30, 0.34, 0.13, vest, 0, 1.34, -0.17));
  torso.add(part(0.34, 0.04, 0.02, accent, 0, 1.18, 0.0));
  // tête
  torso.add(part(0.07, 0.07, 0.07, skin, 0, 1.58, 0));
  torso.add(part(0.19, 0.23, 0.20, skin, 0, 1.69, 0));
  torso.add(part(0.23, 0.10, 0.24, helmet, 0, 1.81, -0.005));
  torso.add(part(0.23, 0.14, 0.05, helmet, 0, 1.73, -0.12));
  torso.add(part(0.17, 0.06, 0.03, glow, 0, 1.71, 0.105));
  // bras (pivots d'épaule)
  const arms = {};
  for (const [side, sx] of [['R', -1], ['L', 1]]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.225, 1.50, 0);
    sh.add(part(0.11, 0.07, 0.12, vest, 0, 0.0, 0));
    sh.add(part(0.10, L1, 0.10, suit, 0, -L1 / 2, 0));
    const el = new THREE.Group(); el.position.set(0, -L1, 0);
    el.add(part(0.09, L2 - 0.04, 0.09, suit, 0, -(L2 - 0.04) / 2, 0));
    el.add(part(0.085, 0.09, 0.10, skin, 0, -L2 + 0.02, 0));
    sh.add(el); torso.add(sh);
    arms[side] = { sh, el };
  }
  return { root, legs, torso, arms };
}

const _down = new THREE.Vector3(0, -1, 0);
function aimArm(arm, shoulderPos, target, pole) {
  const S = shoulderPos;
  const toT = new THREE.Vector3().subVectors(target, S);
  const d = Math.min(Math.max(toT.length(), 0.05), (L1 + L2) * 0.995);
  const u = toT.normalize();
  const a = (d * d + L1 * L1 - L2 * L2) / (2 * d);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const p = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const E = S.clone().add(u.clone().multiplyScalar(a)).add(p.multiplyScalar(h));
  const T = S.clone().add(u.clone().multiplyScalar(d));
  const upperDir = E.clone().sub(S).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(_down, upperDir);
  arm.sh.quaternion.copy(q1);
  const foreDir = T.clone().sub(E).normalize().applyQuaternion(q1.clone().invert());
  arm.el.quaternion.setFromUnitVectors(_down, foreDir);
}

function handTargets(cls, M, A) {
  const rel = POSE_REL[cls];
  const R = new THREE.Vector3(M.x + A * rel.R[0], M.y + A * rel.R[1], M.z + A * rel.R[2]);
  const L = new THREE.Vector3(R.x + 0.035, M.y + A * rel.L[1], M.z + A * rel.L[2]);
  return { R, L };
}

// ---------- Création d'un personnage ----------
const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);

export async function createCharacter(skinDef, opts = {}) {
  const model = (skinDef && skinDef.model) || { kind: 'procedural', palette: {} };
  const root = new THREE.Group();
  const weaponHolder = new THREE.Group();
  let body = null;                 // mannequin
  let bones = null;                // os des modèles riggés
  const restQuats = new Map();
  let currentWeapon = null;
  let walkPhase = 0;
  let breathe = Math.random() * 6;

  if (model.kind === 'glb') {
    try {
      const raw = await loadModel(model.url);
      const inst = cloneModel(raw);
      inst.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
      const wrap = new THREE.Group();
      wrap.add(inst);
      if (model.fit && model.fit.auto) {         // modèle importé : mise à l'échelle automatique
        wrap.updateMatrixWorld(true);
        const box3 = new THREE.Box3().setFromObject(inst);
        const size = box3.getSize(new THREE.Vector3());
        const s = (model.fit.height || 1.8) / Math.max(size.y, 1e-6);
        inst.scale.setScalar(s);
        wrap.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(inst);
        const c = b2.getCenter(new THREE.Vector3());
        inst.position.set(-c.x, -b2.min.y, -c.z);
        wrap.rotation.y = THREE.MathUtils.degToRad(model.fit.yaw || 0);
      }
      root.add(wrap);
      if (model.rig === 'rigged') {
        bones = {};
        inst.traverse((o) => { if (o.isBone) { bones[o.name] = o; restQuats.set(o, o.quaternion.clone()); } });
      }
    } catch (e) {
      console.warn('Skin introuvable, mannequin de secours :', skinDef && skinDef.id, e);
      body = buildMannequin({ suit: 0x4b5a3a, vest: 0x2f3a28, helmet: 0x2b3322, skin: 0xd9a77a, accent: 0xff9d1c });
      root.add(body.root);
    }
  } else {
    body = buildMannequin({ suit: 0x4b5a3a, vest: 0x2f3a28, helmet: 0x2b3322, skin: 0xd9a77a, accent: 0xff9d1c, ...model.palette });
    root.add(body.root);
  }
  root.add(weaponHolder);

  function resetPose() {
    if (bones) for (const [b, q] of restQuats) b.quaternion.copy(q);
    if (body) { body.arms.R.sh.quaternion.identity(); body.arms.R.el.quaternion.identity(); body.arms.L.sh.quaternion.identity(); body.arms.L.el.quaternion.identity(); }
  }

  async function setWeapon(weaponId) {
    currentWeapon = weaponId;
    weaponHolder.clear();
    resetPose();
    if (!weaponId || !GUN_FILES[weaponId]) return;
    const cls = holdClass(weaponId);
    let w;
    try { w = await weaponModel(weaponId); } catch { return; }
    if (currentWeapon !== weaponId) return;      // changé entre-temps

    let grip;                                    // position de la main droite (espace personnage)
    if (body) {
      const M = new THREE.Vector3(0, 1.50, 0), A = L1 + L2;
      const { R, L } = handTargets(cls, M, A);
      aimArm(body.arms.R, new THREE.Vector3(-0.225, 1.50, 0), R, new THREE.Vector3(-0.5, -1, -0.3));
      aimArm(body.arms.L, new THREE.Vector3(0.225, 1.50, 0), L, new THREE.Vector3(0.5, -1, -0.3));
      grip = R.clone().add(new THREE.Vector3(0, 0, 0.03));
    } else if (bones && model.poses && model.poses[cls]) {
      const pose = model.poses[cls];
      for (const [name, q] of Object.entries(pose.bones)) {
        const b = bones[sanitize(name)];
        if (b) b.quaternion.fromArray(q);
      }
      grip = new THREE.Vector3(pose.grip[0], pose.grip[1], pose.grip[2] + 0.03);
    } else {
      const g = (model.hold && model.hold.grip) || [-0.25, 0.9, 0.05];
      const k = (model.fit && model.fit.height ? model.fit.height : 1.8) / 1.8;
      grip = new THREE.Vector3(g[0] * k, g[1] * k, g[2] * k + 0.02);
    }
    w.model.position.copy(grip).add(new THREE.Vector3(0, GRIP_UP, GRIP_BACK * w.len));
    weaponHolder.add(w.model);
  }

  if (opts.weaponId) await setWeapon(opts.weaponId);

  // Animation : légère respiration, jambes qui marchent (mannequin)
  function update(dt, state = {}) {
    breathe += dt;
    if (body) {
      const moving = !!state.moving;
      walkPhase += dt * (moving ? (state.speed > 7 ? 11 : 8) : 0);
      const swing = moving ? 0.55 : 0;
      const [hipL, kneeL, hipR, kneeR] = body.legs;
      hipL.rotation.x = Math.sin(walkPhase) * swing;
      hipR.rotation.x = -Math.sin(walkPhase) * swing;
      kneeL.rotation.x = Math.max(0, -Math.sin(walkPhase)) * swing * 1.2;
      kneeR.rotation.x = Math.max(0, Math.sin(walkPhase)) * swing * 1.2;
      body.torso.position.y = Math.sin(breathe * 1.8) * 0.004;
    }
  }

  return {
    root, skin: skinDef, setWeapon, update,
    get weaponId() { return currentWeapon; },
    dispose() { weaponHolder.clear(); },
  };
}
