import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import CharacterStage from '../components/CharacterStage.jsx';
import { getSocket } from '../socket.js';
import { getProfile } from '../api.js';
import { loadCatalog, skinById } from '../game/catalogStore.js';
import { getGameConfig, getLoadout } from '../game/gameConfig.js';

const TEAM = [
  { name: 'Alpha', cls: 'team-a' },
  { name: 'Bravo', cls: 'team-b' },
];

export default function Lobby({ user, roomCode: initialRoom, onPlay, onRoomChange, onProfile, onArsenal, onLogout }) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [profile, setProfile] = useState(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [weaponId, setWeaponId] = useState('assault');
  const [announce, setAnnounce] = useState('');
  const chatEnd = useRef(null);
  const cfgRef = useRef(null);

  const socket = getSocket();

  // ----- Données du joueur et catalogue (skins) -----
  useEffect(() => {
    let alive = true;
    Promise.all([getProfile(), loadCatalog(), getGameConfig()])
      .then(([p, c, cfg]) => {
        if (!alive) return;
        setProfile(p.profile);
        setCatalogReady(true);
        cfgRef.current = cfg;
        setWeaponId(getLoadout(cfg)[0]);
        setAnnounce(c.event.announcement || '');
      })
      .catch((e) => setError(e.message));
    return () => { alive = false; };
  }, []);

  // ----- Événements du salon -----
  useEffect(() => {
    const onState = (st) => { setRoom(st); onRoomChange && onRoomChange(st.code); };
    const onChat = (m) => setMessages((prev) => [...prev.slice(-80), m]);
    const onKicked = () => {
      setRoom(null); setMessages([]); onRoomChange && onRoomChange(null);
      setError('Tu as été retiré du salon.');
    };
    socket.on('room:state', onState);
    socket.on('chat:message', onChat);
    socket.on('room:kicked', onKicked);
    const onConnErr = (e) => { if (e && e.message === 'unauthorized') setError('Session expirée : reconnecte-toi.'); };
    socket.on('connect_error', onConnErr);

    // Retour de partie : on rejoint à nouveau le salon d'avant
    if (initialRoom) {
      socket.emit('room:join', { code: initialRoom }, (res) => {
        if (res && res.ok) setRoom(res.state);
        else onRoomChange && onRoomChange(null);
      });
    }
    return () => {
      socket.off('room:state', onState);
      socket.off('chat:message', onChat);
      socket.off('room:kicked', onKicked);
      socket.off('connect_error', onConnErr);
    };
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Les autres joueurs voient ton arme dans le salon : on envoie ton arsenal dès qu'on est dans un salon
  const roomCodeNow = room ? room.code : null;
  useEffect(() => {
    if (roomCodeNow && cfgRef.current) socket.emit('player:loadout', { loadout: getLoadout(cfgRef.current) });
  }, [roomCodeNow, catalogReady]);

  function createRoom() {
    setError(''); setConnecting(true);
    socket.emit('room:create', {}, (res) => {
      setConnecting(false);
      if (res.error) return setError(res.error);
      setRoom(res.state); setMessages([]);
      onRoomChange && onRoomChange(res.code);
    });
  }
  function joinRoom() {
    setError(''); setConnecting(true);
    socket.emit('room:join', { code: joinCode }, (res) => {
      setConnecting(false);
      if (res.error) return setError(res.error);
      setRoom(res.state); setMessages([]);
      onRoomChange && onRoomChange(res.code);
    });
  }
  function leaveRoom() {
    socket.emit('room:leave');
    setRoom(null); setMessages([]);
    onRoomChange && onRoomChange(null);
  }
  function sendMessage(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('chat:message', { text: chatInput });
    setChatInput('');
  }

  const me = room ? room.players.find((p) => p.id === socket.id) : null;
  const isHost = !!room && room.host === socket.id;
  const teamMode = !!room && room.mode === 'team';

  // ----- Skin du joueur au centre du menu -----
  const mySkin = profile && catalogReady ? skinById(profile.equippedSkin) : null;

  // ----- Rangée d'opérateurs du salon -----
  const squad = useMemo(() => {
    if (!room || !catalogReady) return [];
    const list = [...room.players];
    if (teamMode) list.sort((a, b) => a.team - b.team || a.username.localeCompare(b.username));
    return list.map((p) => ({
      key: p.id,
      skin: skinById(p.skin),
      weaponId: p.weaponId,
      team: teamMode ? p.team : null,
      label: p.username + (p.id === socket.id ? ' (toi)' : ''),
      sub: `Niv. ${p.level}${p.isHost ? ' · hôte' : ''}`,
    }));
  }, [room, catalogReady, teamMode]);

  const teamCounts = room ? [0, 1].map((t) => room.players.filter((p) => p.team === t).length) : [0, 0];
  const canTeamStart = !teamMode || (teamCounts[0] > 0 && teamCounts[1] > 0);

  // =====================================================================
  //  MENU PRINCIPAL
  // =====================================================================
  if (!room) {
    return (
      <div className="screen menu-screen">
        <div className="watermark">RIFT</div>

        <div className="menu-hero">
          {mySkin && <CharacterStage variant="hero" slots={[{ key: 'me', skin: mySkin, weaponId }]} />}
        </div>

        <header className="menu-top">
          <h1 className="logo">PIXEL<span>RIFT</span></h1>
          <div className="operator">
            Opérateur
            <b>{user.displayName || user.username}</b>
            {user.role === 'admin' ? 'Commandement' : 'Soldat'}{profile ? ` · Niv. ${profile.level}` : ''}
          </div>
        </header>

        {announce && (
          <div className="announce-bar"><Icon name="megaphone" size={16} /> {announce}</div>
        )}

        <main className="menu-main">
          <nav className="menu-list">
            <button className="menu-item primary" onClick={createRoom} disabled={connecting}>
              Créer un salon
              <small>Solo ou en équipes avec tes amis</small>
            </button>
            <div className="menu-join">
              <input
                type="text" placeholder="CODE" value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={4} className="code-input"
              />
              <button className="secondary" onClick={joinRoom} disabled={connecting || joinCode.length < 4}>Rejoindre</button>
            </div>
            {error && <p className="error">{error}</p>}

            <button className="menu-item" onClick={onArsenal}>
              Arsenal
              <small>Choisis tes 4 armes</small>
            </button>
            <button className="menu-item" onClick={onProfile}>
              Quartier général
              <small>Skins · Boutique · Pass · Quêtes · Compte{user.role === 'admin' ? ' · Admin' : ''}</small>
            </button>
            <button className="menu-item dim" onClick={onLogout}>Déconnexion</button>
          </nav>

          <aside className="brief">
            <h3>// Briefing</h3>
            <p>
              Infiltre la zone, élimine les opérateurs adverses et utilise le <strong>Rift</strong> pour
              disparaître. Joue en solo ou formez deux équipes.
            </p>
            <div className="keys">
              <span><span className="kbd">Clic</span></span><span>Tirer · <span className="kbd">Clic D.</span> viser</span>
              <span><span className="kbd">C</span></span><span>Glisser en courant</span>
              <span><span className="kbd">E</span></span><span>Rift (téléportation)</span>
              <span><span className="kbd">V</span></span><span>Parler (chat vocal)</span>
            </div>
          </aside>
        </main>

        <footer className="menu-foot">
          <span>PixelRift // Opération Rift</span>
          <span>Glisse la souris sur ton personnage pour le faire tourner</span>
        </footer>
      </div>
    );
  }

  // =====================================================================
  //  SALON
  // =====================================================================
  return (
    <div className="screen room-screen">
      <div className="watermark">RIFT</div>

      <header className="room-top">
        <div>
          <div className="stamp">Salle de préparation</div>
          <div className="room-code">{room.code}</div>
          <p className="muted small">{teamMode ? 'Équipes · Alpha contre Bravo' : 'Chacun pour soi'} · premier à {room.killTarget} éliminations{teamMode ? ' (par équipe)' : ''}</p>
        </div>
        <button className="secondary small-btn" onClick={leaveRoom}><Icon name="logout" size={16} /> Quitter le salon</button>
      </header>

      <div className="room-stage-wrap">
        {catalogReady && <CharacterStage variant="row" slots={squad} />}
        {teamMode && (
          <div className="team-banners">
            <span className="team-a">Alpha · {teamCounts[0]}</span>
            <span className="team-b">Bravo · {teamCounts[1]}</span>
          </div>
        )}
      </div>

      <div className="room-panels">
        <div className="card panel-card">
          <div className="stamp" style={{ color: 'var(--accent)' }}>Réglages</div>
          {isHost ? (
            <>
              <div className="seg">
                <button className={!teamMode ? 'on' : ''} onClick={() => socket.emit('room:setMode', { mode: 'ffa' })}><Icon name="user" size={16} /> Solo</button>
                <button className={teamMode ? 'on' : ''} onClick={() => socket.emit('room:setMode', { mode: 'team' })}><Icon name="users" size={16} /> Équipes</button>
              </div>
              <div className="chips">
                {room.targets.map((t) => (
                  <button key={t} className={`chip ${room.killTarget === t ? 'on' : ''}`} onClick={() => socket.emit('room:setTarget', { target: t })}>{t} kills</button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">Seul l'hôte ({room.players.find((p) => p.id === room.host)?.username}) change les réglages.</p>
          )}

          {teamMode && me && (
            <>
              <p className="muted small">Ton équipe</p>
              <div className="seg">
                {TEAM.map((t, i) => (
                  <button key={t.name} className={`${t.cls} ${me.team === i ? 'on' : ''}`} onClick={() => socket.emit('room:setTeam', { team: i })}>{t.name}</button>
                ))}
              </div>
            </>
          )}

          {!canTeamStart && <p className="warn">Il faut au moins un joueur dans chaque équipe pour lancer le match.</p>}
          <button className="play-button" onClick={() => onPlay(room.code)}>Déployer</button>
        </div>

        <div className="card panel-card">
          <div className="stamp" style={{ color: 'var(--accent)' }}>Escouade ({room.players.length})</div>
          <div className="players-list tall">
            {room.players.map((p) => (
              <div key={p.id} className={`player-row ${teamMode ? TEAM[p.team].cls : ''}`}>
                <span className="status-dot" />
                <span>{p.username}</span>
                {p.id === socket.id && <span className="you">(toi)</span>}
                {p.isHost && <span className="badge">HÔTE</span>}
                {isHost && p.id !== socket.id && (
                  <button className="mini danger" title="Expulser" onClick={() => socket.emit('room:kick', { id: p.id })}><Icon name="close" size={12} /></button>
                )}
              </div>
            ))}
          </div>

        </div>

        <div className="card panel-card">
          <div className="stamp" style={{ color: 'var(--accent)' }}>Communications</div>
          <div className="chat-box">
            <div className="chat-messages">
              {messages.length === 0 && <p className="muted small">Aucun message…</p>}
              {messages.map((m, i) => (
                <div key={i} className="chat-line">
                  <span className={`chat-user ${teamMode && m.team !== undefined ? TEAM[m.team].cls : ''}`}>{m.username}</span>
                  <span className="chat-text">{m.text}</span>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form onSubmit={sendMessage} className="chat-form">
              <input
                type="text" placeholder="Transmettre un message…"
                value={chatInput} onChange={(e) => setChatInput(e.target.value)} maxLength={200}
              />
              <button type="submit"><Icon name="play" size={16} /></button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
