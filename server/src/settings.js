import { jsonStore } from './store.js';

// Réglages globaux modifiables par l'administrateur
const store = jsonStore('settings.json', () => ({
  xpMult: 1,            // ex. 2 = week-end double XP
  coinMult: 1,
  shopDiscount: 0,      // pourcentage (0–90) appliqué à la boutique
  maxAccounts: 50,
  announcement: '',     // message affiché dans le menu
  season: { number: 1, name: 'Opération Rift', startedAt: Date.now() },
}));

export function getSettings() {
  const s = store.data;
  if (!s.season) s.season = { number: 1, name: 'Opération Rift', startedAt: Date.now() };
  return s;
}
export function updateSettings(patch) {
  const s = getSettings();
  if (patch.xpMult !== undefined) s.xpMult = clamp(Number(patch.xpMult), 0, 10);
  if (patch.coinMult !== undefined) s.coinMult = clamp(Number(patch.coinMult), 0, 10);
  if (patch.shopDiscount !== undefined) s.shopDiscount = clamp(Math.round(Number(patch.shopDiscount)), 0, 90);
  if (patch.maxAccounts !== undefined) s.maxAccounts = clamp(Math.round(Number(patch.maxAccounts)), 1, 500);
  if (patch.announcement !== undefined) s.announcement = String(patch.announcement).slice(0, 200);
  store.save();
  return s;
}
export function startNewSeason(name) {
  const s = getSettings();
  s.season = { number: s.season.number + 1, name: String(name || `Saison ${s.season.number + 1}`).slice(0, 40), startedAt: Date.now() };
  store.saveNow();
  return s.season;
}
function clamp(v, a, b) { return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a; }
