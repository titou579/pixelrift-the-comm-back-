import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GIST_ID = process.env.GITHUB_GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DATA_FILE = path.join(__dirname, '..', 'data', 'players.json');
const FILENAME_IN_GIST = 'players.json';

let uploadTimeout = null;
let lastUpload = 0;
const MIN_UPLOAD_INTERVAL = 60 * 1000;

export function isCloudBackupEnabled() {
  return !!(GIST_ID && GITHUB_TOKEN);
}

export async function downloadFromCloud() {
  if (!isCloudBackupEnabled()) {
    console.log('☁️  Cloud backup désactivé (GITHUB_TOKEN ou GITHUB_GIST_ID manquant)');
    return null;
  }
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'pixelrift-backup',
      },
    });
    if (!res.ok) {
      console.error(`❌ Cloud download HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const content = data.files?.[FILENAME_IN_GIST]?.content;
    if (!content) {
      console.log('☁️  Gist vide');
      return null;
    }
    const players = JSON.parse(content);
    const count = Object.keys(players).length;
    if (count === 0) {
      console.log('☁️  Aucun joueur dans le cloud');
      return null;
    }
    console.log(`☁️  ${count} joueur(s) récupéré(s) du cloud`);
    return players;
  } catch (e) {
    console.error('❌ Cloud download erreur:', e.message);
    return null;
  }
}

export function scheduleCloudUpload() {
  if (!isCloudBackupEnabled()) return;
  if (uploadTimeout) clearTimeout(uploadTimeout);
  uploadTimeout = setTimeout(uploadToCloud, 30000);
}

async function uploadToCloud() {
  if (!isCloudBackupEnabled()) return;
  if (!fs.existsSync(DATA_FILE)) return;

  const now = Date.now();
  if (now - lastUpload < MIN_UPLOAD_INTERVAL) {
    scheduleCloudUpload();
    return;
  }

  try {
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const count = Object.keys(JSON.parse(content)).length;

    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'pixelrift-backup',
      },
      body: JSON.stringify({
        files: {
          [FILENAME_IN_GIST]: { content },
        },
      }),
    });

    if (!res.ok) {
      console.error(`❌ Cloud upload HTTP ${res.status}`);
      return;
    }

    lastUpload = now;
    console.log(`☁️  Backup cloud OK (${count} joueurs)`);
  } catch (e) {
    console.error('❌ Cloud upload erreur:', e.message);
  }
}

export function startPeriodicCloudBackup() {
  if (!isCloudBackupEnabled()) return;
  setInterval(uploadToCloud, 5 * 60 * 1000);
  console.log('☁️  Backup cloud périodique activé (toutes les 5 min)');
}
