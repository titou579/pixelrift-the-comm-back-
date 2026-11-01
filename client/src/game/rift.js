import * as THREE from 'three';

export function createRift(scene, camera, player) {
  const RANGE = 7;
  const COOLDOWN = 4;

  let lastUse = -Infinity;
  const portals = [];

  function spawnPortal(pos, color) {
    const geo = new THREE.TorusGeometry(0.8, 0.15, 8, 24);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.lookAt(camera.position);
    scene.add(mesh);
    portals.push({ mesh, life: 3 });
  }

  function canUse() {
    const now = performance.now() / 1000;
    return now - lastUse >= COOLDOWN;
  }

  function use() {
    if (!canUse()) return false;
    lastUse = performance.now() / 1000;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();

    const from = player.state.position.clone();
    from.y = 1.0;

    // Distance aléatoire (courte), en reculant si la destination est dans un mur
    let to = null;
    const base = RANGE * (0.6 + Math.random() * 0.4);
    for (let d = base; d >= 1.5; d -= 1.5) {
      const cand = player.state.position.clone().add(dir.clone().multiplyScalar(d));
      cand.y = player.state.position.y;
      if (!player.canStandAt || player.canStandAt(cand.x, cand.y, cand.z)) { to = cand; break; }
    }
    if (!to) { lastUse = -Infinity; return false; }

    spawnPortal(from, 0xff2fb9);
    spawnPortal(to, 0x00eaff);

    player.state.position.copy(to);
    return true;
  }

  function update(dt) {
    for (let i = portals.length - 1; i >= 0; i--) {
      const p = portals[i];
      p.life -= dt;
      p.mesh.rotation.z += dt * 2.5;
      p.mesh.material.opacity = Math.min(1, p.life);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        portals.splice(i, 1);
      }
    }
  }

  return { use, update, canUse };
}
