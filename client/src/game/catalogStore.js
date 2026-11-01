import { api } from '../api.js';

// Catalogue (skins, traînées, raretés, événement en cours) — mis en cache côté client
let cache = null;
let pending = null;

export const FALLBACK_SKIN = {
  id: 'recrue', name: 'Recrue', rarity: 'common', price: 0,
  model: { kind: 'procedural', palette: {} },
};

export function loadCatalog(force = false) {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && pending) return pending;
  pending = api('/api/catalog').then((c) => { cache = c; pending = null; return c; })
    .catch((e) => { pending = null; throw e; });
  return pending;
}
export const getCatalogSync = () => cache;

export function skinById(id) {
  return (cache && cache.skins.find((s) => s.id === id)) || FALLBACK_SKIN;
}
export function tracerById(id) {
  return cache && cache.tracers.find((t) => t.id === id);
}
export function rarityInfo(r) {
  return (cache && cache.rarities[r]) || { label: r, color: '#9aa0a6' };
}
export const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
