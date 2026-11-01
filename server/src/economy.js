// ============================================================
// ÉCONOMIE — niveaux, récompenses de match, pass de combat, quêtes.
// Tout se règle ici. L'admin peut aussi appliquer des multiplicateurs (week-end double XP…)
// depuis le panneau d'administration (voir settings.js).
// ============================================================

export const CURRENCY = 'NovaCoins';
export const MAX_LEVEL = 100;

// XP nécessaire pour passer du niveau l au niveau l+1
export function xpForLevel(l) { return 600 + 120 * (l - 1); }

export function levelInfo(xp) {
  let level = 1;
  let rem = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && rem >= xpForLevel(level)) { rem -= xpForLevel(level); level++; }
  const need = level >= MAX_LEVEL ? 0 : xpForLevel(level);
  return { level, into: level >= MAX_LEVEL ? 0 : rem, need };
}

// Récompenses de match
export const REWARDS = {
  minPlayMs: 45000,       // en dessous, pas de récompense de participation
  participation: { coins: 25, xp: 100 },
  kill:          { coins: 12, xp: 40 },
  headshotBonus: { coins: 6,  xp: 15 },
  win:           { coins: 80, xp: 200 },
};

// Raretés (couleurs d'interface + prix conseillés)
export const RARITIES = {
  common:    { label: 'Commun',     color: '#9aa0a6', price: 400 },
  rare:      { label: 'Rare',       color: '#4aa3ff', price: 900 },
  epic:      { label: 'Épique',     color: '#b06cff', price: 1800 },
  legendary: { label: 'Légendaire', color: '#ffb020', price: 3500 },
};

// ---------- Pass de combat ----------
export const PASS = {
  tiers: 30,
  xpPerTier: 800,
  premiumPrice: 2000,
};

// Récompenses spéciales ; les autres paliers donnent des NovaCoins.
const FREE_SPECIAL = {
  5:  { type: 'tracer', id: 'pink_demon' },
  10: { type: 'skin',   id: 'recrue_desert' },
  15: { type: 'coins',  amount: 300 },
  20: { type: 'tracer', id: 'violet_void' },
  25: { type: 'coins',  amount: 400 },
  30: { type: 'coins',  amount: 600 },
};
const PREMIUM_SPECIAL = {
  1:  { type: 'coins',  amount: 300 },
  3:  { type: 'skin',   id: 'recrue_noir' },
  8:  { type: 'tracer', id: 'gold_legend' },
  10: { type: 'skin',   id: 'striker' },
  15: { type: 'skin',   id: 'recrue_polaire' },
  20: { type: 'tracer', id: 'rainbow' },
  24: { type: 'skin',   id: 'scan_homme' },
  30: { type: 'skin',   id: 'soldat' },
};

export function passTiers() {
  const out = [];
  for (let t = 1; t <= PASS.tiers; t++) {
    out.push({
      tier: t,
      xpRequired: t * PASS.xpPerTier,
      free: FREE_SPECIAL[t] || { type: 'coins', amount: 60 + 4 * t },
      premium: PREMIUM_SPECIAL[t] || { type: 'coins', amount: 100 + 6 * t },
    });
  }
  return out;
}

export function passTierFromXp(seasonXp) {
  return Math.min(PASS.tiers, Math.floor(seasonXp / PASS.xpPerTier));
}

// ---------- Quêtes ----------
export const DAILY_POOL = [
  { id: 'd_kills_5',     type: 'kills',     target: 5,  desc: 'Fais 5 éliminations',          reward: { coins: 60,  xp: 150 } },
  { id: 'd_kills_10',    type: 'kills',     target: 10, desc: 'Fais 10 éliminations',         reward: { coins: 100, xp: 250 } },
  { id: 'd_heads_3',     type: 'headshots', target: 3,  desc: 'Fais 3 tirs à la tête',        reward: { coins: 80,  xp: 200 } },
  { id: 'd_matches_2',   type: 'matches',   target: 2,  desc: 'Termine 2 matchs',             reward: { coins: 60,  xp: 150 } },
  { id: 'd_matches_3',   type: 'matches',   target: 3,  desc: 'Termine 3 matchs',             reward: { coins: 90,  xp: 220 } },
  { id: 'd_win_1',       type: 'wins',      target: 1,  desc: 'Gagne 1 match',                reward: { coins: 120, xp: 300 } },
  { id: 'd_rift_3',      type: 'riftUses',  target: 3,  desc: 'Utilise le Rift 3 fois',       reward: { coins: 50,  xp: 120 } },
];
export const WEEKLY_POOL = [
  { id: 'w_kills_40',    type: 'kills',     target: 40, desc: 'Fais 40 éliminations',         reward: { coins: 350, xp: 900 } },
  { id: 'w_wins_5',      type: 'wins',      target: 5,  desc: 'Gagne 5 matchs',               reward: { coins: 400, xp: 1000 } },
  { id: 'w_matches_12',  type: 'matches',   target: 12, desc: 'Termine 12 matchs',            reward: { coins: 300, xp: 800 } },
  { id: 'w_heads_15',    type: 'headshots', target: 15, desc: 'Fais 15 tirs à la tête',       reward: { coins: 300, xp: 800 } },
  { id: 'w_rift_25',     type: 'riftUses',  target: 25, desc: 'Utilise le Rift 25 fois',      reward: { coins: 200, xp: 600 } },
  { id: 'w_team_3',      type: 'teamWins',  target: 3,  desc: 'Gagne 3 matchs en équipe',     reward: { coins: 350, xp: 900 } },
];

export function dayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
// Clé de semaine : la date du lundi
export function weekKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

export function pickQuests(pool, n) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const types = new Set();
  const out = [];
  for (const q of shuffled) {                  // évite deux quêtes du même type
    if (types.has(q.type)) continue;
    types.add(q.type);
    out.push({ ...q, progress: 0, claimed: false });
    if (out.length >= n) break;
  }
  return out;
}

// Règles de pseudo
export const NAME_RULES = { min: 3, max: 16, regex: /^[A-Za-z0-9À-ÿ_\- ]+$/, cooldownMs: 60 * 60 * 1000 };
export const PASSWORD_MIN = 8;
