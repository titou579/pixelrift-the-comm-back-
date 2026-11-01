import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { skinById, FALLBACK_SKIN } from './catalogStore.js';

// ============================================================
// JOUEURS ADVERSES / ALLIÉS : personnage 3D (skin choisi), arme en main, pseudo, barre de vie.
// Mode équipes : les alliés sont verts, les ennemis rouges ; on ne tire pas sur les alliés.
// ============================================================
export function createRemotePlayersManager(scene) {
  const players = new Map();
  const raycaster = new THREE.Raycaster();
  let ctx = { mode: 'ffa', myTeam: 0 };

  const isFriendly = (p) => ctx.mode === 'team' && p.team === ctx.myTeam;
  const labelColor = (p) => (ctx.mode === 'team' ? (isFriendly(p) ? '#6bd96b' : '#e4412f') : '#ff9d1c');

  function makeLabelSprite(username, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 64;
    const c = canvas.getContext('2d');
    c.fillStyle = 'rgba(10,11,12,0.8)';
    c.fillRect(0, 0, 320, 64);
    c.fillStyle = color;
    c.fillRect(0, 0, 8, 64);
    c.fillStyle = '#ecebe4';
    c.font = 'bold 32px Rajdhani, "Arial Narrow", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(username).toUpperCase().slice(0, 18), 164, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(1.9, 0.38, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  function makeHpBar() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 14;
    const c = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(1.2, 0.13, 1);
    sprite.renderOrder = 10;
    sprite.userData = { ctx: c, texture };
    return sprite;
  }

  function updateHpBar(sprite, hp) {
    const c = sprite.userData.ctx;
    c.clearRect(0, 0, 128, 14);
    c.fillStyle = 'rgba(0,0,0,0.7)';
    c.fillRect(0, 0, 128, 14);
    const ratio = Math.max(0, hp / 100);
    c.fillStyle = ratio > 0.5 ? '#ecebe4' : ratio > 0.25 ? '#ff9d1c' : '#e4412f';
    c.fillRect(2, 2, 124 * ratio, 10);
    sprite.userData.texture.needsUpdate = true;
  }

  function disposeSprite(s) {
    if (!s) return;
    s.material.map?.dispose();
    s.material.dispose();
  }

  function buildLabel(p) {
    if (p.label) { p.group.remove(p.label); disposeSprite(p.label); }
    p.label = makeLabelSprite(p.username, labelColor(p));
    p.label.position.y = 2.25;
    p.group.add(p.label);
  }

  // info : { username, skin (id), team, weaponId }
  function add(id, info, position, rotation) {
    if (players.has(id)) return;
    const group = new THREE.Group();
    const body = new THREE.Group();           // les personnages regardent vers +Z : on les retourne
    body.rotation.y = Math.PI;
    group.add(body);

    // Hitbox invisible pour le raycast
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.9, 0.7),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.y = 0.95;
    hitbox.userData.playerId = id;
    group.add(hitbox);

    const hpBar = makeHpBar();
    hpBar.position.y = 2.05;
    updateHpBar(hpBar, 100);
    group.add(hpBar);

    group.position.set(position.x, position.y - 1.7, position.z);
    group.rotation.y = rotation ? rotation.yaw : 0;
    scene.add(group);

    const p = {
      id, group, body, hitbox, hpBar, label: null,
      username: info.username, team: info.team ?? 0, skinId: info.skin, weaponId: info.weaponId,
      handle: null, loadToken: 0,
      targetPos: new THREE.Vector3(position.x, position.y - 1.7, position.z),
      lastPos: new THREE.Vector3(position.x, position.y - 1.7, position.z),
      targetYaw: rotation ? rotation.yaw : 0,
      hp: 100, alive: true, speed: 0,
    };
    players.set(id, p);
    buildLabel(p);
    loadBody(p);
  }

  // Personnage 3D : mannequin tout de suite, puis le vrai modèle quand il est chargé
  async function loadBody(p) {
    const token = ++p.loadToken;
    const def = skinById(p.skinId);
    const swap = (handle) => {
      if (p.loadToken !== token || !players.has(p.id)) { handle.dispose(); return; }
      if (p.handle) { p.body.remove(p.handle.root); p.handle.dispose(); }
      p.handle = handle;
      p.body.add(handle.root);
    };
    if (def.model && def.model.kind === 'glb') {
      swap(await createCharacter(FALLBACK_SKIN, { weaponId: p.weaponId }));
    }
    try {
      swap(await createCharacter(def, { weaponId: p.weaponId }));
    } catch (e) {
      console.warn('Skin adverse impossible à charger', e);
    }
  }

  // Changement de skin / pseudo / équipe en cours de partie
  function setLook(id, { username, skin, team }) {
    const p = players.get(id);
    if (!p) return;
    const nameChanged = username !== undefined && username !== p.username;
    const teamChanged = team !== undefined && team !== p.team;
    if (username !== undefined) p.username = username;
    if (team !== undefined) p.team = team;
    if (nameChanged || teamChanged) buildLabel(p);
    if (skin !== undefined && skin !== p.skinId) { p.skinId = skin; loadBody(p); }
  }

  function setWeapon(id, weaponId) {
    const p = players.get(id);
    if (!p) return;
    p.weaponId = weaponId;
    p.handle?.setWeapon(weaponId);
  }

  // Contexte de la partie : mode et équipe du joueur local
  function setContext(next) {
    ctx = { ...ctx, ...next };
    for (const p of players.values()) buildLabel(p);
  }
  function setTeams(teams) {              // { [id]: team }
    for (const [id, t] of Object.entries(teams || {})) {
      const p = players.get(id);
      if (p && p.team !== t) { p.team = t; }
    }
    for (const p of players.values()) buildLabel(p);
  }

  function update(id, position, rotation) {
    const p = players.get(id);
    if (!p) return;
    p.targetPos.set(position.x, position.y - 1.7, position.z);
    p.targetYaw = rotation.yaw;
  }

  function setHp(id, hp) {
    const p = players.get(id);
    if (!p) return;
    p.hp = hp;
    updateHpBar(p.hpBar, hp);
  }

  function kill(id) {
    const p = players.get(id);
    if (!p) return;
    p.alive = false;
    p.group.visible = false;
  }

  function respawn(id, position) {
    const p = players.get(id);
    if (!p) return;
    p.alive = true;
    p.hp = 100;
    updateHpBar(p.hpBar, 100);
    p.group.visible = true;
    p.group.position.set(position.x, position.y - 1.7, position.z);
    p.targetPos.copy(p.group.position);
    p.lastPos.copy(p.group.position);
  }

  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    scene.remove(p.group);
    p.handle?.dispose();
    disposeSprite(p.label);
    disposeSprite(p.hpBar);
    p.hitbox.geometry.dispose();
    p.hitbox.material.dispose();
    players.delete(id);
  }

  const targets = () => {
    const meshes = [];
    for (const p of players.values()) {
      if (p.alive && p.group.visible && !isFriendly(p)) meshes.push(p.hitbox);
    }
    return meshes;
  };

  function raycast(camera) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = targets();
    if (meshes.length === 0) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.playerId : null;
  }

  // Rayon arbitraire (dispersion, plombs de fusil...) : renvoie { id, dist, head } ou null.
  // Les alliés sont ignorés (pas de tir allié).
  const _origin = new THREE.Vector3();
  function raycastRay(origin, dir, maxDist = 300) {
    const meshes = targets();
    if (meshes.length === 0) return null;
    _origin.copy(origin);
    raycaster.set(_origin, dir);
    raycaster.far = maxDist;
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    const pl = players.get(h.object.userData.playerId);
    const feetY = pl ? pl.group.position.y : 0;
    return {
      id: h.object.userData.playerId,
      dist: h.distance,
      head: h.point.y - feetY > 1.5, // au-dessus de 1,50 m = tête
    };
  }

  const ids = () => Array.from(players.keys());
  const getTeam = (id) => (players.get(id) ? players.get(id).team : undefined);

  // Position des yeux d'un joueur (pour les tirs)
  function getEyePosition(id, out) {
    const p = players.get(id);
    if (!p) return null;
    return out.set(p.group.position.x, p.group.position.y + 1.6, p.group.position.z);
  }

  function tick(dt) {
    const lerp = Math.min(1, dt * 12);
    for (const p of players.values()) {
      if (!p.alive) continue;
      p.group.position.lerp(p.targetPos, lerp);
      let diff = p.targetYaw - p.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.group.rotation.y += diff * lerp;
      const moved = Math.hypot(p.group.position.x - p.lastPos.x, p.group.position.z - p.lastPos.z);
      p.speed += ((moved / Math.max(dt, 1e-3)) - p.speed) * Math.min(1, dt * 8);
      p.lastPos.copy(p.group.position);
      if (p.handle) p.handle.update(dt, { moving: p.speed > 0.8, speed: p.speed });
    }
  }

  function clear() {
    for (const id of Array.from(players.keys())) remove(id);
  }

  return {
    add, update, setHp, kill, respawn, remove, setLook, setWeapon, setContext, setTeams,
    raycast, raycastRay, getEyePosition, getTeam, ids, tick, clear,
  };
}
