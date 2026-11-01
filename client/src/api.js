const API_URL = import.meta.env.VITE_API_URL || '';

export async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
const del = (path) => api(path, { method: 'DELETE' });

// ----- Session -----
export const login = (username, password) => post('/api/login', { username, password });
export const logout = () => post('/api/logout');
export const me = () => api('/api/me');

// ----- Profil, boutique, pass, quêtes -----
export const getProfile = () => api('/api/profile');
export const getLeaderboard = () => api('/api/leaderboard');
export const buyItem = (itemId) => post('/api/shop/buy', { itemId });
export const equipItem = (itemId) => post('/api/shop/equip', { itemId });
export const getPass = () => api('/api/pass');
export const claimPassTier = (tier, track) => post('/api/pass/claim', { tier, track });
export const buyPremiumPass = () => post('/api/pass/premium');
export const claimQuest = (scope, questId) => post('/api/quests/claim', { scope, questId });

// ----- Compte -----
export const changeDisplayName = (name) => post('/api/account/displayname', { name });
export const changePassword = (current, next) => post('/api/account/password', { current, next });

// ----- Administration -----
export const adminOverview = () => api('/api/admin/overview');
export const adminPlayers = () => api('/api/admin/players');
export const adminCreateAccount = (data) => post('/api/admin/accounts', data);
export const adminSetPassword = (u, password) => post(`/api/admin/accounts/${encodeURIComponent(u)}/password`, { password });
export const adminSetRole = (u, role) => post(`/api/admin/accounts/${encodeURIComponent(u)}/role`, { role });
export const adminDisable = (u, disabled) => post(`/api/admin/accounts/${encodeURIComponent(u)}/disable`, { disabled });
export const adminDeleteAccount = (u) => del(`/api/admin/accounts/${encodeURIComponent(u)}`);
export const adminGrant = (u, data) => post(`/api/admin/players/${encodeURIComponent(u)}/grant`, data);
export const adminRename = (u, name) => post(`/api/admin/players/${encodeURIComponent(u)}/rename`, { name });
export const adminResetStats = (u) => post(`/api/admin/players/${encodeURIComponent(u)}/reset-stats`);
export const adminKick = (u) => post(`/api/admin/players/${encodeURIComponent(u)}/kick`);
export const adminCatalog = () => api('/api/admin/catalog');
export const adminUpdateItem = (id, patch) => post(`/api/admin/catalog/${encodeURIComponent(id)}`, patch);
export const adminDeleteItem = (id) => del(`/api/admin/catalog/${encodeURIComponent(id)}`);
export const adminAddColorSkin = (data) => post('/api/admin/skins/color', data);
export const adminImportSkin = async (file, params) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}/api/admin/skins/import?${qs}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
};
export const adminSettings = () => api('/api/admin/settings');
export const adminSetSettings = (patch) => post('/api/admin/settings', patch);
export const adminNewSeason = (name) => post('/api/admin/season/new', { name });
export const adminAnnounce = (text) => post('/api/admin/announce', { text });
export const adminRooms = () => api('/api/admin/rooms');
export const adminCloseRoom = (code) => post(`/api/admin/rooms/${encodeURIComponent(code)}/close`);
export const adminLog = () => api('/api/admin/log');
