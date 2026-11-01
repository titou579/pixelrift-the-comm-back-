import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(UPLOAD_DIR, 'skins'), { recursive: true });
}

// Petit magasin JSON : lecture au démarrage, écriture différée et atomique
export function jsonStore(file, fallback) {
  ensureDirs();
  const full = path.join(DATA_DIR, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch {
    data = typeof fallback === 'function' ? fallback() : structuredClone(fallback);
  }
  let timer = null;
  const flush = () => {
    ensureDirs();
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, full);
  };
  return {
    get data() { return data; },
    set data(v) { data = v; },
    save() { clearTimeout(timer); timer = setTimeout(flush, 300); },
    saveNow() { clearTimeout(timer); flush(); },
    path: full,
  };
}
