import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadModel } from '../game/assetLoader.js';
import { GUN_FILES } from '../game/assetCatalog.js';
import {
  getGameConfig, getLoadout, saveLoadout, weaponStats, MODE_LABEL,
} from '../game/gameConfig.js';

// Aperçu 3D de l'arme survolée (une seule scène, le modèle tourne)
function WeaponPreview({ weaponId }) {
  const ref = useRef(null);
  const holderRef = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 200;
    renderer.setSize(w, h, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 50);
    camera.position.set(0, 0.35, 3.1);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
    const dl = new THREE.DirectionalLight(0xffffff, 2);
    dl.position.set(2, 3, 2);
    scene.add(dl);
    const holder = new THREE.Group();
    scene.add(holder);
    holderRef.current = holder;

    let raf;
    let last = performance.now();
    const loop = (t) => {
      const dt = (t - last) / 1000;
      last = t;
      holder.rotation.y += dt * 0.9;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      holderRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const holder = holderRef.current;
    if (!holder || !weaponId) return undefined;
    loadModel(GUN_FILES[weaponId])
      .then((raw) => {
        if (cancelled || !holderRef.current) return;
        const inner = raw.clone(true);
        inner.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        const c = box.getCenter(new THREE.Vector3());
        const s = 2.2 / Math.max(size.x, 1e-6);
        inner.scale.setScalar(s);
        inner.position.set(-c.x * s, -c.y * s, -c.z * s);
        const g = new THREE.Group();
        g.add(inner);
        holder.clear();
        holder.add(g);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [weaponId]);

  return <canvas ref={ref} className="arsenal-preview" />;
}

export default function Loadout({ onClose, onSave }) {
  const [config, setConfig] = useState(null);
  const [selected, setSelected] = useState([]);
  const [focus, setFocus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getGameConfig()
      .then((c) => {
        const l = getLoadout(c);
        setConfig(c);
        setSelected(l);
        setFocus(l[0]);
      })
      .catch((e) => setError(e.message || 'Impossible de charger les armes'));
  }, []);

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return [...prev.slice(0, 3), id]; // remplace le dernier emplacement
      return [...prev, id];
    });
  };

  const save = () => {
    if (selected.length !== 4) return;
    saveLoadout(selected);
    if (onSave) onSave(selected);
    onClose();
  };

  if (error) {
    return (
      <div className="arsenal-overlay">
        <div className="arsenal">
          <p className="error">{error}</p>
          <button className="secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="arsenal-overlay">
        <div className="arsenal"><p className="muted">Chargement de l'arsenal…</p></div>
      </div>
    );
  }

  const focused = config.weapons.find((w) => w.id === focus) || config.weapons[0];
  const st = weaponStats(focused);

  return (
    <div className="arsenal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="arsenal">
        <header className="arsenal-head">
          <h2>🔫 Arsenal</h2>
          <p className="muted">
            Choisis <strong>4 armes</strong> : tu les sélectionnes en jeu avec les touches 1 à 4 ou la molette.
          </p>
        </header>

        <div className="arsenal-body">
          <div className="arsenal-list">
            {config.weapons.map((w) => {
              const slot = selected.indexOf(w.id);
              const s = weaponStats(w);
              return (
                <button
                  key={w.id}
                  className={`weapon-card ${slot >= 0 ? 'picked' : ''} ${focused.id === w.id ? 'focus' : ''}`}
                  onClick={() => { toggle(w.id); setFocus(w.id); }}
                  onMouseEnter={() => setFocus(w.id)}
                >
                  {slot >= 0 && <span className="slot-badge">{slot + 1}</span>}
                  <span className="wc-name">{w.name}</span>
                  <span className="wc-type">{w.type}</span>
                  <span className="wc-nums">
                    {w.pellets > 1 ? `${w.pellets}×${w.damage}` : w.damage} dmg · {Math.round(s.dps)} dps
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="arsenal-side">
            <WeaponPreview weaponId={focused.id} />
            <h3>{focused.name}</h3>
            <p className="muted small">
              {focused.type} · {MODE_LABEL[focused.mode]}
              {focused.mode === 'burst' ? ` (${focused.burst} tirs)` : ''}
            </p>
            <div className="stat-bars">
              {st.bars.map((b) => (
                <div key={b.label} className="stat-row">
                  <span>{b.label}</span>
                  <div className="stat-bar"><i style={{ width: `${Math.round(b.value * 100)}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="muted small">
              Chargeur {focused.mag} · Rechargement {focused.reload}s · Tête ×{focused.headMult}
              {focused.zoom && focused.zoom < 45 ? ' · Lunette (clic droit)' : ''}
            </p>

            <div className="loadout-slots">
              {[0, 1, 2, 3].map((i) => {
                const w = config.weapons.find((x) => x.id === selected[i]);
                return (
                  <button
                    key={i}
                    className={`loadout-slot ${w ? 'filled' : ''}`}
                    onClick={() => w && toggle(w.id)}
                    title={w ? 'Cliquer pour retirer' : 'Emplacement libre'}
                  >
                    <b>{i + 1}</b>
                    <span>{w ? w.name : '— vide —'}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>

        <footer className="arsenal-foot">
          <button className="secondary" onClick={onClose}>Annuler</button>
          <button onClick={save} disabled={selected.length !== 4}>
            {selected.length === 4 ? 'Valider mon arsenal' : `Encore ${4 - selected.length} arme(s)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
