import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import CharacterStage from '../components/CharacterStage.jsx';
import Admin from './Admin.jsx';
import {
  getProfile, getPass, getLeaderboard, buyItem, equipItem, claimPassTier, buyPremiumPass, claimQuest,
  changeDisplayName, changePassword,
} from '../api.js';
import { loadCatalog, hex } from '../game/catalogStore.js';
import { getGameConfig, getLoadout } from '../game/gameConfig.js';
import { getSocket } from '../socket.js';

const TABS = [
  { id: 'profile', label: 'Opérateur', icon: 'user' },
  { id: 'shop', label: 'Boutique', icon: 'shop' },
  { id: 'locker', label: 'Casier', icon: 'shirt' },
  { id: 'pass', label: 'Pass de combat', icon: 'ticket' },
  { id: 'quests', label: 'Quêtes', icon: 'quest' },
  { id: 'account', label: 'Compte', icon: 'gear' },
];

function LevelRing({ level, into, need }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = need ? Math.min(1, into / need) : 1;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" width="132" height="132">
        <circle cx="60" cy="60" r={r} className="ring-bg" />
        <circle cx="60" cy="60" r={r} className="ring-fg" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="ring-txt"><small>NIVEAU</small><b>{level}</b></div>
    </div>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="stat-card">
      <Icon name={icon} size={20} className="stat-ico" />
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Rarity({ r, rarities }) {
  const info = rarities[r] || { label: r, color: '#9aa0a6' };
  return <span className="rarity" style={{ '--rc': info.color }}>{info.label}</span>;
}

function PriceTag({ item }) {
  const discounted = item.finalPrice !== item.price;
  if (item.price === 0) return <span className="price free">Gratuit</span>;
  return (
    <span className="price">
      <Icon name="coin" size={15} />
      {discounted && <s>{item.price}</s>}
      <b>{item.finalPrice}</b>
    </span>
  );
}

function RewardChip({ reward, item, locked }) {
  if (!reward) return null;
  let icon = 'coin';
  let text = '';
  if (reward.type === 'coins') text = `${reward.amount}`;
  else if (reward.type === 'skin') { icon = 'shirt'; text = item ? item.name : reward.id; }
  else { icon = 'tracer'; text = item ? item.name : reward.id; }
  return (
    <div className={`reward ${locked ? 'locked' : ''}`} data-rarity={item && item.rarity ? item.rarity : ''}>
      <Icon name={icon} size={20} />
      <span>{text}</span>
    </div>
  );
}

export default function Profile({ user, onBack, onUserChange }) {
  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [pass, setPass] = useState(null);
  const [board, setBoard] = useState([]);
  const [msg, setMsg] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [weaponId, setWeaponId] = useState('assault');
  const [shopKind, setShopKind] = useState('skins');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [nameInput, setNameInput] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const isAdmin = user.role === 'admin';

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg((m) => (m && m.text === text ? null : m)), 4500);
  };

  async function refreshAll() {
    try {
      const [p, c, ps, b] = await Promise.all([getProfile(), loadCatalog(true), getPass(), getLeaderboard()]);
      setProfile(p.profile); setCatalog(c); setPass(ps); setBoard(b.list);
      setNameInput(p.profile.displayName);
    } catch (e) { flash('err', e.message); }
  }
  useEffect(() => {
    refreshAll();
    getGameConfig().then((cfg) => setWeaponId(getLoadout(cfg)[0])).catch(() => {});
  }, []);

  const notifyChanged = () => { try { getSocket().emit('profile:changed'); } catch { /* hors ligne */ } };

  async function run(fn, okText) {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.profile) setProfile(r.profile);
      if (r && r.pass) setPass(r.pass);
      if (okText) flash('ok', okText);
      return r;
    } catch (e) { flash('err', e.message); return null; }
    finally { setBusy(false); }
  }

  const skins = catalog ? catalog.skins : [];
  const tracers = catalog ? catalog.tracers : [];
  const rarities = catalog ? catalog.rarities : {};
  const skinMap = useMemo(() => new Map(skins.map((s) => [s.id, s])), [skins]);

  if (!profile || !catalog || !pass) {
    return <div className="screen center"><p className="muted">{msg ? msg.text : 'Chargement du quartier général…'}</p></div>;
  }

  const previewSkin = skinMap.get(previewId || profile.equippedSkin) || skinMap.get('recrue');
  const owned = (it) => (it.type === 'skin' ? profile.ownedSkins : profile.ownedTracers).includes(it.id);
  const equipped = (it) => (it.type === 'skin' ? profile.equippedSkin === it.id : profile.equippedTracer === it.id);
  const kd = profile.stats.totalDeaths
    ? (profile.stats.totalKills / profile.stats.totalDeaths).toFixed(2)
    : profile.stats.totalKills.toFixed(2);

  const doBuy = (it) => run(() => buyItem(it.id), `${it.name} acheté !`);
  const doEquip = async (it) => {
    const r = await run(() => equipItem(it.id), `${it.name} équipé.`);
    if (r) notifyChanged();
  };

  // Bouton d'action principal pour un objet (acheter / équiper…)
  const action = (it) => {
    if (equipped(it)) return <button disabled className="secondary"><Icon name="check" size={16} /> Équipé</button>;
    if (owned(it)) return <button onClick={() => doEquip(it)} disabled={busy}>Équiper</button>;
    if (it.passOnly) return <button disabled className="secondary"><Icon name="ticket" size={16} /> Récompense de pass</button>;
    if (profile.level < (it.minLevel || 1)) return <button disabled className="secondary"><Icon name="lock" size={16} /> Niveau {it.minLevel}</button>;
    const poor = profile.coins < it.finalPrice;
    return (
      <button onClick={() => doBuy(it)} disabled={busy || poor} title={poor ? 'Pas assez de NovaCoins' : ''}>
        Acheter · {it.finalPrice} <Icon name="coin" size={16} />
      </button>
    );
  };

  const skinCard = (it) => {
    const pal = it.model && it.model.kind === 'procedural' ? it.model.palette : null;
    return (
      <button
        key={it.id}
        className={`item-card ${previewSkin && previewSkin.id === it.id ? 'selected' : ''} ${owned(it) ? 'owned' : ''}`}
        style={{ '--rc': (rarities[it.rarity] || {}).color }}
        onClick={() => setPreviewId(it.id)}
      >
        <div className="item-top">
          {pal ? (
            <div className="swatches">
              {['suit', 'vest', 'helmet', 'accent'].map((k) => <i key={k} style={{ background: hex(pal[k]) }} />)}
            </div>
          ) : <span className="tag3d">MODÈLE 3D</span>}
          {equipped(it) && <span className="state on">ÉQUIPÉ</span>}
          {!equipped(it) && owned(it) && <span className="state">POSSÉDÉ</span>}
          {!owned(it) && it.passOnly && <span className="state pass">PASS</span>}
          {!owned(it) && !it.passOnly && profile.level < (it.minLevel || 1) && (
            <span className="state lock"><Icon name="lock" size={12} /> NIV. {it.minLevel}</span>
          )}
        </div>
        <div className="item-name">{it.name}</div>
        <div className="item-foot">
          <Rarity r={it.rarity} rarities={rarities} />
          {!owned(it) && <PriceTag item={it} />}
        </div>
      </button>
    );
  };

  const tracerCard = (it) => {
    const color = it.color === 'rainbow' ? null : it.color === null ? 0xffe9a8 : it.color;
    const sample = color === null
      ? 'linear-gradient(90deg,#ff2f2f,#ffd93d,#4cff6a,#2fd5ff,#8b5cf6,#ff2fb9)'
      : `linear-gradient(90deg, transparent, ${hex(color)})`;
    return (
      <div key={it.id} className={`item-card tracer ${owned(it) ? 'owned' : ''}`} style={{ '--rc': (rarities[it.rarity] || {}).color }}>
        <div className="tracer-sample" style={{ background: sample }} />
        <div className="item-name">{it.name}</div>
        <div className="item-desc">{it.desc}</div>
        <div className="item-foot">
          <Rarity r={it.rarity} rarities={rarities} />
          {!owned(it) && <PriceTag item={it} />}
        </div>
        {action(it)}
      </div>
    );
  };

  const filterRarity = (list) => (rarityFilter === 'all' ? list : list.filter((i) => i.rarity === rarityFilter));
  const shopSkins = filterRarity(skins.filter((s) => s.enabled && !s.passOnly));
  const shopTracers = filterRarity(tracers.filter((s) => s.enabled && !s.passOnly));
  const ev = catalog.event;

  // ------------------------------ Onglets ------------------------------
  const tabProfile = (
    <div className="tab-pane">
      {(ev.xpMult !== 1 || ev.coinMult !== 1 || ev.shopDiscount > 0) && (
        <div className="event-banner">
          <Icon name="megaphone" size={18} />
          <span>
            Événement en cours :
            {ev.xpMult !== 1 && <b> ×{ev.xpMult} XP</b>}
            {ev.coinMult !== 1 && <b> ×{ev.coinMult} NovaCoins</b>}
            {ev.shopDiscount > 0 && <b> −{ev.shopDiscount}% en boutique</b>}
          </span>
        </div>
      )}
      <div className="level-row">
        <LevelRing level={profile.level} into={profile.levelXp} need={profile.levelNeed} />
        <div className="level-info">
          <div className="xp-label"><span>Progression du niveau</span><span><strong>{profile.levelXp}</strong> / {profile.levelNeed || '—'} XP</span></div>
          <div className="xp-bar"><div className="xp-fill" style={{ width: `${profile.levelNeed ? (profile.levelXp / profile.levelNeed) * 100 : 100}%` }} /></div>
          <p className="muted small">XP total : {profile.xp.toLocaleString('fr-FR')} · Pass de combat : palier {profile.passTier}/{pass.tiers.length}</p>
        </div>
      </div>
      <div className="stats-grid">
        <Stat icon="kills" value={profile.stats.totalKills} label="Éliminations" />
        <Stat icon="skull" value={profile.stats.totalDeaths} label="Morts" />
        <Stat icon="chart" value={kd} label="Ratio K/D" />
        <Stat icon="trophy" value={profile.stats.totalWins} label="Victoires" />
        <Stat icon="flag" value={profile.stats.totalMatches} label="Parties" />
        <Stat icon="star" value={profile.stats.totalHeadshots} label="Tirs à la tête" />
        <Stat icon="users" value={profile.stats.teamWins} label="Victoires d'équipe" />
        <Stat icon="medal" value={profile.stats.bestKillsMatch} label="Record de kills" />
        <Stat icon="refresh" value={profile.stats.totalRiftUses} label="Rifts utilisés" />
      </div>
      <h3 className="sect">Classement</h3>
      <table className="board">
        <thead><tr><th>#</th><th>Opérateur</th><th>Niv.</th><th>Victoires</th><th>Kills</th></tr></thead>
        <tbody>
          {board.map((b, i) => (
            <tr key={b.name + i} className={b.name === profile.displayName ? 'me' : ''}>
              <td>{i + 1}</td><td>{b.name}</td><td>{b.level}</td><td>{b.wins}</td><td>{b.kills}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const tabShop = (
    <div className="tab-pane">
      <div className="subbar">
        <div className="seg">
          <button className={shopKind === 'skins' ? 'on' : ''} onClick={() => setShopKind('skins')}><Icon name="shirt" size={16} /> Skins</button>
          <button className={shopKind === 'tracers' ? 'on' : ''} onClick={() => setShopKind('tracers')}><Icon name="tracer" size={16} /> Traînées</button>
        </div>
        <div className="chips">
          {['all', 'common', 'rare', 'epic', 'legendary'].map((r) => (
            <button
              key={r}
              className={`chip ${rarityFilter === r ? 'on' : ''}`}
              style={r !== 'all' ? { '--rc': rarities[r] && rarities[r].color } : undefined}
              onClick={() => setRarityFilter(r)}
            >
              {r === 'all' ? 'Tout' : rarities[r] && rarities[r].label}
            </button>
          ))}
        </div>
      </div>
      {ev.shopDiscount > 0 && <p className="muted small">Remise de {ev.shopDiscount}% appliquée sur tous les prix.</p>}
      <div className="grid-cards">
        {shopKind === 'skins' ? shopSkins.map(skinCard) : shopTracers.map(tracerCard)}
        {(shopKind === 'skins' ? shopSkins : shopTracers).length === 0 && <p className="muted">Rien à afficher avec ce filtre.</p>}
      </div>
    </div>
  );

  const tabLocker = (
    <div className="tab-pane">
      <h3 className="sect">Mes skins <small>{profile.ownedSkins.length}</small></h3>
      <div className="grid-cards">
        {skins.filter((s) => profile.ownedSkins.includes(s.id)).map(skinCard)}
      </div>
      <h3 className="sect">Mes traînées <small>{profile.ownedTracers.length}</small></h3>
      <div className="grid-cards">
        {tracers.filter((t) => profile.ownedTracers.includes(t.id)).map(tracerCard)}
      </div>
    </div>
  );

  const tabPass = (
    <div className="tab-pane">
      <div className="pass-head">
        <div>
          <div className="stamp" style={{ color: 'var(--accent)' }}>Saison {pass.season.number}</div>
          <h3 className="pass-title">{pass.season.name}</h3>
          <p className="muted small">Palier <strong>{pass.tier}</strong> / {pass.tiers.length} · {pass.seasonXp} XP de saison</p>
        </div>
        {pass.premium
          ? <div className="premium-on"><Icon name="crown" size={20} /> Pass Premium actif</div>
          : (
            <button onClick={() => run(buyPremiumPass, 'Pass Premium débloqué !')} disabled={busy || profile.coins < pass.premiumPrice}>
              <Icon name="crown" size={18} /> Débloquer le Premium · {pass.premiumPrice} <Icon name="coin" size={16} />
            </button>
          )}
      </div>
      <div className="xp-bar big"><div className="xp-fill" style={{ width: `${Math.min(100, ((pass.seasonXp % pass.xpPerTier) / pass.xpPerTier) * 100)}%` }} /></div>
      <div className="pass-track">
        <div className="pass-legend"><span>Gratuit</span><span><Icon name="crown" size={14} /> Premium</span></div>
        <div className="pass-scroll">
          {pass.tiers.map((t) => {
            const unlocked = pass.tier >= t.tier;
            const freeDone = pass.claimedFree.includes(t.tier);
            const premDone = pass.claimedPremium.includes(t.tier);
            return (
              <div key={t.tier} className={`tier ${unlocked ? 'unlocked' : ''}`}>
                <div className="tier-n">{t.tier}</div>
                <div className="tier-slot">
                  <RewardChip reward={t.free} item={t.freeItem} locked={!unlocked} />
                  {freeDone
                    ? <span className="done"><Icon name="check" size={14} /></span>
                    : (
                      <button className="mini" disabled={!unlocked || busy} onClick={() => run(() => claimPassTier(t.tier, 'free'), 'Récompense récupérée !')}>
                        {unlocked ? 'Récupérer' : <Icon name="lock" size={13} />}
                      </button>
                    )}
                </div>
                <div className={`tier-slot prem ${pass.premium ? '' : 'off'}`}>
                  <RewardChip reward={t.premium} item={t.premiumItem} locked={!unlocked || !pass.premium} />
                  {premDone
                    ? <span className="done"><Icon name="check" size={14} /></span>
                    : (
                      <button className="mini" disabled={!unlocked || !pass.premium || busy} onClick={() => run(() => claimPassTier(t.tier, 'premium'), 'Récompense premium récupérée !')}>
                        {unlocked && pass.premium ? 'Récupérer' : <Icon name="lock" size={13} />}
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const questList = (title, scope, data) => (
    <>
      <h3 className="sect">{title}</h3>
      <div className="quest-col">
        {data.list.map((q) => {
          const done = q.progress >= q.target;
          return (
            <div key={q.id} className={`quest-item ${done ? 'done' : ''} ${q.claimed ? 'claimed' : ''}`}>
              <div className="quest-info">
                <b>{q.desc}</b>
                <div className="quest-progress-bar"><div className="quest-progress-fill" style={{ width: `${(q.progress / q.target) * 100}%` }} /></div>
                <span className="quest-progress-text">{q.progress} / {q.target}</span>
              </div>
              <div className="quest-reward"><Icon name="coin" size={15} /> {q.reward.coins} <Icon name="xp" size={15} /> {q.reward.xp}</div>
              {q.claimed
                ? <span className="done"><Icon name="check" size={16} /></span>
                : <button className="mini" disabled={!done || busy} onClick={() => run(() => claimQuest(scope, q.id), 'Récompense de quête récupérée !')}>Récupérer</button>}
            </div>
          );
        })}
      </div>
    </>
  );
  const tabQuests = (
    <div className="tab-pane">
      {questList('Quotidiennes', 'daily', profile.quests.daily)}
      {questList('Hebdomadaires', 'weekly', profile.quests.weekly)}
    </div>
  );

  async function submitName(e) {
    e.preventDefault();
    const r = await run(() => changeDisplayName(nameInput), 'Pseudo modifié !');
    if (r) { notifyChanged(); if (onUserChange) onUserChange({ ...user, displayName: r.profile.displayName }); }
  }
  async function submitPw(e) {
    e.preventDefault();
    if (pw.next !== pw.confirm) { flash('err', 'La confirmation ne correspond pas.'); return; }
    const r = await run(() => changePassword(pw.current, pw.next), 'Mot de passe modifié. Les autres appareils sont déconnectés.');
    if (r) setPw({ current: '', next: '', confirm: '' });
  }
  const tabAccount = (
    <div className="tab-pane">
      <div className="account-grid">
        <form className="form-card" onSubmit={submitName}>
          <h3><Icon name="edit" size={18} /> Pseudo</h3>
          <p className="muted small">Visible par tous les joueurs. 3 à 16 caractères, modifiable toutes les heures.</p>
          <label>Nouveau pseudo<input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={16} /></label>
          <button type="submit" disabled={busy || nameInput.trim() === profile.displayName}>Enregistrer</button>
        </form>
        <form className="form-card" onSubmit={submitPw}>
          <h3><Icon name="key" size={18} /> Mot de passe</h3>
          <p className="muted small">8 caractères minimum. Tes autres appareils seront déconnectés.</p>
          <label>Mot de passe actuel<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
          <label>Nouveau mot de passe<input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
          <label>Confirmer<input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></label>
          <button type="submit" disabled={busy || !pw.current || !pw.next}>Modifier</button>
        </form>
        <div className="form-card">
          <h3><Icon name="info" size={18} /> Informations</h3>
          <div className="kv"><span>Identifiant</span><b>{user.username}</b></div>
          <div className="kv"><span>Rôle</span><b>{isAdmin ? 'Administrateur' : 'Joueur'}</b></div>
          <div className="kv"><span>Compte créé</span><b>{new Date(profile.createdAt).toLocaleDateString('fr-FR')}</b></div>
          <div className="kv"><span>Skins / traînées</span><b>{profile.ownedSkins.length} / {profile.ownedTracers.length}</b></div>
        </div>
      </div>
    </div>
  );

  const tabs = isAdmin ? [...TABS, { id: 'admin', label: 'Administration', icon: 'shield' }] : TABS;
  const content = { profile: tabProfile, shop: tabShop, locker: tabLocker, pass: tabPass, quests: tabQuests, account: tabAccount }[tab];

  return (
    <div className="screen hq">
      <div className="watermark">HQ</div>
      <header className="hq-top">
        <button className="secondary small-btn" onClick={onBack}><Icon name="back" size={16} /> Retour</button>
        <h1 className="logo">PIXEL<span>RIFT</span></h1>
        <div className="hq-wallet">
          <span className="wallet"><Icon name="coin" size={20} /> <b>{profile.coins.toLocaleString('fr-FR')}</b></span>
        </div>
      </header>

      <div className={`hq-body ${tab === 'admin' ? 'wide' : ''}`}>
        <aside className="hq-left">
          <div className="hq-operator">
            <div className="hq-name">{profile.displayName}</div>
            <div className="hq-sub">Niveau {profile.level} · {isAdmin ? 'Commandement' : 'Opérateur'}</div>
          </div>
          <CharacterStage variant="hero" slots={[{ key: 'me', skin: previewSkin, weaponId }]} />
          <div className="hq-preview">
            <div className="hq-preview-name">
              {previewSkin.name}
              <Rarity r={previewSkin.rarity} rarities={rarities} />
            </div>
            <p className="muted small">{previewSkin.desc}</p>
            {previewSkin.credit && (
              <p className="credit-line">
                Modèle « {previewSkin.credit.title} » par <a href={previewSkin.credit.url} target="_blank" rel="noreferrer">{previewSkin.credit.author}</a> ({previewSkin.credit.license})
              </p>
            )}
            {action(previewSkin)}
          </div>
        </aside>

        <section className="hq-right">
          <nav className="tabbar">
            {tabs.map((t) => (
              <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={17} /> <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className={`toast ${msg ? msg.type : ''}`}>{msg ? msg.text : ''}</div>
          <div className="tab-scroll">
            {tab === 'admin' ? <Admin currentUser={user} rarities={rarities} onFlash={flash} /> : content}
          </div>
        </section>
      </div>
    </div>
  );
}
