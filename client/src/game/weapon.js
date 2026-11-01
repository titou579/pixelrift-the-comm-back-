import * as THREE from 'three';
import { loadModel } from './assetLoader.js';
import { GUN_FILES } from './assetCatalog.js';
import * as sound from './sound.js';

// ============================================================
// SYSTÈME D'ARMES (client)
// Les statistiques (dégâts, cadence, chargeur...) viennent du serveur (/api/game-config).
// Ici : modèle 3D en main, tir (dispersion, recul), rechargement, visée (clic droit),
// traînées de balles, impacts et sons.
// ============================================================

// Apparence de chaque arme en main : len = longueur du modèle (m), hip = position à la hanche.
// Le modèle 3D est automatiquement mis à cette longueur, quelle que soit son échelle d'origine.
export const VIEW = {
  pistol:   { len: 0.30, hip: [0.20, -0.20, -0.38] },
  deagle:   { len: 0.34, hip: [0.20, -0.20, -0.40] },
  revolver: { len: 0.34, hip: [0.20, -0.20, -0.40] },
  smg:      { len: 0.58, hip: [0.22, -0.22, -0.48] },
  assault:  { len: 0.95, hip: [0.24, -0.23, -0.62] },
  bullpup:  { len: 0.80, hip: [0.24, -0.23, -0.58] },
  shotgun:  { len: 1.05, hip: [0.24, -0.22, -0.65] },
  sawedoff: { len: 0.62, hip: [0.22, -0.22, -0.50] },
  dmr:      { len: 1.05, hip: [0.24, -0.23, -0.65] },
  sniper:   { len: 1.25, hip: [0.25, -0.24, -0.72] },
};
const ADS_POS = [0, -0.125, -0.5];
const BASE_FOV = 75;
const DEG = Math.PI / 180;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,220,140,0.9)');
  gr.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWeaponSystem({
  scene, camera, player, world, remotes, defs, loadout,
  onShoot, onFired, onScope, onHitFeedback, onTargetHit, onWeaponChange,
}) {
  const defById = new Map(defs.map((d) => [d.id, d]));
  let tracerOverride = null;   // null = couleur de l'arme ; nombre = couleur ; 'rainbow' = arc-en-ciel
  const tracerColorFor = (def) => {
    if (tracerOverride === 'rainbow') return `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`;
    if (typeof tracerOverride === 'number') return '#' + tracerOverride.toString(16).padStart(6, '0');
    return def.tracer;
  };
  const now = () => performance.now() / 1000;

  // ---------- État des armes ----------
  let slots = [];       // [{ def, ammo, reloadEnd, nextShotAt, burstLeft }]
  let index = 0;
  let triggerHeld = false;
  let pressBuffer = 0;
  let adsWanted = false;
  let adsT = 0;
  let raiseT = 1;
  let reloadStart = 0;
  let scoped = false;
  let kickApplied = 0;
  let kickPending = 0;
  let lastShotAt = -10;
  let viewKick = 0;     // recul visuel de l'arme
  let bobT = 0;

  // ---------- Modèles 3D ----------
  const models = new Map(); // id -> { wrapper, view, muzzle }
  const holder = new THREE.Group();
  camera.add(holder);
  scene.add(camera);

  async function buildModel(id) {
    if (models.has(id)) return models.get(id);
    const view = VIEW[id] || { len: 0.8, hip: [0.24, -0.22, -0.6] };
    let pivot;
    try {
      const raw = await loadModel(GUN_FILES[id]);
      const inner = raw.clone(true);
      inner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = view.len / Math.max(size.x, 1e-6);
      inner.scale.setScalar(s);
      inner.position.set(-center.x * s, -center.y * s, -center.z * s);
      pivot = new THREE.Group();
      pivot.add(inner);
      pivot.rotation.y = Math.PI / 2; // le canon pointe vers +X dans les fichiers : on le tourne vers -Z
      inner.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    } catch (e) {
      // Modèle introuvable : arme de secours (simple boîte)
      pivot = new THREE.Mesh(
        new THREE.BoxGeometry(view.len, 0.1, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x444455 })
      );
      pivot.rotation.y = Math.PI / 2;
    }
    const wrapper = new THREE.Group();
    wrapper.add(pivot);
    wrapper.visible = false;
    holder.add(wrapper);
    const info = { wrapper, view, muzzle: new THREE.Vector3(0, 0.02, -view.len / 2 - 0.02) };
    models.set(id, info);
    return info;
  }

  // ---------- Effets : flash, traînées, impacts ----------
  const flashLight = new THREE.PointLight(0xffd9a0, 0, 12);
  camera.add(flashLight);
  const glowTex = glowTexture();
  const flashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  flashSprite.visible = false;
  holder.add(flashSprite);
  let flashUntil = 0;

  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false })
    );
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0, max: 0.1 });
  }
  let tracerIdx = 0;

  const sparks = [];
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    s.visible = false;
    scene.add(s);
    sparks.push({ sprite: s, life: 0 });
  }
  let sparkIdx = 0;

  function spawnTracer(from, to, color, thick) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const t = tracers[tracerIdx++ % tracers.length];
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.scale.set(thick, thick, len);
    t.mesh.lookAt(to);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.max = 0.09;
  }
  function spawnSpark(p, color = 0xffe3a0, size = 0.35) {
    const s = sparks[sparkIdx++ % sparks.length];
    s.sprite.position.copy(p);
    s.sprite.scale.setScalar(size);
    s.sprite.material.color.set(color);
    s.sprite.visible = true;
    s.life = 0.14;
  }

  // ---------- Cibles d'entraînement (sphères roses sur l'avenue centrale) ----------
  const targets = [];
  const tgeo = new THREE.IcosahedronGeometry(0.7, 0);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(
      tgeo,
      new THREE.MeshStandardMaterial({ color: 0xff2fb9, emissive: 0xff2fb9, emissiveIntensity: 0.6 })
    );
    m.position.set(-55 + i * 16, 2 + (i % 3) * 1.2, (i % 2 ? 1 : -1) * 2.5);
    m.userData.spin = 0.5 + Math.random();
    scene.add(m);
    targets.push(m);
  }
  const tRay = new THREE.Raycaster();
  let score = 0;

  // ---------- Équipement ----------
  function makeSlots(ids) {
    return ids.filter((id) => defById.has(id)).map((id) => ({
      def: defById.get(id), ammo: defById.get(id).mag, reloadEnd: 0, nextShotAt: 0, burstLeft: 0,
    }));
  }
  const cur = () => slots[index];

  const ready = Promise.all(defs.map((d) => buildModel(d.id)));

  function applyActive(raise = true) {
    const s = cur();
    for (const [id, m] of models) m.wrapper.visible = !!s && s.def.id === id;
    if (raise) raiseT = 0;
    if (s) player.state.speedMult = s.def.moveMult;
    if (s && onWeaponChange) onWeaponChange(s.def.id);
  }

  function setLoadout(ids) {
    slots = makeSlots(ids && ids.length ? ids : ['pistol']);
    index = 0;
    adsWanted = false;
    applyActive(true);
  }

  function cancelReload() {
    const s = cur();
    if (s) s.reloadEnd = 0;
  }
  function select(i) {
    if (i < 0 || i >= slots.length || i === index) return;
    cancelReload();
    index = i;
    adsWanted = false;
    sound.playSwitch();
    applyActive(true);
  }
  function cycle(dir) {
    if (slots.length < 2) return;
    select((index + dir + slots.length) % slots.length);
  }
  function reload() {
    const s = cur();
    if (!s || s.reloadEnd > 0 || s.ammo >= s.def.mag) return;
    s.reloadEnd = now() + s.def.reload;
    reloadStart = now();
    s.burstLeft = 0;
    sound.playReload();
  }

  // ---------- Tir ----------
  function currentSpread(def) {
    let sp = THREE.MathUtils.lerp(def.spread, def.adsSpread, adsT);
    const st = player.state;
    if (st.moving) sp *= 1.35;
    if (st.sprinting) sp *= 1.7;
    if (!st.onGround) sp *= 1.8;
    return sp;
  }

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _origin = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  function fire() {
    const s = cur();
    if (!s) return false;
    const def = s.def;
    const t = now();
    if (s.reloadEnd > 0 || raiseT < 0.6) return false;
    if (s.ammo <= 0) { sound.playEmpty(); reload(); return false; }

    s.ammo--;
    lastShotAt = t;
    s.nextShotAt = t + 1 / def.fireRate;
    sound.playShot(def.type);

    // Origine et axes de la caméra
    camera.updateMatrixWorld(true);
    _origin.setFromMatrixPosition(camera.matrixWorld);
    _fwd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    _right.set(1, 0, 0).transformDirection(camera.matrixWorld);
    _up.set(0, 1, 0).transformDirection(camera.matrixWorld);

    // Point de départ visuel : le bout du canon
    const m = models.get(def.id);
    if (m) {
      m.wrapper.updateWorldMatrix(true, false);
      _muzzle.copy(m.muzzle).applyMatrix4(m.wrapper.matrixWorld);
    } else {
      _muzzle.copy(_origin).addScaledVector(_fwd, 0.6);
    }

    const spread = currentSpread(def) * DEG;
    const maxDist = Math.min(300, def.range[1] * 1.6 + 8);
    const hitMap = new Map();
    let anyHit = false;
    let anyHead = false;
    const dir = new THREE.Vector3();
    const end = new THREE.Vector3();
    const firstDir = new THREE.Vector3();

    for (let i = 0; i < def.pellets; i++) {
      // direction aléatoire dans un cône autour du viseur
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.tan(spread * Math.sqrt(Math.random()));
      dir.copy(_fwd)
        .addScaledVector(_right, Math.cos(ang) * rad)
        .addScaledVector(_up, Math.sin(ang) * rad)
        .normalize();
      if (i === 0) firstDir.copy(dir);

      // 1. Décor (murs, voitures, arbres...)
      const wallT = world.raycast(_origin.x, _origin.y, _origin.z, dir.x, dir.y, dir.z, maxDist);
      let endT = Math.min(wallT, maxDist);
      let hitKind = wallT < maxDist ? 'wall' : 'none';

      // 2. Joueurs adverses (seulement s'ils sont plus proches que le mur)
      const ph = remotes ? remotes.raycastRay(_origin, dir, endT) : null;
      if (ph && ph.dist < endT) {
        endT = ph.dist;
        hitKind = 'player';
        const e = hitMap.get(ph.id) || { id: ph.id, n: 0, head: 0 };
        e.n++;
        if (ph.head) { e.head++; anyHead = true; }
        hitMap.set(ph.id, e);
        anyHit = true;
      }

      // 3. Cibles d'entraînement
      tRay.set(_origin, dir);
      tRay.far = endT;
      const th = tRay.intersectObjects(targets, false);
      if (th.length && th[0].distance < endT) {
        endT = th[0].distance;
        hitKind = 'target';
        th[0].object.position.set(
          (Math.random() - 0.5) * 110,
          1.8 + Math.random() * 3,
          (Math.random() - 0.5) * 6
        );
        score++;
        onTargetHit && onTargetHit(score);
      }

      if (hitKind === 'none') endT = Math.min(maxDist, 120);
      end.copy(_origin).addScaledVector(dir, endT);
      spawnTracer(_muzzle, end, tracerColorFor(def), def.pellets > 1 ? 0.01 : 0.02);
      if (hitKind === 'wall') spawnSpark(end.clone().addScaledVector(dir, -0.05));
      else if (hitKind === 'player') spawnSpark(end, 0xff4060, 0.5);
    }

    // Flash de bouche
    const mz = m ? m.muzzle : new THREE.Vector3(0.2, -0.1, -0.8);
    flashSprite.position.copy(mz);
    flashSprite.scale.setScalar(0.18 + def.damage * 0.002 + (def.pellets > 1 ? 0.15 : 0));
    flashSprite.visible = true;
    flashLight.position.copy(mz);
    flashLight.intensity = 3;
    flashUntil = t + 0.05;

    // Recul : visuel + vertical + un peu horizontal
    viewKick = Math.min(1, viewKick + 0.5 + def.recoil * 0.08);
    kickPending += def.recoil * (0.7 + Math.random() * 0.5);
    player.state.yaw += (Math.random() - 0.5) * def.recoil * 0.25 * DEG;

    if (onFired) onFired({ weaponId: def.id, dir: [firstDir.x, firstDir.y, firstDir.z] });
    if (anyHit) {
      onShoot && onShoot({ weaponId: def.id, hits: Array.from(hitMap.values()) });
      onHitFeedback && onHitFeedback({ head: anyHead });
    }

    // Rechargement automatique à vide
    if (s.ammo <= 0) setTimeout(() => { if (cur() === s) reload(); }, 220);
    return true;
  }

  // Tir d'un autre joueur : traînée + étincelle (l'arme n'est pas affichée sur lui)
  const _re = new THREE.Vector3();
  const _rd = new THREE.Vector3();
  const _rs = new THREE.Vector3();
  function remoteShot(origin, dirArr, def, tracer) {
    _rd.set(dirArr[0], dirArr[1], dirArr[2]).normalize();
    const maxDist = Math.min(300, def.range[1] * 1.3 + 8);
    const wallT = world.raycast(origin.x, origin.y, origin.z, _rd.x, _rd.y, _rd.z, maxDist);
    const d = Math.min(wallT, 120);
    _rs.copy(origin).addScaledVector(_rd, 0.8);
    _re.copy(origin).addScaledVector(_rd, d);
    let color = def.tracer;
    if (tracer === 'rainbow') color = `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`;
    else if (typeof tracer === 'number') color = '#' + tracer.toString(16).padStart(6, '0');
    spawnTracer(_rs, _re, color, def.pellets > 1 ? 0.012 : 0.03);
    if (wallT < maxDist) spawnSpark(_re.clone().addScaledVector(_rd, -0.05));
  }

  function triggerDown() {
    triggerHeld = true;
    pressBuffer = now() + 0.14;
    sound.resumeAudio();
  }
  function triggerUp() { triggerHeld = false; }
  function setAds(v) { adsWanted = v; }

  // ---------- Mise à jour par image ----------
  function update(dt) {
    const s = cur();
    const t = now();

    for (const g of targets) {
      g.rotation.y += g.userData.spin * dt;
      g.rotation.x += g.userData.spin * dt * 0.7;
    }

    // Effets visuels
    if (flashSprite.visible && t > flashUntil) { flashSprite.visible = false; flashLight.intensity = 0; }
    for (const tr of tracers) {
      if (!tr.mesh.visible) continue;
      tr.life -= dt;
      if (tr.life <= 0) tr.mesh.visible = false;
      else tr.mesh.material.opacity = (tr.life / tr.max) * 0.9;
    }
    for (const sp of sparks) {
      if (!sp.sprite.visible) continue;
      sp.life -= dt;
      if (sp.life <= 0) sp.sprite.visible = false;
      else sp.sprite.material.opacity = sp.life / 0.14;
    }

    if (!s) return;
    const def = s.def;

    // Fin de rechargement
    if (s.reloadEnd > 0 && t >= s.reloadEnd) {
      s.reloadEnd = 0;
      s.ammo = def.mag;
    }
    const reloading = s.reloadEnd > 0;

    // Gâchette selon le mode de tir
    if (!reloading && raiseT >= 0.6) {
      if (def.mode === 'auto') {
        if (triggerHeld && t >= s.nextShotAt) fire();
      } else if (def.mode === 'burst') {
        if (s.burstLeft > 0) {
          if (t >= s.nextShotAt) {
            if (fire()) s.burstLeft--; else s.burstLeft = 0;
            if (s.burstLeft === 0) s.nextShotAt = t + def.burstDelay;
          }
        } else if (pressBuffer > t && t >= s.nextShotAt) {
          pressBuffer = 0;
          if (fire()) {
            s.burstLeft = def.burst - 1;
            if (s.burstLeft === 0) s.nextShotAt = t + def.burstDelay;
          }
        }
      } else if (pressBuffer > t && t >= s.nextShotAt) {
        pressBuffer = 0;
        fire();
      }
    }

    // Visée (clic droit) : zoom, précision, ralentissement
    const wantAds = adsWanted && !reloading && !player.state.sprinting;
    const target = wantAds ? 1 : 0;
    adsT += (target - adsT) * Math.min(1, dt * 12);
    if (Math.abs(adsT - target) < 0.002) adsT = target;
    const fov = THREE.MathUtils.lerp(BASE_FOV, def.zoom || BASE_FOV, adsT);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    player.state.sensitivity = fov / BASE_FOV;
    player.state.speedMult = def.moveMult * (1 - 0.35 * adsT);

    const isScoped = !!def.scope && adsT > 0.85;
    if (isScoped !== scoped) { scoped = isScoped; onScope && onScope(scoped); }

    // Recul de la caméra : appliqué vite, puis récupéré en partie
    if (kickPending > 0.001) {
      const step = kickPending * Math.min(1, dt * 30);
      kickPending -= step;
      player.state.pitch = Math.min(Math.PI / 2 - 0.02, player.state.pitch + step * DEG);
      kickApplied += step;
    }
    if (t - lastShotAt > 0.12 && kickApplied > 0.001) {
      const rec = kickApplied * Math.min(1, dt * 4);
      player.state.pitch -= rec * DEG * 0.6;
      kickApplied -= rec;
    }

    // Animation de l'arme en main
    raiseT = Math.min(1, raiseT + dt * 4.5);
    viewKick = Math.max(0, viewKick - dt * 9);
    const moving = player.state.moving && player.state.onGround;
    const bob = moving ? 1 : 0.25;
    bobT += dt * (player.state.sprinting ? 12 : 8) * bob;
    const m = models.get(def.id);
    if (m) {
      const hip = m.view.hip;
      const px = THREE.MathUtils.lerp(hip[0], ADS_POS[0], adsT);
      const py = THREE.MathUtils.lerp(hip[1], ADS_POS[1], adsT);
      const pz = THREE.MathUtils.lerp(hip[2], ADS_POS[2], adsT);
      const rp = reloading ? Math.sin(Math.min(1, (t - reloadStart) / def.reload) * Math.PI) : 0;
      const sprintTilt = player.state.sprinting ? 1 : 0;
      holder.position.set(
        px + Math.sin(bobT) * 0.006 * bob * (1 - adsT) + sprintTilt * 0.05,
        py + Math.abs(Math.cos(bobT)) * 0.006 * bob * (1 - adsT) - (1 - raiseT) * 0.45 - rp * 0.22,
        pz + viewKick * 0.07
      );
      holder.rotation.set(
        viewKick * 0.12 + rp * 0.5 + sprintTilt * 0.35,
        sprintTilt * -0.5,
        -rp * 0.3
      );
      // La lunette du sniper masque le modèle quand on vise
      m.wrapper.visible = !(def.scope && adsT > 0.85);
    }
  }

  function getHud() {
    const s = cur();
    if (!s) return null;
    const t = now();
    return {
      slots: slots.map((x) => ({ id: x.def.id, name: x.def.name })),
      index,
      name: s.def.name,
      ammo: s.ammo,
      mag: s.def.mag,
      reloading: s.reloadEnd > 0,
      reloadPct: s.reloadEnd > 0 ? Math.min(1, (t - reloadStart) / s.def.reload) : 0,
      ads: adsT > 0.5,
      mode: s.def.mode,
      type: s.def.type,
      spread: currentSpread(s.def),
    };
  }

  function dispose() {
    camera.remove(holder);
    camera.remove(flashLight);
    for (const t of tracers) scene.remove(t.mesh);
    for (const s of sparks) scene.remove(s.sprite);
    for (const g of targets) scene.remove(g);
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }

  setLoadout(loadout);
  ready.then(() => applyActive(false));

  return {
    ready, update, remoteShot, setTracer(v) { tracerOverride = v; }, triggerDown, triggerUp, setAds, reload, select, cycle, setLoadout,
    getHud, getScore: () => score, dispose,
    resetAmmo() { slots.forEach((x) => { x.ammo = x.def.mag; x.reloadEnd = 0; }); },
  };
}
