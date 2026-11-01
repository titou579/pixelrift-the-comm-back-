import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scheduleCloudUpload } from './cloudBackup.js';
import {
  levelInfo, REWARDS, PASS, passTiers, passTierFromXp, DAILY_POOL, WEEKLY_POOL,
  dayKey, weekKey, pickQuests, NAME_RULES,
} from './economy.js';
import { getSettings } from './settings.js';
import { getItem, getSkin, getTracer, allSkins } from './catalog.js';
import { getAccount } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

let players = {};
let saveTimeout = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPlayers() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      players = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`📂 ${Object.keys(players).length} profil(s) chargé(s)`);
    }
  } catch (e) {
    console.error('❌ Erreur chargement players.json :', e.message);
    players = {};
  }
  for (const k of Object.keys(players)) players[k] = normalizeProfile(players[k], k);
}

export function savePlayers() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      ensureDataDir();
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(players, null, 2));
      fs.renameSync(tmp, DATA_FILE);
      scheduleCloudUpload();
    } catch (e) {
      console.error('❌ Erreur sauvegarde :', e.message);
    }
  }, 500);
}

export function getPlayerCount() { return Object.keys(players).length; }
export function replaceAllPlayers(newPlayers) {
  players = newPlayers || {};
  for (const k of Object.keys(players)) players[k] = normalizeProfile(players[k], k);
  savePlayers();
}

// ============================================================
// PROFILS
// ============================================================
function defaultStats() {
  return { totalKills: 0, totalDeaths: 0, totalWins: 0, totalMatches: 0, totalRiftUses: 0, totalHeadshots: 0, teamWins: 0, bestKillsMatch: 0 };
}

// Migration : accepte les anciens profils (skins de couleur, pass à 5 paliers…)
function normalizeProfile(p, login) {
  p = p || {};
  const out = {
    username: login,
    displayName: p.displayName || login,
    xp: p.xp || 0,
    coins: p.coins ?? 300,
    ownedSkins: Array.isArray(p.ownedSkins) && p.ownedSkins.length ? [...new Set(['recrue', ...p.ownedSkins])] : ['recrue'],
    equippedSkin: 'recrue',
    ownedTracers: [],
    equippedTracer: 'default',
    loadout: Array.isArray(p.loadout) ? p.loadout : null,
    stats: { ...defaultStats(), ...(p.stats || {}) },
    quests: p.quests && p.quests.daily && p.quests.weekly ? p.quests : { daily: { key: '', list: [] }, weekly: { key: '', list: [] } },
    battlePass: p.battlePass && p.battlePass.claimedFree
      ? p.battlePass
      : { season: getSettings().season.number, seasonXp: 0, premium: false, claimedFree: [], claimedPremium: [] },
    lastNameChange: p.lastNameChange || 0,
    createdAt: p.createdAt || Date.now(),
    lastSeen: p.lastSeen || Date.now(),
  };
  // anciens « skins » de couleur → traînées
  const legacy = Array.isArray(p.ownedItems) ? p.ownedItems : [];
  const tracers = Array.isArray(p.ownedTracers) ? p.ownedTracers : legacy;
  out.ownedTracers = [...new Set(['default', ...tracers])];
  const eqTracer = p.equippedTracer || (typeof p.equippedSkin === 'string' && !p.equippedSkin.startsWith('recrue') ? p.equippedSkin : 'default');
  out.equippedTracer = out.ownedTracers.includes(eqTracer) ? eqTracer : 'default';
  const eqSkin = p.equippedSkin && out.ownedSkins.includes(p.equippedSkin) ? p.equippedSkin : 'recrue';
  out.equippedSkin = eqSkin;
  return out;
}

function refreshPeriodic(p) {
  const dk = dayKey(), wk = weekKey();
  if (p.quests.daily.key !== dk) p.quests.daily = { key: dk, list: pickQuests(DAILY_POOL, 3) };
  if (p.quests.weekly.key !== wk) p.quests.weekly = { key: wk, list: pickQuests(WEEKLY_POOL, 3) };
  const season = getSettings().season.number;
  if (p.battlePass.season !== season) {
    p.battlePass = { season, seasonXp: 0, premium: false, claimedFree: [], claimedPremium: [] };
  }
}

export function getOrCreateProfile(login) {
  if (!players[login]) {
    players[login] = normalizeProfile({}, login);
    savePlayers();
  }
  const p = players[login];
  refreshPeriodic(p);
  p.lastSeen = Date.now();
  return p;
}
export const getProfile = (login) => players[login] || null;

// Profil enrichi pour le client (niveau, progression, tier du pass…)
export function viewProfile(login) {
  const p = getOrCreateProfile(login);
  const acc = getAccount(login);
  const lv = levelInfo(p.xp);
  const tier = passTierFromXp(p.battlePass.seasonXp);
  return {
    ...p,
    role: acc?.role || 'player',
    level: lv.level, levelXp: lv.into, levelNeed: lv.need,
    passTier: tier,
    passIntoTier: p.battlePass.seasonXp - tier * PASS.xpPerTier,
  };
}

export function getDisplayName(login) {
  return players[login]?.displayName || login;
}

// ---------- Pseudo ----------
export function isNameTaken(name, exceptLogin) {
  const n = name.trim().toLowerCase();
  return Object.values(players).some((p) => p.username !== exceptLogin && p.displayName.toLowerCase() === n)
    || (getAccount(n) && getAccount(n).username.toLowerCase() !== String(exceptLogin).toLowerCase());
}

export function setDisplayName(login, rawName, { ignoreCooldown = false } = {}) {
  const p = getOrCreateProfile(login);
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (name.length < NAME_RULES.min || name.length > NAME_RULES.max) return { error: `Pseudo : ${NAME_RULES.min} à ${NAME_RULES.max} caractères.` };
  if (!NAME_RULES.regex.test(name)) return { error: 'Pseudo : lettres, chiffres, espaces, _ et - uniquement.' };
  if (name.toLowerCase() === p.displayName.toLowerCase() && name === p.displayName) return { error: 'C’est déjà ton pseudo.' };
  if (isNameTaken(name, login)) return { error: 'Ce pseudo est déjà pris.' };
  const wait = p.lastNameChange + NAME_RULES.cooldownMs - Date.now();
  if (!ignoreCooldown && wait > 0) return { error: `Tu pourras changer de pseudo dans ${Math.ceil(wait / 60000)} min.` };
  p.displayName = name;
  p.lastNameChange = Date.now();
  savePlayers();
  return { ok: true, displayName: name };
}

// ---------- Récompenses génériques ----------
function giveReward(p, r) {
  if (r.type === 'coins') { p.coins += r.amount; return { type: 'coins', amount: r.amount }; }
  const item = getItem(r.id);
  if (!item) return { type: 'coins', amount: 0 };
  const list = r.type === 'skin' ? p.ownedSkins : p.ownedTracers;
  if (list.includes(r.id)) {                       // déjà possédé → remboursement partiel
    const refund = Math.max(50, Math.round((item.price || 0) * 0.25));
    p.coins += refund;
    return { type: 'coins', amount: refund, duplicate: item.name };
  }
  list.push(r.id);
  return { type: r.type, id: r.id, name: item.name };
}

export function addXp(p, amount) {
  p.xp += amount;
  p.battlePass.seasonXp += amount;
}

// ---------- Quêtes ----------
function progressQuests(p, type, amount = 1) {
  for (const scope of ['daily', 'weekly']) {
    for (const q of p.quests[scope].list) {
      if (q.type === type && !q.claimed) q.progress = Math.min(q.target, q.progress + amount);
    }
  }
}

export function registerRiftUse(login) {
  const p = getOrCreateProfile(login);
  p.stats.totalRiftUses += 1;
  progressQuests(p, 'riftUses', 1);
  savePlayers();
}

export function claimQuest(login, scope, questId) {
  const p = getOrCreateProfile(login);
  const q = p.quests[scope]?.list.find((x) => x.id === questId);
  if (!q) return { error: 'Quête introuvable.' };
  if (q.claimed) return { error: 'Déjà récupérée.' };
  if (q.progress < q.target) return { error: 'Quête non terminée.' };
  const s = getSettings();
  const coins = Math.round(q.reward.coins * s.coinMult), xp = Math.round(q.reward.xp * s.xpMult);
  q.claimed = true;
  p.coins += coins;
  addXp(p, xp);
  savePlayers();
  return { ok: true, coins, xp, profile: viewProfile(login) };
}

// ---------- Boutique ----------
export function itemPrice(item) {
  const d = getSettings().shopDiscount || 0;
  return Math.round((item.price || 0) * (100 - d) / 100);
}

export function buyItem(login, itemId) {
  const p = getOrCreateProfile(login);
  const item = getItem(itemId);
  if (!item || !item.enabled) return { error: 'Objet introuvable.' };
  if (item.passOnly) return { error: 'Cet objet est une récompense du pass de combat.' };
  const list = item.type === 'skin' ? p.ownedSkins : p.ownedTracers;
  if (list.includes(itemId)) return { error: 'Tu possèdes déjà cet objet.' };
  const lv = levelInfo(p.xp).level;
  if (lv < (item.minLevel || 1)) return { error: `Niveau ${item.minLevel} requis.` };
  const price = itemPrice(item);
  if (p.coins < price) return { error: 'Pas assez de NovaCoins.' };
  p.coins -= price;
  list.push(itemId);
  savePlayers();
  return { ok: true, profile: viewProfile(login) };
}

export function equipItem(login, itemId) {
  const p = getOrCreateProfile(login);
  const item = getItem(itemId);
  if (!item) return { error: 'Objet introuvable.' };
  if (item.type === 'skin') {
    if (!p.ownedSkins.includes(itemId)) return { error: 'Tu ne possèdes pas ce skin.' };
    p.equippedSkin = itemId;
  } else {
    if (!p.ownedTracers.includes(itemId)) return { error: 'Tu ne possèdes pas cette traînée.' };
    p.equippedTracer = itemId;
  }
  savePlayers();
  return { ok: true, profile: viewProfile(login) };
}

export function setLoadout(login, ids) {
  const p = getOrCreateProfile(login);
  p.loadout = ids;
  savePlayers();
}

// ---------- Pass de combat ----------
export function passView(login) {
  const p = getOrCreateProfile(login);
  const s = getSettings();
  return {
    season: s.season,
    tiers: passTiers().map((t) => ({
      ...t,
      freeItem: t.free.id ? getItem(t.free.id) : null,
      premiumItem: t.premium.id ? getItem(t.premium.id) : null,
    })),
    xpPerTier: PASS.xpPerTier,
    premiumPrice: PASS.premiumPrice,
    seasonXp: p.battlePass.seasonXp,
    tier: passTierFromXp(p.battlePass.seasonXp),
    premium: p.battlePass.premium,
    claimedFree: p.battlePass.claimedFree,
    claimedPremium: p.battlePass.claimedPremium,
  };
}

export function claimPassTier(login, tier, track) {
  const p = getOrCreateProfile(login);
  const t = passTiers().find((x) => x.tier === tier);
  if (!t) return { error: 'Palier introuvable.' };
  if (passTierFromXp(p.battlePass.seasonXp) < tier) return { error: 'Palier non débloqué.' };
  const claimed = track === 'premium' ? p.battlePass.claimedPremium : p.battlePass.claimedFree;
  if (track === 'premium' && !p.battlePass.premium) return { error: 'Pass Premium requis.' };
  if (track !== 'premium' && track !== 'free') return { error: 'Piste invalide.' };
  if (claimed.includes(tier)) return { error: 'Déjà récupéré.' };
  const gained = giveReward(p, track === 'premium' ? t.premium : t.free);
  claimed.push(tier);
  savePlayers();
  return { ok: true, gained, profile: viewProfile(login) };
}

export function buyPremiumPass(login) {
  const p = getOrCreateProfile(login);
  if (p.battlePass.premium) return { error: 'Tu as déjà le Pass Premium.' };
  if (p.coins < PASS.premiumPrice) return { error: 'Pas assez de NovaCoins.' };
  p.coins -= PASS.premiumPrice;
  p.battlePass.premium = true;
  savePlayers();
  return { ok: true, profile: viewProfile(login) };
}

// ---------- Fin de match ----------
export function applyMatchRewards(login, { kills = 0, deaths = 0, headshots = 0, isWinner = false, teamMode = false, playedMs = 0 }) {
  const p = getOrCreateProfile(login);
  const s = getSettings();
  const before = levelInfo(p.xp).level;
  const tierBefore = passTierFromXp(p.battlePass.seasonXp);
  const lines = [];
  const add = (label, coins, xp) => { if (coins || xp) lines.push({ label, coins, xp }); };

  if (playedMs >= REWARDS.minPlayMs) add('Participation', REWARDS.participation.coins, REWARDS.participation.xp);
  add(`Éliminations × ${kills}`, kills * REWARDS.kill.coins, kills * REWARDS.kill.xp);
  add(`Tirs à la tête × ${headshots}`, headshots * REWARDS.headshotBonus.coins, headshots * REWARDS.headshotBonus.xp);
  if (isWinner) add(teamMode ? 'Victoire d’équipe' : 'Victoire', REWARDS.win.coins, REWARDS.win.xp);

  const rawCoins = lines.reduce((a, l) => a + l.coins, 0);
  const rawXp = lines.reduce((a, l) => a + l.xp, 0);
  const coinGain = Math.round(rawCoins * s.coinMult);
  const xpGain = Math.round(rawXp * s.xpMult);
  if (s.coinMult !== 1 || s.xpMult !== 1) {
    lines.push({ label: `Bonus événement (×${s.xpMult} XP · ×${s.coinMult} pièces)`, coins: coinGain - rawCoins, xp: xpGain - rawXp });
  }

  p.coins += coinGain;
  addXp(p, xpGain);
  const st = p.stats;
  st.totalKills += kills; st.totalDeaths += deaths; st.totalHeadshots += headshots;
  st.totalMatches += 1;
  if (isWinner) { st.totalWins += 1; if (teamMode) st.teamWins += 1; }
  st.bestKillsMatch = Math.max(st.bestKillsMatch, kills);
  progressQuests(p, 'kills', kills);
  progressQuests(p, 'headshots', headshots);
  progressQuests(p, 'matches', 1);
  if (isWinner) { progressQuests(p, 'wins', 1); if (teamMode) progressQuests(p, 'teamWins', 1); }
  savePlayers();

  const after = levelInfo(p.xp).level;
  return {
    xpGain, coinGain, lines,
    levelBefore: before, levelAfter: after,
    tierBefore, tierAfter: passTierFromXp(p.battlePass.seasonXp),
    profile: viewProfile(login),
  };
}

// ---------- Classement ----------
export function leaderboard() {
  return Object.values(players)
    .map((p) => ({ name: p.displayName, level: levelInfo(p.xp).level, kills: p.stats.totalKills, wins: p.stats.totalWins, skin: p.equippedSkin }))
    .sort((a, b) => b.wins - a.wins || b.kills - a.kills || b.level - a.level)
    .slice(0, 10);
}

// ============================================================
// ADMIN
// ============================================================
export function listProfiles() {
  return Object.values(players).map((p) => {
    const acc = getAccount(p.username);
    return {
      username: p.username, displayName: p.displayName, role: acc?.role || 'player', disabled: !!acc?.disabled,
      level: levelInfo(p.xp).level, xp: p.xp, coins: p.coins, kills: p.stats.totalKills, deaths: p.stats.totalDeaths,
      wins: p.stats.totalWins, matches: p.stats.totalMatches, skin: p.equippedSkin, premium: p.battlePass.premium,
      lastSeen: p.lastSeen, owned: p.ownedSkins.length + p.ownedTracers.length,
    };
  });
}

export function adminGrant(login, { coins, xp, itemId, revoke }) {
  const p = getProfile(login);
  if (!p) return { error: 'Joueur introuvable.' };
  if (Number.isFinite(coins)) p.coins = Math.max(0, p.coins + Math.round(coins));
  if (Number.isFinite(xp)) { p.xp = Math.max(0, p.xp + Math.round(xp)); p.battlePass.seasonXp = Math.max(0, p.battlePass.seasonXp + Math.round(xp)); }
  if (itemId) {
    const item = getItem(itemId);
    if (!item) return { error: 'Objet introuvable.' };
    const list = item.type === 'skin' ? p.ownedSkins : p.ownedTracers;
    if (revoke) {
      if (itemId === 'recrue' || itemId === 'default') return { error: 'Objet de base : impossible à retirer.' };
      const i = list.indexOf(itemId);
      if (i >= 0) list.splice(i, 1);
      if (p.equippedSkin === itemId) p.equippedSkin = 'recrue';
      if (p.equippedTracer === itemId) p.equippedTracer = 'default';
    } else if (!list.includes(itemId)) list.push(itemId);
  }
  savePlayers();
  return { ok: true };
}

export function adminResetStats(login) {
  const p = getProfile(login);
  if (!p) return { error: 'Joueur introuvable.' };
  p.stats = defaultStats();
  savePlayers();
  return { ok: true };
}

export function adminSetDisplayName(login, name) {
  return setDisplayName(login, name, { ignoreCooldown: true });
}

export function deleteProfile(login) {
  delete players[login];
  savePlayers();
}

export function economyTotals() {
  const list = Object.values(players);
  return {
    players: list.length,
    coinsInCirculation: list.reduce((a, p) => a + p.coins, 0),
    totalKills: list.reduce((a, p) => a + p.stats.totalKills, 0),
    totalMatches: list.reduce((a, p) => a + p.stats.totalMatches, 0),
    premiumCount: list.filter((p) => p.battlePass.premium).length,
  };
}

export { getSkin, getTracer, allSkins };
