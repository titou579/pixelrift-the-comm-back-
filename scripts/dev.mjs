// Lance PixelRift en local : installe les dépendances si besoin, crée server/.env,
// puis démarre le serveur (port 3001) et le client (port 5173).
//   npm start      (depuis la racine du projet)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = (d) => path.join(root, d);

// 1. Dépendances
for (const d of ['server', 'client']) {
  if (!fs.existsSync(path.join(dir(d), 'node_modules'))) {
    console.log(`\n📦 Installation des dépendances de ${d}…\n`);
    const r = spawnSync('npm', ['install'], { cwd: dir(d), stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.error(`❌ npm install a échoué dans ${d}.`);
      process.exit(1);
    }
  }
}

// 2. Fichier .env local (jamais envoyé sur GitHub)
const envPath = path.join(dir('server'), '.env');
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(
    envPath,
    [
      'NODE_ENV=development',
      'PORT=3001',
      `SESSION_SECRET=${crypto.randomBytes(24).toString('hex')}`,
      'CLIENT_URL=http://localhost:5173',
      '',
      '# Mots de passe des comptes. Si une ligne est vide, le mot de passe local est "pixelrift".',
      'ACCOUNT_TITOU_PWD=',
      'ACCOUNT_THOMAS_PWD=',
      'ACCOUNT_HUGO_PWD=',
      'ACCOUNT_LILOU_PWD=',
      'ACCOUNT_MATTEO_PWD=',
      '',
    ].join('\n')
  );
  console.log('🔑 server/.env créé (comptes : titou, thomas, hugo, lilou, matteo — mot de passe : pixelrift).');
}

// 3. Adresse sur le réseau local (pour jouer avec des amis sur le même Wi-Fi)
const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal);

console.log('\n🚀 PixelRift démarre…');
console.log('   Jeu            : http://localhost:5173');
if (lan) console.log(`   Amis (Wi-Fi)   : http://${lan.address}:5173`);
console.log('   (Ctrl+C pour tout arrêter)\n');

// 4. Serveur + client
const procs = [
  spawn('npm', ['run', 'dev'], { cwd: dir('server'), stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev'], { cwd: dir('client'), stdio: 'inherit', shell: true }),
];
const stop = () => { for (const p of procs) { try { p.kill(); } catch { /* déjà arrêté */ } } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
