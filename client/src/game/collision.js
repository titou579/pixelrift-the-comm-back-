// ============================================================
// COLLISIONS — boîtes alignées sur les axes (AABB) rangées dans une grille 2D,
// pour ne tester que les objets proches du joueur (indispensable sur une grande map).
// Une boîte = { min:{x,y,z}, max:{x,y,z} } (compatible THREE.Box3).
// ============================================================

export function createCollisionWorld(boxes, cell = 12) {
  const grid = new Map();
  const keyOf = (cx, cz) => (cx + 1024) * 2048 + (cz + 1024);

  function insert(b) {
    const x0 = Math.floor(b.min.x / cell);
    const x1 = Math.floor(b.max.x / cell);
    const z0 = Math.floor(b.min.z / cell);
    const z1 = Math.floor(b.max.z / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = keyOf(cx, cz);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(b);
      }
    }
  }
  boxes.forEach(insert);

  // Boîtes dont l'empreinte (XZ) touche le carré [x±r, z±r]
  function nearby(x, z, r = 1) {
    const out = [];
    const seen = new Set();
    const x0 = Math.floor((x - r) / cell);
    const x1 = Math.floor((x + r) / cell);
    const z0 = Math.floor((z - r) / cell);
    const z1 = Math.floor((z + r) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = grid.get(keyOf(cx, cz));
        if (!arr) continue;
        for (const b of arr) {
          if (seen.has(b)) continue;
          seen.add(b);
          out.push(b);
        }
      }
    }
    return out;
  }

  // Distance jusqu'au premier obstacle sur un rayon (Infinity si rien)
  function raycast(ox, oy, oz, dx, dy, dz, maxDist = 250) {
    const candidates = new Set();
    const step = cell * 0.25;
    for (let t = 0; t <= maxDist + step; t += step) {
      const px = ox + dx * t;
      const pz = oz + dz * t;
      const cx = Math.floor(px / cell);
      const cz = Math.floor(pz / cell);
      const arr = grid.get(keyOf(cx, cz));
      if (arr) for (const b of arr) candidates.add(b);
    }
    let best = Infinity;
    for (const b of candidates) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t >= 0 && t < best && t <= maxDist) best = t;
    }
    return best;
  }

  return { nearby, raycast, count: boxes.length };
}

// Intersection rayon / AABB (méthode des "slabs"). Retourne t >= 0 ou -1.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.min.x, b.min.y, b.min.z];
  const mx = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
