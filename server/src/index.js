import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

import { initAccounts, getSession, parseCookies } from './accounts.js';
import { setupGameServer } from './gameServer.js';
import { registerRoutes } from './routes.js';
import { loadPlayers, getPlayerCount, replaceAllPlayers } from './dataManager.js';
import { downloadFromCloud, startPeriodicCloudBackup } from './cloudBackup.js';
import { UPLOAD_DIR, ensureDirs } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const IS_PROD = process.env.NODE_ENV === 'production';
// En local on accepte n'importe quelle origine (localhost, ou l'IP de ton PC sur le Wi-Fi
// pour jouer avec des amis). En production, seule CLIENT_URL est autorisée.
const CORS_ORIGIN = IS_PROD ? CLIENT_URL : true;
const BACKUP_TOKEN = process.env.BACKUP_TOKEN || 'change_me_backup_token';

ensureDirs();
initAccounts();
loadPlayers();

const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, credentials: true },
});

// Les sockets n'acceptent que les utilisateurs connectés : l'identité vient du cookie de session,
// jamais d'un nom envoyé par le navigateur.
io.use((socket, next) => {
  const cookies = parseCookies(socket.request.headers.cookie || '');
  const session = getSession(cookies.session);
  if (!session) return next(new Error('unauthorized'));
  socket.data.user = session;
  next();
});

const game = setupGameServer(io);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// Skins importés par l'administrateur
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

function requireBackupToken(req, res, next) {
  const token = req.headers['x-backup-token'] || req.query.token;
  if (token !== BACKUP_TOKEN) return res.status(403).json({ error: 'Token invalide.' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', game: 'PIXELRIFT', time: new Date().toISOString() });
});

const DATA_FILE = path.join(__dirname, '..', 'data', 'players.json');

app.get('/api/backup/download', requireBackupToken, (_req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json({ players: {}, empty: true });
  try {
    const players = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    res.json({ players, count: Object.keys(players).length, time: Date.now() });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lecture backup: ' + e.message });
  }
});

app.post('/api/backup/upload', requireBackupToken, (req, res) => {
  const { players } = req.body || {};
  if (!players || typeof players !== 'object') return res.status(400).json({ error: 'Format invalide (players attendu).' });
  replaceAllPlayers(players);
  res.json({ ok: true, count: Object.keys(players).length });
});

registerRoutes(app, game);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// --- Init cloud backup ---
(async () => {
  if (getPlayerCount() === 0) {
    console.log('📦 Base locale vide, tentative de restauration depuis le cloud...');
    const cloudPlayers = await downloadFromCloud();
    if (cloudPlayers) replaceAllPlayers(cloudPlayers);
    else console.log('📦 Cloud vide aussi — démarrage à zéro');
  } else {
    console.log(`📦 Base locale chargée (${getPlayerCount()} joueurs)`);
  }
  startPeriodicCloudBackup();
})();

server.listen(PORT, () => {
  console.log(`🌌 PIXELRIFT API — listening on port ${PORT}`);
});
