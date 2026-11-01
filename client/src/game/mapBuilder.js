import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSETS } from './assetCatalog.js';
import { loadAsset, cloneModel } from './assetLoader.js';
import { generateMap, MAP_HALF } from './mapLayout.js';
import { createCollisionWorld } from './collision.js';

const CHUNK = 100; // les props sont regroupés par carrés de 100 m (pour que le culling fonctionne)

// ---------- Textures générées (aucun fichier image nécessaire) ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

function speckle(ctx, w, h, n, base, spread) {
  const r0 = (base >> 16) & 255, g0 = (base >> 8) & 255, b0 = base & 255;
  for (let i = 0; i < n; i++) {
    const k = 1 + (Math.random() - 0.5) * spread;
    ctx.fillStyle = `rgb(${Math.min(255, r0 * k)},${Math.min(255, g0 * k)},${Math.min(255, b0 * k)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
function grassTexture(base = 0x5b8c42) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1800, base, 0.28);
  });
}
function asphaltTexture(lines) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3a3a43'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, 0x3a3a43, 0.25);
    if (lines) {
      ctx.fillStyle = '#e8c23a';                     // axe jaune pointillé
      ctx.fillRect(10, h / 2 - 2, 120, 4);
      ctx.fillStyle = 'rgba(235,235,235,0.9)';       // lignes de rive
      ctx.fillRect(0, 6, w, 3);
      ctx.fillRect(0, h - 9, w, 3);
    }
  });
}
function concreteTexture(base) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 500, base, 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);
  });
}
function stripeTexture(base) {
  return canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = css(base); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < w; i += 16) ctx.fillRect(i, 0, 8, h);
    speckle(ctx, w, h, 300, base, 0.2);
  });
}

function layerMaterial(map, level) {
  return new THREE.MeshLambertMaterial({
    map,
    polygonOffset: true,
    polygonOffsetFactor: -level,
    polygonOffsetUnits: -level,
  });
}

function flatPlane(w, d, x, y, z) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// ---------- Construction principale ----------
export async function buildMap(scene, { spawns, onProgress } = {}) {
  const progress = (m) => onProgress && onProgress(m);
  const layout = generateMap(spawns && spawns.length ? spawns : undefined);
  const colliders = [];
  const disposables = [];

  // 1. Chargement des modèles
  const keys = Array.from(new Set(layout.props.map((p) => p.key)));
  let done = 0;
  const infos = new Map();
  await Promise.all(
    keys.map((k) =>
      loadAsset(k)
        .then((info) => infos.set(k, info))
        .catch((e) => console.warn(`⚠️ Modèle ignoré (${k}) :`, e?.message || e))
        .finally(() => { done++; progress(`Chargement des modèles… ${done}/${keys.length}`); })
    )
  );

  progress('Construction du terrain…');

  // 2. Sol de base (herbe)
  {
    const tex = grassTexture();
    tex.repeat.set(160, 160);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1900, 1900),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    disposables.push(m);
  }

  // 3. Zones de sol (militaire, champs, forêt...)
  for (let i = 0; i < layout.ground.length; i++) {
    const g = layout.ground[i];
    const tex = g.rows ? stripeTexture(g.color) : grassTexture(g.color);
    tex.repeat.set(g.w / (g.rows ? 6 : 10), g.d / (g.rows ? 6 : 10));
    const m = new THREE.Mesh(flatPlane(g.w, g.d, g.x, 0.02 + i * 0.0005, g.z), layerMaterial(tex, 1));
    scene.add(m);
    disposables.push(m);
  }

  // 4. Dalles de béton sous les blocs
  {
    const tex = concreteTexture(0xaaa89d);
    tex.repeat.set(26 / 3, 26 / 3);
    const geos = layout.slabs.map((s) => flatPlane(s.w, s.d, s.x, 0.04, s.z));
    if (geos.length) {
      const m = new THREE.Mesh(mergeGeometries(geos), layerMaterial(tex, 2));
      scene.add(m);
      disposables.push(m);
    }
  }

  // 5. Routes (segments avec marquage + intersections unies)
  {
    const segGeos = [];
    const interGeos = [];
    for (const r of layout.roads) {
      const g = new THREE.PlaneGeometry(r.dir === 'z' ? r.d : r.w, r.dir === 'z' ? r.w : r.d);
      if (r.dir) {
        // répète le marquage tous les 16 m le long de la route
        const len = r.dir === 'z' ? r.d : r.w;
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 16));
      }
      g.rotateX(-Math.PI / 2);
      if (r.dir === 'z') g.rotateY(Math.PI / 2);
      g.translate(r.x, 0.06, r.z);
      (r.dir ? segGeos : interGeos).push(g);
    }
    if (segGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(segGeos), layerMaterial(asphaltTexture(true), 3));
      scene.add(m); disposables.push(m);
    }
    if (interGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(interGeos), layerMaterial(asphaltTexture(false), 3));
      scene.add(m); disposables.push(m);
    }
  }

  // 6. Lac (non traversable)
  for (const w of layout.water) {
    const m = new THREE.Mesh(
      flatPlane(w.w, w.d, w.x, 0.12, w.z),
      new THREE.MeshStandardMaterial({
        color: 0x2f7fb5, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      })
    );
    scene.add(m); disposables.push(m);
    colliders.push({
      min: { x: w.x - w.w / 2, y: 0, z: w.z - w.d / 2 },
      max: { x: w.x + w.w / 2, y: 4, z: w.z + w.d / 2 },
    });
  }

  // 7. Volumes générés (escaliers, plateformes, néons, monument)
  {
    const solid = layout.boxes.filter((b) => !b.emissive);
    const glow = layout.boxes.filter((b) => b.emissive);
    const make = (list, material) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
      const mat = new THREE.Matrix4();
      const col = new THREE.Color();
      const qi = new THREE.Quaternion();
      list.forEach((b, i) => {
        mat.compose(
          new THREE.Vector3(b.x, b.y + b.h / 2, b.z),
          qi,
          new THREE.Vector3(b.w, b.h, b.d)
        );
        im.setMatrixAt(i, mat);
        im.setColorAt(i, col.setHex(b.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im); disposables.push(im);
    };
    make(solid, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    make(glow, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    for (const b of layout.boxes) {
      if (!b.collide) continue;
      colliders.push({
        min: { x: b.x - b.w / 2, y: b.y, z: b.z - b.d / 2 },
        max: { x: b.x + b.w / 2, y: b.y + b.h, z: b.z + b.d / 2 },
      });
    }
  }

  // Zones de gravité lunaire : disque lumineux + faisceau
  {
    const discGeo = new THREE.CylinderGeometry(1, 1, 0.1, 32);
    const beamGeo = new THREE.CylinderGeometry(1, 1, 7, 24, 1, true);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x4fc3ff });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (const pd of layout.pads) {
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.scale.set(pd.r, 1, pd.r);
      disc.position.set(pd.x, pd.y + 0.07, pd.z);
      const ring = new THREE.Mesh(discGeo, ringMat);
      ring.scale.set(pd.r * 1.12, 1, pd.r * 1.12);
      ring.position.set(pd.x, pd.y + 0.05, pd.z);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.scale.set(pd.r * 0.92, 1, pd.r * 0.92);
      beam.position.set(pd.x, pd.y + 3.6, pd.z);
      scene.add(disc, ring, beam);
      disposables.push(disc, ring, beam);
    }
  }

  progress('Placement des objets…');

  // 8. Props : instancing par (modèle × carré de 100 m) + colliders
  const groups = new Map(); // "key|cx|cz" -> placements
  const skinnedPlacements = [];
  for (const p of layout.props) {
    const info = infos.get(p.key);
    if (!info) continue;

    const spec = ASSETS[p.key];
    const coll = spec.coll || 'box';
    if (coll !== 'none') {
      const sx = info.scale * p.s;
      const sh = info.scale * p.s * p.sy;
      const w = info.rawSize.x * sx;
      const d = info.rawSize.z * sx;
      const h = info.rawSize.y * sh;
      if (h > 0.3) {
        const c = Math.abs(Math.cos(p.rot)), s = Math.abs(Math.sin(p.rot));
        let hx = (c * w + s * d) / 2;
        let hz = (s * w + c * d) / 2;
        if (coll === 'trunk') { hx = Math.min(hx, 0.35 * p.s); hz = Math.min(hz, 0.35 * p.s); }
        colliders.push({
          min: { x: p.x - hx, y: p.y, z: p.z - hz },
          max: { x: p.x + hx, y: p.y + h, z: p.z + hz },
        });
      }
    }

    if (info.skinned) { skinnedPlacements.push({ p, info }); continue; }
    const cx = Math.floor((p.x + MAP_HALF) / CHUNK);
    const cz = Math.floor((p.z + MAP_HALF) / CHUNK);
    const gk = `${p.key}|${cx}|${cz}`;
    let arr = groups.get(gk);
    if (!arr) { arr = []; groups.set(gk, arr); }
    arr.push(p);
  }

  const place = new THREE.Matrix4();
  const base = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const scl = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const vp = new THREE.Vector3();
  const vs = new THREE.Vector3();
  let drawables = 0;

  for (const [gk, list] of groups) {
    const info = infos.get(gk.split('|')[0]);
    const s = info.scale;
    // base = translation de recentrage × échelle de normalisation
    base.makeTranslation(-info.center.x * s, -info.minY * s, -info.center.z * s)
      .multiply(scl.makeScale(s, s, s));

    for (const sub of info.meshes) {
      const im = new THREE.InstancedMesh(sub.geometry, sub.material, list.length);
      const meshLocal = new THREE.Matrix4().copy(base).multiply(sub.local);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        vp.set(p.x, p.y, p.z);
        vs.set(p.s, p.s * p.sy, p.s);
        place.compose(vp, q, vs);
        tmp.multiplyMatrices(place, meshLocal);
        im.setMatrixAt(i, tmp);
      });
      im.instanceMatrix.needsUpdate = true;
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      im.computeBoundingSphere();
      scene.add(im);
      disposables.push(im);
      drawables++;
    }
  }

  // Modèles animés (chars) : clones classiques (peu nombreux)
  for (const { p, info } of skinnedPlacements) {
    const g = new THREE.Group();
    const inner = cloneModel(info.scene);
    inner.position.set(-info.center.x, -info.minY, -info.center.z);
    inner.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    g.add(inner);
    g.scale.setScalar(info.scale * p.s);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rot;
    scene.add(g);
    disposables.push(g);
  }

  // 9. Murs invisibles aux limites de la carte
  const H = MAP_HALF - 1.5;
  const T = 3;
  colliders.push(
    { min: { x: -H - T, y: -1, z: -H - T }, max: { x: H + T, y: 80, z: -H } },
    { min: { x: -H - T, y: -1, z: H }, max: { x: H + T, y: 80, z: H + T } },
    { min: { x: -H - T, y: -1, z: -H }, max: { x: -H, y: 80, z: H } },
    { min: { x: H, y: -1, z: -H }, max: { x: H + T, y: 80, z: H } }
  );

  // 10. Montagnes décoratives autour de la carte
  {
    const mat = new THREE.MeshLambertMaterial({ color: 0x59705f, flatShading: true });
    const geo = new THREE.ConeGeometry(1, 1, 6);
    const N = 36;
    const im = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const qi = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.08;
      const dist = 255 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 50;
      const r = 40 + (Math.sin(i * 4.1) * 0.5 + 0.5) * 35;
      const h = 45 + (Math.sin(i * 9.7) * 0.5 + 0.5) * 60;
      m.compose(
        new THREE.Vector3(Math.cos(a) * dist, h / 2 - 2, Math.sin(a) * dist),
        qi,
        new THREE.Vector3(r, h, r)
      );
      im.setMatrixAt(i, m);
    }
    im.computeBoundingSphere();
    scene.add(im); disposables.push(im);
  }

  const world = createCollisionWorld(colliders);
  console.log(
    `🗺️  Map : ${layout.props.length} objets, ${drawables} lots instanciés, ${world.count} colliders`
  );

  return {
    world,
    layout,
    pads: layout.pads,
    stats: { props: layout.props.length, drawables, colliders: world.count },
    dispose() {
      for (const o of disposables) scene.remove(o);
    },
  };
}
