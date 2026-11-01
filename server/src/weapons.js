// ============================================================
// ARMES, RÉGÉNÉRATION ET POINTS D'APPARITION — source de vérité côté serveur.
// Le client récupère ces données via GET /api/game-config.
//
//  damage     : dégâts par balle (ou par plomb pour les fusils à pompe)
//  pellets    : nombre de plombs par tir
//  fireRate   : tirs par seconde (en rafale : cadence dans la rafale)
//  mode       : 'auto' | 'semi' | 'burst'
//  burst      : nb de tirs par rafale (mode burst) ; burstDelay = pause entre rafales (s)
//  mag        : taille du chargeur ; reload = durée du rechargement (s)
//  spread     : dispersion en degrés (tir à la hanche) ; adsSpread : en visée (clic droit)
//  range      : [distance sans perte, distance à partir de laquelle on tombe à falloff]
//  falloff    : multiplicateur de dégâts au-delà de la portée max (0..1)
//  headMult   : multiplicateur de dégâts à la tête
//  recoil     : recul vertical (degrés) par tir
//  moveMult   : multiplicateur de vitesse de déplacement quand l'arme est en main
//  zoom       : FOV en visée (null = pas de zoom marqué) ; scope : lunette plein écran
// ============================================================

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Pistolet', type: 'Pistolet',
    damage: 18, pellets: 1, fireRate: 6.5, mode: 'semi',
    mag: 15, reload: 1.1, spread: 1.3, adsSpread: 0.4,
    range: [30, 80], falloff: 0.55, headMult: 1.8, recoil: 0.9, moveMult: 1.05,
    zoom: 62, scope: false, tracer: '#ffe9a8',
  },
  deagle: {
    id: 'deagle', name: 'Pistolet lourd', type: 'Pistolet',
    damage: 38, pellets: 1, fireRate: 2.6, mode: 'semi',
    mag: 8, reload: 1.7, spread: 1.0, adsSpread: 0.25,
    range: [35, 90], falloff: 0.55, headMult: 1.8, recoil: 3.2, moveMult: 1.0,
    zoom: 62, scope: false, tracer: '#ffd27a',
  },
  revolver: {
    id: 'revolver', name: 'Revolver', type: 'Revolver',
    damage: 55, pellets: 1, fireRate: 1.5, mode: 'semi',
    mag: 6, reload: 2.5, spread: 0.8, adsSpread: 0.1,
    range: [45, 110], falloff: 0.6, headMult: 2.0, recoil: 4.5, moveMult: 1.0,
    zoom: 58, scope: false, tracer: '#ff9b5e',
  },
  smg: {
    id: 'smg', name: 'Pistolet-mitrailleur', type: 'SMG',
    damage: 13, pellets: 1, fireRate: 15, mode: 'auto',
    mag: 32, reload: 1.8, spread: 3.2, adsSpread: 1.6,
    range: [18, 50], falloff: 0.4, headMult: 1.5, recoil: 0.7, moveMult: 1.1,
    zoom: 64, scope: false, tracer: '#7fe3ff',
  },
  assault: {
    id: 'assault', name: "Fusil d'assaut", type: 'Fusil',
    damage: 22, pellets: 1, fireRate: 9.5, mode: 'auto',
    mag: 30, reload: 2.2, spread: 2.2, adsSpread: 0.7,
    range: [40, 95], falloff: 0.5, headMult: 1.7, recoil: 1.2, moveMult: 0.95,
    zoom: 60, scope: false, tracer: '#ffef7a',
  },
  bullpup: {
    id: 'bullpup', name: 'Bullpup (rafale)', type: 'Fusil',
    damage: 24, pellets: 1, fireRate: 14, mode: 'burst', burst: 3, burstDelay: 0.32,
    mag: 30, reload: 2.1, spread: 1.6, adsSpread: 0.45,
    range: [45, 105], falloff: 0.5, headMult: 1.7, recoil: 1.0, moveMult: 0.97,
    zoom: 58, scope: false, tracer: '#b6ff7a',
  },
  shotgun: {
    id: 'shotgun', name: 'Fusil à pompe', type: 'Fusil à pompe',
    damage: 11, pellets: 9, fireRate: 1.1, mode: 'semi',
    mag: 6, reload: 2.8, spread: 5.2, adsSpread: 3.6,
    range: [8, 26], falloff: 0.12, headMult: 1.4, recoil: 5.5, moveMult: 0.92,
    zoom: 66, scope: false, tracer: '#ffb27a',
  },
  sawedoff: {
    id: 'sawedoff', name: 'Double canon', type: 'Fusil à pompe',
    damage: 12, pellets: 12, fireRate: 2.2, mode: 'semi',
    mag: 2, reload: 2.3, spread: 7.0, adsSpread: 5.2,
    range: [5, 18], falloff: 0.08, headMult: 1.3, recoil: 6.5, moveMult: 1.0,
    zoom: 68, scope: false, tracer: '#ff8b5e',
  },
  dmr: {
    id: 'dmr', name: 'Fusil de précision', type: 'Tireur d’élite',
    damage: 46, pellets: 1, fireRate: 3.1, mode: 'semi',
    mag: 10, reload: 2.6, spread: 1.4, adsSpread: 0.1,
    range: [70, 160], falloff: 0.65, headMult: 2.0, recoil: 2.6, moveMult: 0.9,
    zoom: 40, scope: false, tracer: '#7ad0ff',
  },
  sniper: {
    id: 'sniper', name: 'Sniper', type: 'Tireur d’élite',
    damage: 95, pellets: 1, fireRate: 0.85, mode: 'semi',
    mag: 5, reload: 3.4, spread: 6.0, adsSpread: 0.03,
    range: [120, 260], falloff: 0.85, headMult: 2.0, recoil: 7.0, moveMult: 0.85,
    zoom: 18, scope: true, tracer: '#ff6b9a',
  },
};

export const DEFAULT_LOADOUT = ['pistol', 'smg', 'assault', 'shotgun'];

export const REGEN = {
  delayMs: 5000,       // sans tirer ni être touché pendant ce temps...
  ratePerSec: 12,      // ...on regagne ce nombre de PV par seconde
  tickMs: 500,
};

export const PLAYER_MAX_HP = 100;

// Points d'apparition : au milieu de rues du centre-ville (voir client/src/game/mapLayout.js,
// qui garde ces zones dégagées).
export const SPAWNS = [
  [-18, 0], [18, 0], [0, -18], [0, 18],
  [-54, 0], [54, 0], [0, -54], [0, 54],
  [-18, 36], [18, -36], [-54, -36], [54, 36],
  [-18, -72], [18, 72], [-72, 18], [72, -18],
].map(([x, z]) => ({ x, y: 1.7, z }));

export function pickSpawn(otherPositions = [], team = null) {
  // Choisit le point d'apparition le plus éloigné des autres joueurs vivants.
  // En mode équipes : l'équipe 0 apparaît à l'ouest de la carte, l'équipe 1 à l'est.
  let best = null;
  let bestScore = -1;
  const pool = team === null || team === undefined
    ? SPAWNS
    : SPAWNS.filter((s) => (team === 0 ? s.x < 0 || (s.x === 0 && s.z < 0) : s.x > 0 || (s.x === 0 && s.z > 0)));
  for (const s of pool) {
    let minD = Infinity;
    for (const o of otherPositions) {
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < minD) minD = d;
    }
    const score = otherPositions.length ? minD + Math.random() * 12 : Math.random();
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return { ...best };
}

export function isValidLoadout(ids) {
  return (
    Array.isArray(ids) &&
    ids.length >= 1 && ids.length <= 4 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => WEAPONS[id])
  );
}

// Dégâts pour un groupe de plombs touchant la même cible.
export function computeDamage(def, distance, pelletsHit, headHits) {
  const n = Math.max(1, Math.min(def.pellets, Math.floor(pelletsHit) || 1));
  const heads = Math.max(0, Math.min(n, Math.floor(headHits) || 0));
  const [near, far] = def.range;
  let mult = 1;
  if (distance > near) {
    const t = Math.min(1, (distance - near) / Math.max(1, far - near));
    mult = 1 - (1 - def.falloff) * t;
  }
  const body = (n - heads) * def.damage * mult;
  const head = heads * def.damage * def.headMult * mult;
  return Math.max(1, Math.round(body + head));
}
