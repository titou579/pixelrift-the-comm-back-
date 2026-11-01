import crypto from 'crypto';
import { jsonStore } from './store.js';
import { PASSWORD_MIN } from './economy.js';
import { getSettings } from './settings.js';

// ============================================================
// COMPTES — mots de passe hachés (scrypt), sessions, rôles.
// Au premier lancement, les comptes sont créés depuis server/.env
// (ACCOUNT_*_PWD) ; ensuite tout se gère dans le jeu (changement de mot de passe,
// panneau administrateur). Les mots de passe du .env ne servent plus après.
// ============================================================
const DEV = process.env.NODE_ENV !== 'production';
const envPwd = (name) => process.env[name] || (DEV ? 'pixelrift' : undefined);

const SEED = [
  { username: 'titou',  role: 'admin',  pwd: () => envPwd('ACCOUNT_TITOU_PWD') },
  { username: 'thomas', role: 'player', pwd: () => envPwd('ACCOUNT_THOMAS_PWD') },
  { username: 'hugo',   role: 'player', pwd: () => envPwd('ACCOUNT_HUGO_PWD') },
  { username: 'lilou',  role: 'player', pwd: () => envPwd('ACCOUNT_LILOU_PWD') },
  { username: 'matteo', role: 'player', pwd: () => envPwd('ACCOUNT_MATTEO_PWD') },
];

const store = jsonStore('accounts.json', () => ({ accounts: {} }));
const sessionStore = jsonStore('sessions.json', () => ({ sessions: {} }));

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeRecord(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, role, salt, hash: hash(password, salt), createdAt: Date.now(), disabled: false };
}
function same(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function initAccounts() {
  let added = 0;
  for (const s of SEED) {
    const key = s.username.toLowerCase();
    if (store.data.accounts[key]) continue;
    const pwd = s.pwd();
    if (!pwd) continue;
    store.data.accounts[key] = makeRecord(s.username, pwd, s.role);
    added++;
  }
  if (added) {
    store.saveNow();
    console.log(`👤 ${added} compte(s) créé(s) depuis le .env`);
  }
  // Nettoie les sessions des comptes supprimés
  for (const [t, s] of Object.entries(sessionStore.data.sessions)) {
    if (!store.data.accounts[s.username.toLowerCase()]) delete sessionStore.data.sessions[t];
  }
}

export const getAccount = (username) => store.data.accounts[String(username || '').toLowerCase()] || null;

export function authenticate(username, password) {
  const acc = getAccount(username);
  if (!acc) return { error: 'Identifiants invalides.' };
  if (!same(hash(password, acc.salt), acc.hash)) return { error: 'Identifiants invalides.' };
  if (acc.disabled) return { error: 'Ce compte est suspendu.' };
  return { user: { username: acc.username, role: acc.role } };
}

export function listAccounts() {
  return Object.values(store.data.accounts).map((a) => ({
    username: a.username, role: a.role, disabled: !!a.disabled, createdAt: a.createdAt,
  }));
}

export function validateUsername(u) {
  return /^[a-z0-9_-]{3,20}$/.test(String(u || '').toLowerCase());
}

export function createAccount({ username, password, role = 'player' }) {
  username = String(username || '').trim();
  if (!validateUsername(username)) return { error: 'Identifiant : 3 à 20 caractères (lettres, chiffres, _ ou -).' };
  if (getAccount(username)) return { error: 'Cet identifiant existe déjà.' };
  if (String(password || '').length < PASSWORD_MIN) return { error: `Mot de passe : ${PASSWORD_MIN} caractères minimum.` };
  if (Object.keys(store.data.accounts).length >= getSettings().maxAccounts) return { error: 'Nombre maximum de comptes atteint.' };
  store.data.accounts[username.toLowerCase()] = makeRecord(username.toLowerCase(), password, role === 'admin' ? 'admin' : 'player');
  store.saveNow();
  return { ok: true };
}

export function changePassword(username, current, next) {
  const acc = getAccount(username);
  if (!acc || !same(hash(current, acc.salt), acc.hash)) return { error: 'Mot de passe actuel incorrect.' };
  if (String(next || '').length < PASSWORD_MIN) return { error: `Nouveau mot de passe : ${PASSWORD_MIN} caractères minimum.` };
  if (next === current) return { error: 'Le nouveau mot de passe doit être différent.' };
  return setPassword(username, next);
}

export function setPassword(username, next) {
  const acc = getAccount(username);
  if (!acc) return { error: 'Compte introuvable.' };
  if (String(next || '').length < PASSWORD_MIN) return { error: `Mot de passe : ${PASSWORD_MIN} caractères minimum.` };
  acc.salt = crypto.randomBytes(16).toString('hex');
  acc.hash = hash(next, acc.salt);
  store.saveNow();
  return { ok: true };
}

export function setRole(username, role) {
  const acc = getAccount(username);
  if (!acc) return { error: 'Compte introuvable.' };
  if (role !== 'admin' && role !== 'player') return { error: 'Rôle invalide.' };
  if (acc.role === 'admin' && role !== 'admin' && Object.values(store.data.accounts).filter((a) => a.role === 'admin' && !a.disabled).length <= 1) {
    return { error: 'Il doit rester au moins un administrateur.' };
  }
  acc.role = role;
  store.saveNow();
  return { ok: true };
}

export function setDisabled(username, disabled) {
  const acc = getAccount(username);
  if (!acc) return { error: 'Compte introuvable.' };
  if (disabled && acc.role === 'admin' && Object.values(store.data.accounts).filter((a) => a.role === 'admin' && !a.disabled).length <= 1) {
    return { error: 'Impossible de suspendre le dernier administrateur.' };
  }
  acc.disabled = !!disabled;
  store.saveNow();
  if (disabled) destroyUserSessions(username);
  return { ok: true };
}

export function deleteAccount(username) {
  const acc = getAccount(username);
  if (!acc) return { error: 'Compte introuvable.' };
  if (acc.role === 'admin' && Object.values(store.data.accounts).filter((a) => a.role === 'admin').length <= 1) {
    return { error: 'Impossible de supprimer le dernier administrateur.' };
  }
  delete store.data.accounts[username.toLowerCase()];
  store.saveNow();
  destroyUserSessions(username);
  return { ok: true };
}

// ---------- Sessions (conservées sur disque : un redémarrage ne déconnecte personne) ----------
export function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessionStore.data.sessions[token] = { username: user.username, loginAt: Date.now() };
  sessionStore.save();
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const s = sessionStore.data.sessions[token];
  if (!s) return null;
  const acc = getAccount(s.username);
  if (!acc || acc.disabled) return null;
  return { username: acc.username, role: acc.role, loginAt: s.loginAt };
}

export function destroySession(token) {
  if (token && sessionStore.data.sessions[token]) {
    delete sessionStore.data.sessions[token];
    sessionStore.save();
  }
}

export function destroyUserSessions(username, exceptToken = null) {
  for (const [t, s] of Object.entries(sessionStore.data.sessions)) {
    if (s.username.toLowerCase() === username.toLowerCase() && t !== exceptToken) delete sessionStore.data.sessions[t];
  }
  sessionStore.save();
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
