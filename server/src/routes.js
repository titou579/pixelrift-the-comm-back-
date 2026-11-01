import express from 'express';
import fs from 'fs';
import {
  authenticate, createSession, destroySession, destroyUserSessions, getSession, getAccount,
  changePassword, createAccount, setPassword, setRole, setDisabled, deleteAccount, listAccounts,
} from './accounts.js';
import {
  viewProfile, getOrCreateProfile, setDisplayName, buyItem, equipItem, claimQuest, passView, claimPassTier,
  buyPremiumPass, leaderboard, listProfiles, adminGrant, adminResetStats, adminSetDisplayName, deleteProfile,
  economyTotals, itemPrice, getProfile,
} from './dataManager.js';
import { allSkins, allTracers, updateItem, addSkin, deleteImportedSkin, getItem } from './catalog.js';
import { RARITIES, CURRENCY, PASS, REWARDS } from './economy.js';
import { getSettings, updateSettings, startNewSeason } from './settings.js';
import { jsonStore } from './store.js';
import { WEAPONS, DEFAULT_LOADOUT, REGEN, SPAWNS, PLAYER_MAX_HP } from './weapons.js';

const adminLog = jsonStore('adminlog.json', () => ({ entries: [] }));
function logAdmin(user, action, detail = '') {
  adminLog.data.entries.unshift({ t: Date.now(), by: user.username, action, detail: String(detail).slice(0, 200) });
  adminLog.data.entries.length = Math.min(adminLog.data.entries.length, 200);
  adminLog.save();
}

// Limite les essais de connexion (par IP + identifiant)
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 8;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

// Vue publique d'un objet de boutique (prix remisé inclus)
function shopView(item) {
  return { ...item, finalPrice: itemPrice(item) };
}

export function registerRoutes(app, game) {
  const requireAuth = (req, res, next) => {
    const session = getSession(req.cookies?.session);
    if (!session) return res.status(401).json({ error: 'Non connecté.' });
    req.user = session;
    next();
  };
  const requireAdmin = (req, res, next) => requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    next();
  });
  const fail = (res, r, code = 400) => res.status(code).json({ error: r.error });

  // ---------- Config de jeu (armes, spawns) ----------
  app.get('/api/game-config', (_req, res) => {
    res.json({ weapons: Object.values(WEAPONS), defaultLoadout: DEFAULT_LOADOUT, regen: REGEN, maxHp: PLAYER_MAX_HP, spawns: SPAWNS });
  });

  // ---------- Connexion ----------
  const userView = (u) => ({ username: u.username, role: u.role, displayName: getOrCreateProfile(u.username).displayName });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Requis.' });
    const key = `${req.ip}|${String(username).toLowerCase()}`;
    if (tooManyAttempts(key)) return res.status(429).json({ error: 'Trop d’essais. Réessaie dans quelques minutes.' });
    const r = authenticate(username, password);
    if (r.error) {
      attempts.get(key).push(Date.now());
      return res.status(401).json({ error: r.error });
    }
    attempts.delete(key);
    res.cookie('session', createSession(r.user), cookieOptions());
    res.json({ user: userView(r.user) });
  });

  app.get('/api/me', (req, res) => {
    const s = getSession(req.cookies?.session);
    if (!s) return res.status(401).json({ error: 'Non connecté.' });
    res.json({ user: userView(s) });
  });

  app.post('/api/logout', (req, res) => {
    destroySession(req.cookies?.session);
    res.clearCookie('session');
    res.json({ ok: true });
  });

  // ---------- Catalogue, profil, classement ----------
  app.get('/api/catalog', requireAuth, (_req, res) => {
    const s = getSettings();
    res.json({
      skins: allSkins().map(shopView),          // tous : un skin désactivé reste visible chez ceux qui l'ont équipé
      tracers: allTracers().map(shopView),
      rarities: RARITIES, currency: CURRENCY,
      event: { xpMult: s.xpMult, coinMult: s.coinMult, shopDiscount: s.shopDiscount, announcement: s.announcement },
      season: s.season, rewards: REWARDS,
    });
  });

  app.get('/api/profile', requireAuth, (req, res) => res.json({ profile: viewProfile(req.user.username) }));
  app.get('/api/leaderboard', requireAuth, (_req, res) => res.json({ list: leaderboard() }));

  // ---------- Compte : pseudo, mot de passe ----------
  app.post('/api/account/displayname', requireAuth, (req, res) => {
    const r = setDisplayName(req.user.username, req.body?.name);
    if (r.error) return fail(res, r);
    game.refreshLogin(req.user.username);
    res.json({ profile: viewProfile(req.user.username) });
  });

  app.post('/api/account/password', requireAuth, (req, res) => {
    const key = `pw|${req.user.username}`;
    if (tooManyAttempts(key)) return res.status(429).json({ error: 'Trop d’essais. Réessaie plus tard.' });
    const r = changePassword(req.user.username, req.body?.current, req.body?.next);
    if (r.error) { attempts.get(key).push(Date.now()); return fail(res, r); }
    destroyUserSessions(req.user.username, req.cookies?.session); // déconnecte les autres appareils
    res.json({ ok: true });
  });

  // ---------- Boutique ----------
  app.post('/api/shop/buy', requireAuth, (req, res) => {
    const r = buyItem(req.user.username, req.body?.itemId);
    if (r.error) return fail(res, r);
    res.json({ profile: r.profile });
  });
  app.post('/api/shop/equip', requireAuth, (req, res) => {
    const r = equipItem(req.user.username, req.body?.itemId);
    if (r.error) return fail(res, r);
    game.refreshLogin(req.user.username);
    res.json({ profile: r.profile });
  });

  // ---------- Pass de combat & quêtes ----------
  app.get('/api/pass', requireAuth, (req, res) => res.json(passView(req.user.username)));
  app.post('/api/pass/claim', requireAuth, (req, res) => {
    const r = claimPassTier(req.user.username, Number(req.body?.tier), req.body?.track);
    if (r.error) return fail(res, r);
    res.json({ gained: r.gained, profile: r.profile, pass: passView(req.user.username) });
  });
  app.post('/api/pass/premium', requireAuth, (req, res) => {
    const r = buyPremiumPass(req.user.username);
    if (r.error) return fail(res, r);
    res.json({ profile: r.profile, pass: passView(req.user.username) });
  });
  app.post('/api/quests/claim', requireAuth, (req, res) => {
    const r = claimQuest(req.user.username, req.body?.scope, req.body?.questId);
    if (r.error) return fail(res, r);
    res.json({ coins: r.coins, xp: r.xp, profile: r.profile });
  });

  // ============================================================
  // ADMINISTRATION
  // ============================================================
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const rooms = game.getRoomsSnapshot();
    res.json({
      economy: economyTotals(), accounts: listAccounts().length, settings: getSettings(),
      onlinePlayers: rooms.reduce((a, r) => a + r.players.length, 0), rooms: rooms.length, pass: PASS,
    });
  });

  app.get('/api/admin/players', requireAdmin, (_req, res) => {
    const known = new Map(listProfiles().map((p) => [p.username.toLowerCase(), p]));
    const list = listAccounts().map((a) => {
      const p = known.get(a.username.toLowerCase());
      return { ...(p || { username: a.username, displayName: a.username, level: 1, xp: 0, coins: 300, kills: 0, deaths: 0, wins: 0, matches: 0, skin: 'recrue', premium: false, owned: 2, lastSeen: 0 }),
        role: a.role, disabled: a.disabled, online: game.isOnline(a.username) };
    });
    res.json({ players: list });
  });

  app.post('/api/admin/accounts', requireAdmin, (req, res) => {
    const r = createAccount(req.body || {});
    if (r.error) return fail(res, r);
    getOrCreateProfile(String(req.body.username).trim().toLowerCase());
    logAdmin(req.user, 'Compte créé', req.body.username);
    res.json({ ok: true });
  });
  app.post('/api/admin/accounts/:u/password', requireAdmin, (req, res) => {
    const r = setPassword(req.params.u, req.body?.password);
    if (r.error) return fail(res, r);
    destroyUserSessions(req.params.u);
    logAdmin(req.user, 'Mot de passe réinitialisé', req.params.u);
    res.json({ ok: true });
  });
  app.post('/api/admin/accounts/:u/role', requireAdmin, (req, res) => {
    const r = setRole(req.params.u, req.body?.role);
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Rôle modifié', `${req.params.u} → ${req.body.role}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/accounts/:u/disable', requireAdmin, (req, res) => {
    if (req.params.u.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Tu ne peux pas suspendre ton propre compte.' });
    const r = setDisabled(req.params.u, !!req.body?.disabled);
    if (r.error) return fail(res, r);
    if (req.body?.disabled) game.kickLogin(req.params.u.toLowerCase());
    logAdmin(req.user, req.body?.disabled ? 'Compte suspendu' : 'Compte réactivé', req.params.u);
    res.json({ ok: true });
  });
  app.delete('/api/admin/accounts/:u', requireAdmin, (req, res) => {
    if (req.params.u.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte.' });
    const r = deleteAccount(req.params.u);
    if (r.error) return fail(res, r);
    game.kickLogin(req.params.u.toLowerCase());
    deleteProfile(req.params.u.toLowerCase());
    logAdmin(req.user, 'Compte supprimé', req.params.u);
    res.json({ ok: true });
  });

  app.post('/api/admin/players/:u/grant', requireAdmin, (req, res) => {
    const login = req.params.u.toLowerCase();
    if (!getAccount(login)) return res.status(404).json({ error: 'Compte introuvable.' });
    getOrCreateProfile(login);
    const { coins, xp, itemId, revoke } = req.body || {};
    const r = adminGrant(login, { coins: coins === '' || coins == null ? undefined : Number(coins), xp: xp === '' || xp == null ? undefined : Number(xp), itemId, revoke });
    if (r.error) return fail(res, r);
    game.refreshLogin(login);
    logAdmin(req.user, revoke ? 'Objet retiré' : 'Don', `${login} : ${[coins && `${coins} pièces`, xp && `${xp} XP`, itemId].filter(Boolean).join(', ')}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/players/:u/rename', requireAdmin, (req, res) => {
    const login = req.params.u.toLowerCase();
    if (!getProfile(login)) return res.status(404).json({ error: 'Joueur introuvable.' });
    const r = adminSetDisplayName(login, req.body?.name);
    if (r.error) return fail(res, r);
    game.refreshLogin(login);
    logAdmin(req.user, 'Pseudo modifié', `${login} → ${r.displayName}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/players/:u/reset-stats', requireAdmin, (req, res) => {
    const r = adminResetStats(req.params.u.toLowerCase());
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Stats réinitialisées', req.params.u);
    res.json({ ok: true });
  });
  app.post('/api/admin/players/:u/kick', requireAdmin, (req, res) => {
    const n = game.kickLogin(req.params.u.toLowerCase());
    logAdmin(req.user, 'Joueur expulsé', req.params.u);
    res.json({ ok: true, kicked: n });
  });

  // --- Boutique : prix, raretés, activation, import ---
  app.get('/api/admin/catalog', requireAdmin, (_req, res) => {
    res.json({ items: [...allSkins(), ...allTracers()], rarities: RARITIES });
  });
  app.post('/api/admin/catalog/:id', requireAdmin, (req, res) => {
    const r = updateItem(req.params.id, req.body || {});
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Objet modifié', req.params.id);
    res.json(r);
  });
  app.delete('/api/admin/catalog/:id', requireAdmin, (req, res) => {
    const r = deleteImportedSkin(req.params.id);
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Skin supprimé', req.params.id);
    res.json(r);
  });
  app.post('/api/admin/skins/color', requireAdmin, (req, res) => {
    const r = addSkin({ ...(req.body || {}), glbBuffer: null });
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Skin créé (couleurs)', r.item.name);
    res.json(r);
  });
  // Import d'un .glb : corps binaire brut (pas de dépendance supplémentaire)
  app.post('/api/admin/skins/import', requireAdmin, express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    const q = req.query;
    const r = addSkin({
      name: q.name, desc: q.desc, rarity: q.rarity, price: q.price, minLevel: q.minLevel,
      glbBuffer: buf, fit: { height: q.height, yaw: q.yaw, auto: q.auto !== '0' },
      credit: { title: q.creditTitle, author: q.creditAuthor, license: q.creditLicense, url: q.creditUrl },
    });
    if (r.error) return fail(res, r);
    logAdmin(req.user, 'Skin importé', `${r.item.name} (${(buf.length / 1e6).toFixed(1)} Mo)`);
    res.json(r);
  });

  // --- Économie, saison, annonces ---
  app.get('/api/admin/settings', requireAdmin, (_req, res) => res.json({ settings: getSettings(), economy: economyTotals() }));
  app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const s = updateSettings(req.body || {});
    logAdmin(req.user, 'Réglages modifiés', JSON.stringify(req.body).slice(0, 150));
    if (req.body?.announcement) game.announce(s.announcement);
    res.json({ settings: s });
  });
  app.post('/api/admin/season/new', requireAdmin, (req, res) => {
    const season = startNewSeason(req.body?.name);
    logAdmin(req.user, 'Nouvelle saison', `${season.number} — ${season.name}`);
    res.json({ season });
  });
  app.post('/api/admin/announce', requireAdmin, (req, res) => {
    const text = String(req.body?.text || '').slice(0, 200);
    if (!text) return res.status(400).json({ error: 'Message vide.' });
    game.announce(text);
    logAdmin(req.user, 'Annonce', text);
    res.json({ ok: true });
  });

  // --- Salons en direct, journal ---
  app.get('/api/admin/rooms', requireAdmin, (_req, res) => res.json({ rooms: game.getRoomsSnapshot() }));
  app.post('/api/admin/rooms/:code/close', requireAdmin, (req, res) => {
    const ok = game.closeRoom(req.params.code.toUpperCase());
    logAdmin(req.user, 'Salon fermé', req.params.code);
    res.json({ ok });
  });
  app.get('/api/admin/log', requireAdmin, (_req, res) => res.json({ entries: adminLog.data.entries }));

  void fs; void getItem;
}
