import { api } from '../api.js';

// Config de jeu envoyée par le serveur (armes, régénération, points d'apparition)
let cache = null;
export async function getGameConfig() {
  if (!cache) cache = await api('/api/game-config');
  return cache;
}

const KEY = 'pixelrift.loadout';

export function isValidLoadout(ids, config) {
  return (
    Array.isArray(ids) &&
    ids.length === 4 &&
    new Set(ids).size === 4 &&
    ids.every((id) => config.weapons.some((w) => w.id === id))
  );
}

export function getLoadout(config) {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY));
    if (isValidLoadout(ids, config)) return ids;
  } catch { /* ignore */ }
  return config.defaultLoadout;
}

export function saveLoadout(ids) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

// Statistiques affichées dans l'écran Arsenal (valeurs entre 0 et 1)
export function weaponStats(w) {
  const perShot = w.damage * w.pellets;
  const rate = w.mode === 'burst'
    ? w.burst / (w.burst / w.fireRate + w.burstDelay)
    : w.fireRate;
  const dps = perShot * rate;
  return {
    perShot,
    dps,
    bars: [
      { label: 'Dégâts / tir', value: Math.min(1, perShot / 150) },
      { label: 'Cadence (DPS)', value: Math.min(1, dps / 320) },
      { label: 'Portée', value: Math.min(1, w.range[1] / 260) },
      { label: 'Précision', value: Math.max(0.05, 1 - w.spread / 8) },
      { label: 'Mobilité', value: Math.max(0.05, Math.min(1, (w.moveMult - 0.8) / 0.3)) },
    ],
  };
}

export const MODE_LABEL = { auto: 'Automatique', semi: 'Semi-auto', burst: 'Rafale' };
