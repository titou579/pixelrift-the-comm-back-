// ============================================================
// MAP LAYOUT — génère la carte (données pures, sans Three.js) à partir d'une graine fixe,
// donc identique chez tous les joueurs.
//
//  Carte 340 × 340 m (de -170 à +170) :
//   • Centre-ville : damier de rues, 16 blocs d'immeubles avec cours intérieures
//   • Route circulaire (anneau) à ±100 m avec des parcs entre la ville et l'anneau
//   • Nord-Ouest : base militaire (chars, camions, barrières)
//   • Nord-Est   : quartier cyberpunk (plateformes avec escaliers, néons, tours TV)
//   • Sud-Ouest / Ouest : ferme (granges, silos, moulin, champs)
//   • Sud-Est / Est : camping, lac avec île, forêt dense
//   • Nord/Sud centre : relais routier (épaves, panneaux) et grand parc
//
//  Pour modifier la carte : change les constantes ci-dessous ou les fonctions de zone.
// ============================================================
import { ASSETS } from './assetCatalog.js';

export const MAP_HALF = 170;
const RW = 10; // largeur des routes
const GRID = [-100, -72, -36, 0, 36, 72, 100];
const INNER = [-72, -36, 0, 36, 72];

export const DEFAULT_SPAWNS = [
  [-18, 0], [18, 0], [0, -18], [0, 18], [-54, 0], [54, 0], [0, -54], [0, 54],
  [-18, 36], [18, -36], [-54, -36], [54, 36], [-18, -72], [18, 72], [-72, 18], [72, -18],
].map(([x, z]) => ({ x, y: 1.7, z }));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(spawns = DEFAULT_SPAWNS, seed = 20261021) {
  const rand = mulberry32(seed);
  const rnd = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;

  const out = {
    half: MAP_HALF,
    roads: [],      // {x,z,w,d,dir:'x'|'z'|null}
    slabs: [],      // dalles de béton {x,z,w,d,color}
    ground: [],     // zones de sol colorées {x,z,w,d,color}
    water: [],      // {x,z,w,d}
    boxes: [],      // volumes générés {x,y,z,w,h,d,color,emissive,collide}
    props: [],      // {key,x,y,z,rot,s,sy}
    spawns,
    zones: [],      // pour debug / minimap
    pads: [],       // zones de gravité lunaire {x,z,y,r}
  };

  // ---------- Occupation du sol (évite les chevauchements) ----------
  const occ = [];
  const addCircle = (x, z, r) => occ.push({ c: true, x, z, r });
  const addRect = (x0, z0, x1, z1) => occ.push({ c: false, x0, x1, z0, z1 });

  function hitsOcc(x, z, r) {
    for (const o of occ) {
      if (o.c) {
        const dx = x - o.x, dz = z - o.z, rr = r + o.r;
        if (dx * dx + dz * dz < rr * rr) return true;
      } else {
        const cx = Math.max(o.x0, Math.min(x, o.x1));
        const cz = Math.max(o.z0, Math.min(z, o.z1));
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }
  function onRoad(x, z, margin = 0) {
    for (const r of out.roads) {
      if (Math.abs(x - r.x) < r.w / 2 + margin && Math.abs(z - r.z) < r.d / 2 + margin) return true;
    }
    return false;
  }
  function nearSpawn(x, z, r) {
    for (const s of spawns) {
      if (Math.hypot(x - s.x, z - s.z) < 4.5 + r) return true;
    }
    return false;
  }
  const inBounds = (x, z, m = 4) => Math.abs(x) < MAP_HALF - m && Math.abs(z) < MAP_HALF - m;

  // road=true : l'objet a le droit d'être sur la chaussée (voitures, barrières...)
  function isFree(x, z, r, road = false) {
    return inBounds(x, z) && (road || !onRoad(x, z, r * 0.6)) && !nearSpawn(x, z, r) && !hitsOcc(x, z, r);
  }

  // ---------- Placement ----------
  function put(key, x, z, rot = 0, o = {}) {
    const a = ASSETS[key];
    if (!a) return false;
    const s = o.s ?? 1;
    out.props.push({ key, x, y: o.y ?? 0, z, rot, s, sy: o.sy ?? 1 });
    if (!o.noOcc) addCircle(x, z, (a.r || 1) * s * 0.9);
    return true;
  }
  function tryPut(key, x, z, rot = 0, o = {}) {
    const a = ASSETS[key];
    if (!a) return false;
    if (!isFree(x, z, (a.r || 1) * (o.s ?? 1) * 0.9, !!o.road)) return false;
    return put(key, x, z, rot, o);
  }
  function scatter(keys, rect, n, o = {}) {
    let placed = 0;
    for (let i = 0; i < n * 6 && placed < n; i++) {
      const x = rnd(rect[0], rect[2]);
      const z = rnd(rect[1], rect[3]);
      if (o.avoid && o.avoid(x, z)) continue;
      const key = Array.isArray(keys) ? pick(keys) : keys;
      const s = o.sMin ? rnd(o.sMin, o.sMax) : 1;
      if (tryPut(key, x, z, rand() * Math.PI * 2, { s, sy: o.sy ? rnd(o.sy[0], o.sy[1]) : 1 })) placed++;
    }
    return placed;
  }
  // Aligne l'axe +X du modèle sur le segment
  function line(key, x1, z1, x2, z2, spacing, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.floor(len / spacing));
    const rot = -Math.atan2(z2 - z1, x2 - x1) + (o.rotAdd || 0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      if (o.gap && o.gap(x, z)) continue;
      if (o.force) put(key, x, z, rot, { ...o, noOcc: o.noOcc });
      else tryPut(key, x, z, rot, o);
    }
  }
  const box = (x, y, z, w, h, d, color, extra = {}) => {
    out.boxes.push({ x, y, z, w, h, d, color, emissive: !!extra.emissive, collide: extra.collide !== false });
  };

  // =====================================================
  // 1. ROUTES
  // =====================================================
  function road(x, z, w, d, dir) {
    out.roads.push({ x, z, w, d, dir });
  }
  // Segments entre intersections + carrés d'intersection
  for (const g of GRID) {
    for (let i = 0; i < GRID.length - 1; i++) {
      const a = GRID[i] + RW / 2;
      const b = GRID[i + 1] - RW / 2;
      road(g, (a + b) / 2, RW, b - a, 'z');   // route nord-sud en x = g
      road((a + b) / 2, g, b - a, RW, 'x');   // route est-ouest en z = g
    }
  }
  for (const gx of GRID) for (const gz of GRID) road(gx, gz, RW, RW, null);
  // Autoroutes qui sortent de l'anneau (axes x=0 et z=0)
  const HW0 = 105, HW1 = MAP_HALF - 4;
  for (const s of [-1, 1]) {
    road(0, s * (HW0 + HW1) / 2, RW, HW1 - HW0, 'z');
    road(s * (HW0 + HW1) / 2, 0, HW1 - HW0, RW, 'x');
  }

  // Dalles de béton sous les 16 blocs du centre-ville
  const blockCenters = [];
  for (let i = 0; i < INNER.length - 1; i++) {
    for (let j = 0; j < INNER.length - 1; j++) {
      const cx = (INNER[i] + INNER[i + 1]) / 2;
      const cz = (INNER[j] + INNER[j + 1]) / 2;
      blockCenters.push([cx, cz]);
      out.slabs.push({ x: cx, z: cz, w: 26, d: 26, color: 0xaaa89d });
    }
  }

  // =====================================================
  // 2. CENTRE-VILLE : immeubles par blocs
  // =====================================================
  const ROW_N = ['bld_green', 'bld_red', 'bld_gb', 'bld_rb', 'bld_brown', 'bld_green', 'bld_red'];
  const ROW_S = ['bld_green', 'bld_red', 'bld_gb', 'bld_rb'];
  const SMALL = ['bld_pizza', 'bld_redcorner'];

  function fillRow(types, L) {
    const chosen = [];
    let used = 0;
    for (let i = 0; i < 4; i++) {
      const fit = types.filter((k) => used + ASSETS[k].fp[0] <= L);
      if (!fit.length) break;
      const k = pick(fit);
      chosen.push(k);
      used += ASSETS[k].fp[0];
    }
    return { chosen, used };
  }
  function placeBuilding(key, x, z, rot, sy) {
    const a = ASSETS[key];
    const [w, d] = a.fp;
    const sideways = Math.abs(Math.sin(rot)) > 0.5;
    const hx = (sideways ? d : w) / 2;
    const hz = (sideways ? w : d) / 2;
    addRect(x - hx, z - hz, x + hx, z + hz);
    out.props.push({ key, x, y: 0, z, rot, s: 1, sy });
  }

  for (const [cx, cz] of blockCenters) {
    const F = 10.5; // distance centre-bloc → façade
    // Rangée nord (façade vers -z) : peut contenir un grand bâtiment
    let northRow = ROW_N;
    let hasBig = false;
    if (chance(0.3)) { northRow = ['bld_big', 'bld_green', 'bld_red']; hasBig = true; }
    const rn = fillRow(northRow, 26);
    let x = cx - 13 + (26 - rn.used) / (rn.chosen.length + 1);
    const gapN = (26 - rn.used) / (rn.chosen.length + 1);
    for (const k of rn.chosen) {
      const [w, d] = ASSETS[k].fp;
      placeBuilding(k, x + w / 2, cz - F + d / 2, Math.PI, rnd(0.85, 1.4));
      x += w + gapN;
    }
    // Rangée sud (façade vers +z)
    const rs = fillRow(ROW_S, 26);
    const gapS = (26 - rs.used) / (rs.chosen.length + 1);
    x = cx - 13 + gapS;
    for (const k of rs.chosen) {
      const [w, d] = ASSETS[k].fp;
      placeBuilding(k, x + w / 2, cz + F - d / 2, 0, rnd(0.85, 1.4));
      x += w + gapS;
    }
    // Petits bâtiments sur les côtés ouest / est
    if (!hasBig) {
      if (chance(0.7)) placeBuilding(pick(SMALL), cx - F + 2.3, cz, -Math.PI / 2, rnd(0.9, 1.3));
      if (chance(0.7)) placeBuilding(pick(SMALL), cx + F - 2.3, cz, Math.PI / 2, rnd(0.9, 1.3));
    }
  }

  // Mobilier de cour intérieure (entre les rangées)
  for (const [cx, cz] of blockCenters) {
    const cour = [cx - 9, cz - 2.2, cx + 9, cz + 2.2];
    scatter('tree_c', cour, chance(0.6) ? 2 : 1, { sMin: 0.7, sMax: 1.0 });
    scatter(['dumpster', 'crate', 'box_pile', 'trash_can', 'bench'], cour, 4);
    scatter(['bush_small', 'bush_long', 'flowerpot', 'planter'], cour, 3);
    if (chance(0.5)) scatter(['car_sedan', 'car_hatch', 'van', 'pickup'], cour, 1);
  }

  // =====================================================
  // 3. MOBILIER URBAIN le long des routes
  // =====================================================
  const CARS = ['car_sedan', 'car_hatch', 'car_police', 'car_suv', 'car_sports', 'car_sports2', 'car_taxi'];
  function pole(key, px, pz, rot) {
    // Le lampadaire a son poteau à l'extrémité +X du modèle (bras vers -X) : on décale le centre
    const c = Math.cos(rot), s = Math.sin(rot);
    return put(key, px - 0.68 * c, pz + 0.68 * s, rot);
  }
  for (const r of out.roads) {
    if (!r.dir) continue;
    if (Math.abs(r.x) > 105 || Math.abs(r.z) > 105) continue; // autoroutes traitées à part
    const len = r.dir === 'z' ? r.d : r.w;
    if (len < 20) continue;
    const alongStart = (r.dir === 'z' ? r.z - r.d / 2 : r.x - r.w / 2);
    // Lampadaires tous les ~24 m, côtés alternés
    const n = Math.floor(len / 24);
    for (let i = 0; i < n; i++) {
      const t = alongStart + (i + 0.5) * (len / n);
      const side = i % 2 === 0 ? -1 : 1;
      if (r.dir === 'z') {
        const px = r.x + side * 5.8;
        pole('street_light', px, t, side < 0 ? Math.PI : 0);
      } else {
        const pz = r.z + side * 5.8;
        pole('street_light', t, pz, side < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    // Voitures garées sur les voies
    const cars = Math.max(1, Math.floor(len / 16));
    for (let i = 0; i < cars; i++) {
      if (!chance(0.65)) continue;
      const t = alongStart + (i + rnd(0.2, 0.8)) * (len / cars);
      const side = chance(0.5) ? -1 : 1;
      const key = pick(CARS);
      if (r.dir === 'z') {
        tryPut(key, r.x + side * 3.4, t, chance(0.5) ? 0 : Math.PI, { road: true });
      } else {
        tryPut(key, t, r.z + side * 3.4, chance(0.5) ? Math.PI / 2 : -Math.PI / 2, { road: true });
      }
    }
    // Bouches d'incendie, poubelles, bornes
    if (chance(0.6)) {
      const t = alongStart + rnd(0.2, 0.8) * len;
      const side = chance(0.5) ? -1 : 1;
      if (r.dir === 'z') tryPut(pick(['hydrant', 'trash_can', 'mailbox', 'bollard']), r.x + side * 5.6, t, 0);
      else tryPut(pick(['hydrant', 'trash_can', 'mailbox', 'bollard']), t, r.z + side * 5.6, 0);
    }
  }
  // Feux et panneaux aux intersections du centre-ville
  for (const gx of INNER) {
    for (const gz of INNER) {
      put('traffic_light', gx + 6.4, gz - 6.4, 0, { noOcc: false });
      put('traffic_light', gx - 6.4, gz + 6.4, 0);
      if (chance(0.5)) put('stop_sign', gx - 6.4, gz - 6.4, 0);
      if (chance(0.5)) put('stop_sign', gx + 6.4, gz + 6.4, Math.PI);
      if (chance(0.5)) put('manhole', gx + rnd(-2, 2), gz + rnd(-2, 2), rand() * 3, { noOcc: true });
    }
  }
  // Monument central au milieu de l'intersection principale
  box(0, 0, 0, 7, 0.6, 7, 0x8c8a82);
  box(0, 0.6, 0, 3, 1.2, 3, 0x6f6d66);
  box(0, 1.8, 0, 1.4, 7, 1.4, 0xd9d6cc);
  box(0, 8.8, 0, 2.2, 0.5, 2.2, 0x55c1ff, { emissive: true });
  addCircle(0, 0, 5);

  // =====================================================
  // 4. PARCS entre la ville et l'anneau (|coord| entre 77 et 95)
  // =====================================================
  const parkRects = [
    [-95, -95, 95, -77], [-95, 77, 95, 95], [-95, -77, -77, 77], [77, -77, 95, 77],
  ];
  for (const r of parkRects) {
    scatter(['tree_c', 'tree_long'], r, 14, { sMin: 0.8, sMax: 1.15 });
    scatter(['bush_long', 'bush_small'], r, 14);
    scatter(['bench', 'trash_can', 'planter', 'flowerpot'], r, 5);
  }
  // Arrêts de bus sur l'anneau
  for (const [x, z, rot] of [[-83, 102, 0], [83, -102, Math.PI], [102, 83, -Math.PI / 2], [-102, -83, Math.PI / 2]]) {
    tryPut('busstop', x, z, rot);
  }

  // =====================================================
  // 5. ZONES EXTÉRIEURES
  // =====================================================
  // ---------- 5a. BASE MILITAIRE (nord-ouest) ----------
  {
    const R = [-165, -165, -65, -110];
    out.zones.push({ name: 'Base militaire', rect: R, color: 0x6a6a4c });
    out.ground.push({ x: (R[0] + R[2]) / 2, z: (R[1] + R[3]) / 2, w: R[2] - R[0], d: R[3] - R[1], color: 0x6b6a4e });
    // Clôture avec deux entrées
    line('fence_piece', R[0], R[3] - 1, -117, R[3] - 1, 2.2, { force: true, noOcc: true });
    line('fence_piece', -105, R[3] - 1, R[2], R[3] - 1, 2.2, { force: true, noOcc: true });
    line('fence_piece', R[2] - 1, R[1], R[2] - 1, -142, 2.2, { force: true, noOcc: true });
    line('fence_piece', R[2] - 1, -132, R[2] - 1, R[3], 2.2, { force: true, noOcc: true });
    // Bâtiments / hangars
    put('barn_small', -150, -150, 0, { s: 1.05 });
    put('barn_small', -125, -155, 0, { s: 1.05 });
    put('barn_open', -90, -152, 0);
    // Chars et véhicules
    put('tank1', -138, -134, 0.5, { noOcc: false });
    put('tank2', -100, -138, -2.4);
    put('tank3', -78, -126, 2.2);
    put('truck_mil', -112, -122, 0.1);
    put('truck_mil', -145, -118, 3.3);
    put('truck_mil', -82, -150, 1.4);
    // Barrières : mini labyrinthe
    line('barrier', -160, -128, -130, -128, 2.2);
    line('barrier', -118, -158, -118, -138, 2.2);
    line('barrier', -100, -118, -70, -118, 2.2);
    line('barrier', -135, -150, -135, -140, 2.2);
    line('barrier', -75, -160, -75, -140, 2.2);
    scatter(['guncase', 'crate', 'box_pile'], R, 22);
    scatter(['cone', 'bollard'], R, 16);
    scatter(['rock', 'bush_small'], R, 10);
  }

  // ---------- 5b. QUARTIER CYBERPUNK (nord-est) ----------
  {
    const R = [65, -165, 165, -110];
    out.zones.push({ name: 'Cyberpunk', rect: R, color: 0x2b3040 });
    out.ground.push({ x: (R[0] + R[2]) / 2, z: (R[1] + R[3]) / 2, w: R[2] - R[0], d: R[3] - R[1], color: 0x2a2e3c });

    const NEON = [0xff2fb9, 0x00eaff, 0x8b5cf6, 0xffd93d];
    const METAL = 0x3a3f52;

    // Plateforme avec escalier : surface à la hauteur H, escalier le long de +X ou -X
    function platform(cx, cz, w, d, H, dir) {
      const th = 0.4;
      box(cx, H - th, cz, w, th, d, METAL);                            // dalle
      box(cx, H - th - 0.05, cz, w + 0.4, 0.12, d + 0.4, NEON[Math.floor(rand() * 3)], { emissive: true, collide: false });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {            // piliers
        box(cx + sx * (w / 2 - 0.5), 0, cz + sz * (d / 2 - 0.5), 0.6, H - th, 0.6, 0x2a2e3c);
      }
      const steps = Math.round(H / 0.4);
      const tread = 0.95;
      for (let i = 0; i < steps; i++) {
        const top = (i + 1) * 0.4;
        const off = w / 2 + (steps - i - 0.5) * tread; // la marche la plus haute touche la plateforme
        box(cx + dir * off, 0, cz, tread, top, 3.2, 0x4a5068);
      }
      // garde-corps néon
      box(cx, H, cz - d / 2 + 0.1, w, 0.9, 0.12, 0x00eaff, { emissive: true, collide: false });
      box(cx, H, cz + d / 2 - 0.1, w, 0.9, 0.12, 0xff2fb9, { emissive: true, collide: false });
      const sw = steps * tread + 2;
      addRect(cx - w / 2 - 1, cz - d / 2 - 1, cx + w / 2 + 1, cz + d / 2 + 1);
      addRect(dir > 0 ? cx + w / 2 : cx - w / 2 - sw, cz - 1.8, dir > 0 ? cx + w / 2 + sw : cx - w / 2, cz + 1.8);
      return H;
    }
    const H1 = platform(95, -138, 18, 14, 3.2, 1);
    const H2 = platform(138, -150, 16, 14, 4.8, -1);
    const H3 = platform(120, -122, 12, 8, 2.4, 1);
    // Objets sur les plateformes
    put('tvtower', 92, -140, 0, { y: H1, noOcc: true });
    put('computer_big', 100, -135, Math.PI, { y: H1, noOcc: true });
    put('antenna', 90, -134, 0, { y: H1, noOcc: true });
    put('lootbox', 99, -142, 0.4, { y: H1, noOcc: true });
    put('turret_gun', 135, -148, 0, { y: H2, noOcc: true });
    put('ac_stack', 142, -154, 0, { y: H2, noOcc: true });
    put('lootbox', 134, -154, 1, { y: H2, noOcc: true });
    put('pickup_health', 120, -122, 0, { y: H3 + 0.6, noOcc: true });
    put('turret_cannon', 123, -120, 0, { y: H3, noOcc: true });

    // Néons au sol
    for (let i = 0; i < 6; i++) {
      const z = -160 + i * 8.5;
      box(115, 0.04, z, 70, 0.06, 0.25, NEON[i % 4], { emissive: true, collide: false });
    }
    // Colonnes néon
    for (let i = 0; i < 16; i++) {
      const x = rnd(70, 160), z = rnd(-162, -113);
      if (!isFree(x, z, 1.5)) continue;
      box(x, 0, z, 0.5, rnd(5, 9), 0.5, NEON[i % 4], { emissive: true });
      addCircle(x, z, 1.2);
    }
    // Rue néon avec lampadaires
    line('light_cp', 70, -112, 160, -112, 14, { force: true, rotAdd: Math.PI / 2 });
    scatter(['tvtower', 'antenna'], R, 8);
    scatter(['ac1', 'ac2', 'ac_stack', 'computer', 'computer_big', 'tv1', 'tv2'], R, 26);
    scatter(['lootbox', 'barrel_cp', 'crate'], R, 12);
    scatter(['turret_gun', 'turret_cannon'], R, 4);
    scatter(['pickup_health', 'pickup_heart'], R, 5, {});
    scatter(['light_cp', 'light_cp2', 'light_sq'], R, 12);
  }

  // ---------- 5c. FERME (sud-ouest + bande ouest) ----------
  {
    const R = [-165, 110, -65, 165];
    out.zones.push({ name: 'Ferme', rect: R, color: 0x6d8f3a });
    out.ground.push({ x: (R[0] + R[2]) / 2, z: (R[1] + R[3]) / 2, w: R[2] - R[0], d: R[3] - R[1], color: 0x7a9a3e });
    // Cour de ferme (terre battue)
    out.ground.push({ x: -118, z: 138, w: 62, d: 44, color: 0x8a6e45 });
    put('barn_big', -140, 144, 0.15);
    put('barn', -108, 150, -0.1);
    put('barn_open', -84, 132, Math.PI / 2);
    put('barn_small', -148, 120, 0);
    put('silo', -122, 126, 0);
    put('silo', -114, 126, 0);
    put('silohouse', -96, 122, 0);
    put('windmill', -76, 152, 0.4);
    put('coop', -128, 156, 0);
    put('coop', -104, 140, 1.2);
    // Champs de la bande ouest
    const crops = [0xc8a84a, 0x5f8f2f, 0x6e4b2b, 0x86a83c, 0xc2a03e];
    for (let i = 0; i < 5; i++) {
      const cz = -84 + i * 42;
      out.ground.push({ x: -138, z: cz, w: 48, d: 38, color: crops[i], rows: true });
      line('fence_farm', -162, cz - 20, -112, cz - 20, 6, { force: true, noOcc: true });
    }
    line('fence_farm', -112, -105, -112, 105, 6, { force: true, noOcc: true });
    // Enclos
    line('fence_farm', -162, 112, -112, 112, 6, { force: true, noOcc: true });
    line('fence_farm2', -162, 164, -162, 112, 6, { force: true, noOcc: true });
    scatter(['tree_c', 'tree_long'], [-165, -105, -112, 105], 14, { sMin: 0.9, sMax: 1.2 });
    scatter(['tree_c', 'tree_long', 'bush_long'], R, 18, { sMin: 0.9, sMax: 1.2 });
    scatter(['crate', 'box_pile', 'bench', 'trash_can'], R, 10);
    scatter(['rock'], R, 6);
  }

  // ---------- 5d. CAMPING + LAC + FORÊT (sud-est + bande est) ----------
  {
    const R = [65, 110, 165, 165];
    out.zones.push({ name: 'Camping & forêt', rect: R, color: 0x3f6a30 });
    out.ground.push({ x: 138, z: 0, w: 56, d: 215, color: 0x3d6a2f });
    out.ground.push({ x: 115, z: 138, w: 100, d: 55, color: 0x3d6a2f });
    // Lac + île (non traversable)
    out.water.push({ x: 142, z: 0, w: 42, d: 64 });
    put('island', 142, 0, 0.6, { noOcc: true });
    addRect(121, -32, 163, 32);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const x = 142 + Math.cos(a) * 24, z = Math.sin(a) * 35;
      put('rock', x, z, rand() * 6, { s: rnd(0.9, 1.6), noOcc: true });
    }
    // Campements
    function camp(cx, cz, nTents) {
      put('campfire', cx, cz, 0, { noOcc: true });
      put('fire', cx, cz, 0, { noOcc: true, y: 0.15 });
      addCircle(cx, cz, 2.2);
      for (let i = 0; i < nTents; i++) {
        const a = (i / nTents) * Math.PI * 2 + rnd(-0.2, 0.2);
        put('tent', cx + Math.cos(a) * 8, cz + Math.sin(a) * 8, -a + Math.PI / 2, { noOcc: false });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        put('log', cx + Math.cos(a) * 3.2, cz + Math.sin(a) * 3.2, -a, {});
      }
      scatter(['rock', 'crate', 'trash_bag'], [cx - 12, cz - 12, cx + 12, cz + 12], 5);
    }
    camp(95, 138, 5);
    camp(140, 128, 4);
    camp(142, -72, 4);
    camp(118, 80, 3);
    // Forêt dense
    scatter(['tree_camp', 'tree_c', 'tree_long'], [112, -105, 166, 105], 90, { sMin: 0.85, sMax: 1.3 });
    scatter(['tree_camp', 'tree_c', 'tree_long'], R, 70, { sMin: 0.85, sMax: 1.3 });
    scatter(['bush_long', 'bush_small'], [100, -105, 166, 166], 60);
    scatter(['rock', 'log'], [100, -105, 166, 166], 40, { sMin: 0.8, sMax: 1.6 });
  }

  // ---------- 5e. RELAIS ROUTIER (nord centre) ----------
  {
    const R = [-60, -165, 60, -110];
    out.zones.push({ name: 'Relais routier', rect: R, color: 0x5a6a45 });
    put('billboard', -14, -145, Math.PI / 2);
    put('billboard', 16, -132, -Math.PI / 2);
    put('billboard', -20, -118, Math.PI / 2);
    put('bus', -28, -150, 0.3);
    put('van', 22, -150, 2.2);
    put('pickup', -9, -126, 0.2);
    put('car_police', 8, -121, 0.5);
    put('car_police', -8, -137, -0.4);
    put('car_taxi', 12, -142, 1.1);
    line('barrier', -12, -112, 12, -112, 2.2, { road: true });
    scatter(['cone', 'bollard', 'barrier'], R, 14);
    scatter(['crate', 'box_pile', 'dumpster', 'trash_can'], R, 12);
    scatter(['tree_c', 'tree_long', 'tree_camp'], R, 22, { sMin: 0.9, sMax: 1.2 });
    scatter(['rock', 'bush_long'], R, 14);
  }

  // ---------- 5f. GRAND PARC (sud centre) ----------
  {
    const R = [-60, 110, 60, 165];
    out.zones.push({ name: 'Parc sud', rect: R, color: 0x5b8f3e });
    out.ground.push({ x: 0, z: 138, w: 120, d: 55, color: 0x5e9440 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put('bench', Math.cos(a) * 16, 140 + Math.sin(a) * 16, -a - Math.PI / 2, { noOcc: false });
    }
    scatter(['tree_c', 'tree_long'], R, 38, { sMin: 0.9, sMax: 1.25 });
    scatter(['bush_long', 'bush_small', 'planter', 'flowerpot'], R, 26);
    scatter(['busstop', 'trash_can', 'hydrant', 'bike_rack'], R, 8);
    put('bus', 30, 118, 1.6);
  }

  // ---------- 5g. Remplissage forestier hors anneau ----------
  const insideRing = (x, z) => Math.abs(x) < 109 && Math.abs(z) < 109;
  scatter(['tree_c', 'tree_long', 'tree_camp'], [-165, -165, 165, 165], 220, { sMin: 0.85, sMax: 1.3, avoid: insideRing });
  scatter(['bush_long', 'bush_small', 'rock'], [-165, -165, 165, 165], 120, { avoid: insideRing });
  // Ceinture d'arbres au bord de la carte
  for (let i = 0; i < 340; i++) {
    const side = Math.floor(rand() * 4);
    const t = rnd(-MAP_HALF + 5, MAP_HALF - 5);
    const d = rnd(MAP_HALF - 14, MAP_HALF - 5);
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? -d : d;
    const z = side === 0 ? -d : side === 1 ? d : t;
    tryPut(pick(['tree_c', 'tree_long', 'tree_camp']), x, z, rand() * 6, { s: rnd(0.9, 1.4) });
  }

  // =====================================================
  // 6. ZONES DE GRAVITÉ LUNAIRE (disques bleus lumineux)
  // =====================================================
  const PADS = [
    [0, -30, 0], [0, 30, 0], [-30, 0, 0], [30, 0, 0],       // avenues du centre-ville
    [-54, -54, 0], [54, 54, 0],                              // rues des quartiers
    [88, -142, 3.2], [140, -146, 4.8],                       // sur les plateformes cyberpunk
    [-118, -125, 0], [-118, 140, 0],                         // base militaire, cour de ferme
    [118, 100, 0], [0, -128, 0], [0, 140, 0],                // camping, relais routier, parc
  ];
  for (const [x, z, y] of PADS) out.pads.push({ x, z, y, r: 2.4 });

  return out;
}
