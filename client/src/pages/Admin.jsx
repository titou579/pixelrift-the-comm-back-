import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import CharacterStage from '../components/CharacterStage.jsx';
import {
  adminPlayers, adminCreateAccount, adminSetPassword, adminSetRole, adminDisable, adminDeleteAccount,
  adminGrant, adminRename, adminResetStats, adminKick, adminCatalog, adminUpdateItem, adminDeleteItem,
  adminAddColorSkin, adminImportSkin, adminSettings, adminSetSettings, adminNewSeason, adminAnnounce,
  adminRooms, adminCloseRoom, adminLog, adminOverview,
} from '../api.js';
import { loadCatalog } from '../game/catalogStore.js';

const SUBTABS = [
  { id: 'players', label: 'Joueurs', icon: 'users' },
  { id: 'shop', label: 'Boutique', icon: 'shop' },
  { id: 'import', label: 'Importer', icon: 'upload' },
  { id: 'economy', label: 'Économie & saison', icon: 'coin' },
  { id: 'rooms', label: 'Salons', icon: 'play' },
  { id: 'log', label: 'Journal', icon: 'clock' },
];
const RARITY_IDS = ['common', 'rare', 'epic', 'legendary'];

function Field({ label, children }) {
  return <label className="fld">{label}{children}</label>;
}

// ----------------------------- Joueurs -----------------------------
function PlayersTab({ currentUser, items, onFlash }) {
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({ coins: '', xp: '', itemId: '', name: '', password: '' });
  const [create, setCreate] = useState({ username: '', password: '', role: 'player' });

  const load = () => adminPlayers().then((r) => setList(r.players)).catch((e) => onFlash('err', e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn, okText) => {
    try { await fn(); if (okText) onFlash('ok', okText); await load(); } catch (e) { onFlash('err', e.message); }
  };
  const p = list.find((x) => x.username === sel);
  const self = p && p.username.toLowerCase() === currentUser.username.toLowerCase();

  return (
    <div className="admin-cols">
      <div>
        <table className="board admin-table">
          <thead><tr><th>Joueur</th><th>Rôle</th><th>Niv.</th><th>Pièces</th><th>K/D</th><th>État</th></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.username} className={sel === x.username ? 'me' : ''} onClick={() => setSel(x.username)} style={{ cursor: 'pointer' }}>
                <td><b>{x.displayName}</b><small className="muted"> @{x.username}</small></td>
                <td>{x.role === 'admin' ? <span className="badge">ADMIN</span> : 'Joueur'}</td>
                <td>{x.level}</td><td>{x.coins}</td><td>{x.kills}/{x.deaths}</td>
                <td>{x.disabled ? <span className="st bad">Suspendu</span> : x.online ? <span className="st on">En ligne</span> : <span className="st">Hors ligne</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form
          className="form-card inline"
          onSubmit={(e) => { e.preventDefault(); act(() => adminCreateAccount(create), 'Compte créé.').then(() => setCreate({ username: '', password: '', role: 'player' })); }}
        >
          <h3><Icon name="plus" size={18} /> Créer un compte</h3>
          <div className="row3">
            <Field label="Identifiant"><input value={create.username} onChange={(e) => setCreate({ ...create, username: e.target.value })} /></Field>
            <Field label="Mot de passe"><input type="text" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} /></Field>
            <Field label="Rôle">
              <select value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}>
                <option value="player">Joueur</option><option value="admin">Administrateur</option>
              </select>
            </Field>
          </div>
          <button type="submit" disabled={!create.username || !create.password}>Créer</button>
        </form>
      </div>

      <div className="form-card">
        {!p ? <p className="muted">Sélectionne un joueur dans la liste.</p> : (
          <>
            <h3>{p.displayName} <small className="muted">@{p.username}</small></h3>
            <p className="muted small">Niveau {p.level} · {p.xp} XP · {p.coins} pièces · {p.wins} victoires · {p.matches} parties</p>

            <div className="row3">
              <Field label="Pièces (±)"><input type="number" value={form.coins} onChange={(e) => setForm({ ...form, coins: e.target.value })} placeholder="500" /></Field>
              <Field label="XP (±)"><input type="number" value={form.xp} onChange={(e) => setForm({ ...form, xp: e.target.value })} placeholder="1000" /></Field>
              <Field label="Objet">
                <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
                  <option value="">—</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.type === 'skin' ? 'Skin' : 'Traînée'} · {i.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="btn-row">
              <button onClick={() => act(() => adminGrant(p.username, { coins: form.coins, xp: form.xp, itemId: form.itemId }), 'Don effectué.')} disabled={!form.coins && !form.xp && !form.itemId}>Donner</button>
              <button className="secondary" onClick={() => act(() => adminGrant(p.username, { itemId: form.itemId, revoke: true }), 'Objet retiré.')} disabled={!form.itemId}>Retirer l’objet</button>
            </div>

            <div className="row2">
              <Field label="Changer le pseudo">
                <div className="inline-input">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={p.displayName} />
                  <button className="mini" disabled={!form.name} onClick={() => act(() => adminRename(p.username, form.name), 'Pseudo modifié.')}>OK</button>
                </div>
              </Field>
              <Field label="Nouveau mot de passe">
                <div className="inline-input">
                  <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 caractères min." />
                  <button className="mini" disabled={form.password.length < 8} onClick={() => act(() => adminSetPassword(p.username, form.password), 'Mot de passe réinitialisé.')}>OK</button>
                </div>
              </Field>
            </div>

            <div className="btn-row wrap">
              <button className="secondary" disabled={self} onClick={() => act(() => adminSetRole(p.username, p.role === 'admin' ? 'player' : 'admin'), 'Rôle modifié.')}>
                {p.role === 'admin' ? 'Retirer admin' : 'Nommer admin'}
              </button>
              <button className="secondary" disabled={self} onClick={() => act(() => adminDisable(p.username, !p.disabled), p.disabled ? 'Compte réactivé.' : 'Compte suspendu.')}>
                {p.disabled ? 'Réactiver' : 'Suspendre'}
              </button>
              <button className="secondary" onClick={() => act(() => adminKick(p.username), 'Joueur expulsé des salons.')}>Expulser</button>
              <button className="secondary" onClick={() => window.confirm('Remettre les statistiques à zéro ?') && act(() => adminResetStats(p.username), 'Statistiques réinitialisées.')}>Reset stats</button>
              <button className="danger" disabled={self} onClick={() => window.confirm(`Supprimer définitivement le compte ${p.username} ?`) && act(() => adminDeleteAccount(p.username).then(() => setSel(null)), 'Compte supprimé.')}>
                <Icon name="trash" size={15} /> Supprimer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ----------------------------- Boutique -----------------------------
function ShopTab({ onFlash, reloadCatalog }) {
  const [items, setItems] = useState([]);
  const [edits, setEdits] = useState({});
  const load = () => adminCatalog().then((r) => setItems(r.items)).catch((e) => onFlash('err', e.message));
  useEffect(() => { load(); }, []);
  const set = (id, patch) => setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));
  const val = (it, k) => (edits[it.id] && edits[it.id][k] !== undefined ? edits[it.id][k] : it[k]);

  const save = async (it) => {
    try {
      await adminUpdateItem(it.id, edits[it.id]);
      setEdits((e) => { const n = { ...e }; delete n[it.id]; return n; });
      onFlash('ok', `${it.name} mis à jour.`);
      await load(); reloadCatalog();
    } catch (e) { onFlash('err', e.message); }
  };
  const remove = async (it) => {
    if (!window.confirm(`Supprimer ${it.name} ? Les joueurs qui le possèdent le perdront.`)) return;
    try { await adminDeleteItem(it.id); onFlash('ok', 'Skin supprimé.'); await load(); reloadCatalog(); } catch (e) { onFlash('err', e.message); }
  };

  return (
    <table className="board admin-table shop-table">
      <thead><tr><th>Objet</th><th>Rareté</th><th>Prix</th><th>Niv. min</th><th>Actif</th><th>Pass</th><th /></tr></thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td>
              <b>{it.name}</b>
              <small className="muted"> {it.type === 'skin' ? (it.model.kind === 'glb' ? 'modèle 3D' : 'couleurs') : 'traînée'}{!it.builtin ? ' · importé' : ''}</small>
            </td>
            <td>
              <select value={val(it, 'rarity')} onChange={(e) => set(it.id, { rarity: e.target.value })}>
                {RARITY_IDS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </td>
            <td><input type="number" min="0" value={val(it, 'price')} onChange={(e) => set(it.id, { price: e.target.value })} className="num" /></td>
            <td><input type="number" min="1" max="100" value={val(it, 'minLevel')} onChange={(e) => set(it.id, { minLevel: e.target.value })} className="num" /></td>
            <td><input type="checkbox" checked={!!val(it, 'enabled')} onChange={(e) => set(it.id, { enabled: e.target.checked })} /></td>
            <td><input type="checkbox" checked={!!val(it, 'passOnly')} onChange={(e) => set(it.id, { passOnly: e.target.checked })} /></td>
            <td className="actions">
              <button className="mini" disabled={!edits[it.id]} onClick={() => save(it)}>Enregistrer</button>
              {!it.builtin && <button className="mini danger" onClick={() => remove(it)}><Icon name="trash" size={13} /></button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ----------------------------- Import -----------------------------
function ImportTab({ onFlash, reloadCatalog }) {
  const [file, setFile] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [glb, setGlb] = useState({ name: '', desc: '', rarity: 'rare', price: 900, minLevel: 1, height: 1.8, yaw: 0, auto: '1', creditTitle: '', creditAuthor: '', creditLicense: 'CC BY 4.0', creditUrl: '' });
  const [col, setCol] = useState({ name: '', rarity: 'common', price: 400, minLevel: 1, suit: '#4b5a3a', vest: '#2f3a28', helmet: '#2b3322', skin: '#d9a77a', accent: '#ff9d1c', glow: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const pick = (f) => {
    setFile(f);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(f ? URL.createObjectURL(f) : null);
    if (f && !glb.name) setGlb((g) => ({ ...g, name: f.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ') }));
  };

  const glbSkin = useMemo(() => (blobUrl ? {
    id: 'preview', name: glb.name, rarity: glb.rarity,
    model: { kind: 'glb', url: blobUrl, rig: 'none', fit: { auto: glb.auto !== '0', height: Number(glb.height) || 1.8, yaw: Number(glb.yaw) || 0 } },
  } : null), [blobUrl, glb.name, glb.rarity, glb.height, glb.yaw]);

  const colSkin = useMemo(() => ({
    id: 'preview-col', name: col.name, rarity: col.rarity,
    model: {
      kind: 'procedural',
      palette: { suit: parseInt(col.suit.slice(1), 16), vest: parseInt(col.vest.slice(1), 16), helmet: parseInt(col.helmet.slice(1), 16), skin: parseInt(col.skin.slice(1), 16), accent: parseInt(col.accent.slice(1), 16), glow: col.glow },
    },
  }), [col]);

  const upload = async () => {
    setBusy(true);
    try {
      await adminImportSkin(file, glb);
      onFlash('ok', 'Skin importé et ajouté à la boutique.');
      setFile(null); setBlobUrl(null); setGlb((g) => ({ ...g, name: '', desc: '' }));
      reloadCatalog();
    } catch (e) { onFlash('err', e.message); }
    setBusy(false);
  };
  const createColor = async () => {
    setBusy(true);
    try {
      await adminAddColorSkin({
        name: col.name, rarity: col.rarity, price: col.price, minLevel: col.minLevel,
        palette: { suit: col.suit, vest: col.vest, helmet: col.helmet, skin: col.skin, accent: col.accent, glow: col.glow },
      });
      onFlash('ok', 'Skin de couleur créé.');
      setCol((c) => ({ ...c, name: '' }));
      reloadCatalog();
    } catch (e) { onFlash('err', e.message); }
    setBusy(false);
  };

  const big = file && file.size > 25 * 1024 * 1024;
  return (
    <div className="admin-cols">
      <div className="form-card">
        <h3><Icon name="upload" size={18} /> Importer un modèle 3D (.glb)</h3>
        <p className="muted small">
          Personnage de face (+Z), debout, pieds au sol. Le jeu le met à l'échelle automatiquement.
          Garde un fichier léger (moins de 25 Mo, textures de 1024 px) : voir le README pour l'optimiser.
        </p>
        <input type="file" accept=".glb,model/gltf-binary" onChange={(e) => pick(e.target.files[0] || null)} />
        {big && <p className="error">Fichier lourd ({(file.size / 1e6).toFixed(0)} Mo) : le chargement sera long pour les joueurs.</p>}
        <div className="row2">
          <Field label="Nom"><input value={glb.name} onChange={(e) => setGlb({ ...glb, name: e.target.value })} /></Field>
          <Field label="Rareté">
            <select value={glb.rarity} onChange={(e) => setGlb({ ...glb, rarity: e.target.value })}>{RARITY_IDS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </Field>
        </div>
        <Field label="Description"><input value={glb.desc} onChange={(e) => setGlb({ ...glb, desc: e.target.value })} /></Field>
        <div className="row3">
          <Field label="Prix"><input type="number" value={glb.price} onChange={(e) => setGlb({ ...glb, price: e.target.value })} /></Field>
          <Field label="Niveau min"><input type="number" value={glb.minLevel} onChange={(e) => setGlb({ ...glb, minLevel: e.target.value })} /></Field>
          <Field label="Hauteur (m)"><input type="number" step="0.05" value={glb.height} onChange={(e) => setGlb({ ...glb, height: e.target.value })} /></Field>
        </div>
        <Field label="Rotation (°) — si le personnage regarde de côté ou de dos"><input type="number" value={glb.yaw} onChange={(e) => setGlb({ ...glb, yaw: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={glb.auto === '0'} onChange={(e) => setGlb({ ...glb, auto: e.target.checked ? '0' : '1' })} /> Déjà à l'échelle (fichier passé dans l'outil d'optimisation)</label>
        <h4 className="sect small">Crédits (licence CC-BY : obligatoires)</h4>
        <div className="row2">
          <Field label="Titre du modèle"><input value={glb.creditTitle} onChange={(e) => setGlb({ ...glb, creditTitle: e.target.value })} /></Field>
          <Field label="Auteur"><input value={glb.creditAuthor} onChange={(e) => setGlb({ ...glb, creditAuthor: e.target.value })} /></Field>
        </div>
        <div className="row2">
          <Field label="Licence"><input value={glb.creditLicense} onChange={(e) => setGlb({ ...glb, creditLicense: e.target.value })} /></Field>
          <Field label="Lien"><input value={glb.creditUrl} onChange={(e) => setGlb({ ...glb, creditUrl: e.target.value })} /></Field>
        </div>
        <button onClick={upload} disabled={!file || busy || glb.name.trim().length < 2}>{busy ? 'Envoi…' : 'Ajouter à la boutique'}</button>
        {glbSkin && <div className="mini-stage"><CharacterStage variant="hero" interactive slots={[{ key: 'imp', skin: glbSkin, weaponId: 'assault' }]} /></div>}
      </div>

      <div className="form-card">
        <h3><Icon name="shirt" size={18} /> Créer un skin de couleur</h3>
        <p className="muted small">Une variante du mannequin de base : choisis les couleurs, l'aperçu se met à jour.</p>
        <div className="row2">
          <Field label="Nom"><input value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} /></Field>
          <Field label="Rareté">
            <select value={col.rarity} onChange={(e) => setCol({ ...col, rarity: e.target.value })}>{RARITY_IDS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </Field>
        </div>
        <div className="row2">
          <Field label="Prix"><input type="number" value={col.price} onChange={(e) => setCol({ ...col, price: e.target.value })} /></Field>
          <Field label="Niveau min"><input type="number" value={col.minLevel} onChange={(e) => setCol({ ...col, minLevel: e.target.value })} /></Field>
        </div>
        <div className="colors">
          {['suit', 'vest', 'helmet', 'skin', 'accent'].map((k) => (
            <label key={k} className="colorpick">{({ suit: 'Tenue', vest: 'Gilet', helmet: 'Casque', skin: 'Peau', accent: 'Accent' })[k]}
              <input type="color" value={col[k]} onChange={(e) => setCol({ ...col, [k]: e.target.value })} />
            </label>
          ))}
          <label className="check"><input type="checkbox" checked={col.glow} onChange={(e) => setCol({ ...col, glow: e.target.checked })} /> Visière lumineuse</label>
        </div>
        <button onClick={createColor} disabled={busy || col.name.trim().length < 2}>Créer</button>
        <div className="mini-stage"><CharacterStage variant="hero" interactive slots={[{ key: 'col', skin: colSkin, weaponId: 'assault' }]} /></div>
      </div>
    </div>
  );
}

// ----------------------------- Économie -----------------------------
function EconomyTab({ onFlash }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ xpMult: 1, coinMult: 1, shopDiscount: 0, maxAccounts: 50, announcement: '' });
  const [seasonName, setSeasonName] = useState('');
  const [text, setText] = useState('');

  const load = () => Promise.all([adminSettings(), adminOverview()]).then(([s, o]) => {
    setData({ ...s, overview: o });
    setF({ xpMult: s.settings.xpMult, coinMult: s.settings.coinMult, shopDiscount: s.settings.shopDiscount, maxAccounts: s.settings.maxAccounts, announcement: s.settings.announcement || '' });
  }).catch((e) => onFlash('err', e.message));
  useEffect(() => { load(); }, []);

  const save = async (patch, okText = 'Réglages enregistrés.') => {
    try { await adminSetSettings(patch); onFlash('ok', okText); await load(); } catch (e) { onFlash('err', e.message); }
  };
  if (!data) return <p className="muted">Chargement…</p>;
  const eco = data.economy;

  return (
    <div className="admin-cols">
      <div>
        <div className="form-card">
          <h3><Icon name="chart" size={18} /> Économie du jeu</h3>
          <div className="stats-grid four">
            <div className="stat-card"><div className="stat-num">{eco.players}</div><div className="stat-label">Joueurs</div></div>
            <div className="stat-card"><div className="stat-num">{eco.coinsInCirculation.toLocaleString('fr-FR')}</div><div className="stat-label">Pièces en circulation</div></div>
            <div className="stat-card"><div className="stat-num">{eco.totalMatches}</div><div className="stat-label">Parties jouées</div></div>
            <div className="stat-card"><div className="stat-num">{eco.premiumCount}</div><div className="stat-label">Pass Premium</div></div>
          </div>
          <div className="row3">
            <Field label="Multiplicateur d'XP"><input type="number" step="0.5" min="0" max="10" value={f.xpMult} onChange={(e) => setF({ ...f, xpMult: e.target.value })} /></Field>
            <Field label="Multiplicateur de pièces"><input type="number" step="0.5" min="0" max="10" value={f.coinMult} onChange={(e) => setF({ ...f, coinMult: e.target.value })} /></Field>
            <Field label="Remise boutique (%)"><input type="number" min="0" max="90" value={f.shopDiscount} onChange={(e) => setF({ ...f, shopDiscount: e.target.value })} /></Field>
          </div>
          <div className="btn-row wrap">
            <button onClick={() => save(f)}>Enregistrer</button>
            <button className="secondary" onClick={() => save({ xpMult: 2, coinMult: 1 }, 'Week-end double XP activé.')}>Double XP</button>
            <button className="secondary" onClick={() => save({ shopDiscount: 30 }, 'Soldes −30 % activées.')}>Soldes −30 %</button>
            <button className="secondary" onClick={() => save({ xpMult: 1, coinMult: 1, shopDiscount: 0 }, 'Événements désactivés.')}>Tout remettre à 1</button>
          </div>
          <Field label="Nombre maximum de comptes"><input type="number" value={f.maxAccounts} onChange={(e) => setF({ ...f, maxAccounts: e.target.value })} /></Field>
        </div>
      </div>

      <div>
        <div className="form-card">
          <h3><Icon name="ticket" size={18} /> Saison du pass de combat</h3>
          <p className="muted small">Saison {data.settings.season.number} — « {data.settings.season.name} », lancée le {new Date(data.settings.season.startedAt).toLocaleDateString('fr-FR')}.</p>
          <div className="inline-input">
            <input value={seasonName} onChange={(e) => setSeasonName(e.target.value)} placeholder="Nom de la prochaine saison" />
            <button
              className="danger"
              onClick={() => window.confirm('Lancer une nouvelle saison ? Le pass de TOUS les joueurs repart de zéro (leurs skins gagnés sont conservés).') && adminNewSeason(seasonName).then(() => { onFlash('ok', 'Nouvelle saison lancée.'); setSeasonName(''); load(); }).catch((e) => onFlash('err', e.message))}
            >Nouvelle saison</button>
          </div>
        </div>
        <div className="form-card">
          <h3><Icon name="megaphone" size={18} /> Annonces</h3>
          <Field label="Message affiché dans le menu (vide = aucun)">
            <div className="inline-input">
              <input value={f.announcement} onChange={(e) => setF({ ...f, announcement: e.target.value })} maxLength={200} />
              <button className="mini" onClick={() => save({ announcement: f.announcement }, 'Annonce du menu mise à jour.')}>OK</button>
            </div>
          </Field>
          <Field label="Message instantané (tous les joueurs connectés)">
            <div className="inline-input">
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
              <button className="mini" disabled={!text} onClick={() => adminAnnounce(text).then(() => { onFlash('ok', 'Annonce envoyée.'); setText(''); }).catch((e) => onFlash('err', e.message))}>Envoyer</button>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- Salons -----------------------------
function RoomsTab({ onFlash }) {
  const [rooms, setRooms] = useState([]);
  const load = () => adminRooms().then((r) => setRooms(r.rooms)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  if (!rooms.length) return <p className="muted">Aucun salon ouvert pour le moment.</p>;
  return (
    <div className="room-grid">
      {rooms.map((r) => (
        <div key={r.code} className="form-card">
          <h3>{r.code} <small className="muted">{r.mode === 'team' ? 'Équipes' : 'Chacun pour soi'} · {r.status === 'playing' ? 'en match' : 'en attente'} · objectif {r.killTarget}</small></h3>
          {r.players.map((p) => (
            <div key={p.id} className="kv"><span>{p.username} <small className="muted">@{p.login}</small>{r.mode === 'team' && <em className={`tm t${p.team}`}> {p.team === 0 ? 'Alpha' : 'Bravo'}</em>}</span><b>{p.kills}/{p.deaths}</b></div>
          ))}
          <button className="danger" onClick={() => adminCloseRoom(r.code).then(() => { onFlash('ok', 'Salon fermé.'); load(); })}>Fermer le salon</button>
        </div>
      ))}
    </div>
  );
}

// ----------------------------- Journal -----------------------------
function LogTab() {
  const [entries, setEntries] = useState([]);
  useEffect(() => { adminLog().then((r) => setEntries(r.entries)).catch(() => {}); }, []);
  return (
    <table className="board admin-table">
      <thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Détail</th></tr></thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i}><td>{new Date(e.t).toLocaleString('fr-FR')}</td><td>{e.by}</td><td>{e.action}</td><td className="muted">{e.detail}</td></tr>
        ))}
        {entries.length === 0 && <tr><td colSpan="4" className="muted">Aucune action pour le moment.</td></tr>}
      </tbody>
    </table>
  );
}

// ----------------------------- Panneau -----------------------------
export default function Admin({ currentUser, onFlash }) {
  const [sub, setSub] = useState('players');
  const [items, setItems] = useState([]);
  const reloadCatalog = () => {
    adminCatalog().then((r) => setItems(r.items)).catch(() => {});
    loadCatalog(true).catch(() => {});
  };
  useEffect(() => { reloadCatalog(); }, []);

  return (
    <div className="tab-pane admin">
      <div className="subtabs">
        {SUBTABS.map((t) => (
          <button key={t.id} className={`subtab ${sub === t.id ? 'on' : ''}`} onClick={() => setSub(t.id)}>
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </div>
      {sub === 'players' && <PlayersTab currentUser={currentUser} items={items} onFlash={onFlash} />}
      {sub === 'shop' && <ShopTab onFlash={onFlash} reloadCatalog={reloadCatalog} />}
      {sub === 'import' && <ImportTab onFlash={onFlash} reloadCatalog={reloadCatalog} />}
      {sub === 'economy' && <EconomyTab onFlash={onFlash} />}
      {sub === 'rooms' && <RoomsTab onFlash={onFlash} />}
      {sub === 'log' && <LogTab />}
    </div>
  );
}

