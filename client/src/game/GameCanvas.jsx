import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createEngine } from './engine.js';
import { buildMap } from './mapBuilder.js';
import { createPlayer } from './player.js';
import { createWeaponSystem } from './weapon.js';
import { createRift } from './rift.js';
import { createRemotePlayersManager } from './remotePlayers.js';
import { getGameConfig, getLoadout, saveLoadout } from './gameConfig.js';
import { CREDITS } from './credits.js';
import { createVoice, voiceVolume } from './voice.js';
import { loadCatalog, tracerById } from './catalogStore.js';
import { getProfile } from '../api.js';
import Icon from '../components/Icon.jsx';
import * as sound from './sound.js';
import Loadout from '../pages/Loadout.jsx';
import { getSocket } from '../socket.js';
import '../styles/game.css';

// Boussole : 24 repères de 15°, répétés 3 fois pour un défilement continu
function Compass({ heading }) {
  const items = [];
  for (let i = 0; i < 72; i++) {
    const deg = (i % 24) * 15;
    let cls = 'c-item';
    let label = '';
    if (deg % 90 === 0) { cls += ' cdn'; label = ['N', 'E', 'S', 'O'][deg / 90]; }
    else if (deg % 45 === 0) { cls += ' inter'; label = { 45: 'NE', 135: 'SE', 225: 'SO', 315: 'NO' }[deg]; }
    else if (deg % 30 === 0) label = String(deg);
    items.push(<div key={i} className={cls}>{label}</div>);
  }
  const x = 210 - ((24 + heading / 15) * 40 + 20);
  return (
    <div className="compass">
      <div className="compass-track" style={{ transform: `translateX(${x}px)` }}>{items}</div>
      <div className="compass-mark" />
      <div className="compass-deg">{String(heading).padStart(3, '0')}°</div>
    </div>
  );
}

// Tableau des scores : par joueur, ou par équipe en mode équipes
function ScoreTable({ rows, mode, myId, teamKills, highlightWinner, teamNames = ['Alpha', 'Bravo'] }) {
  const head = <thead><tr><th>#</th><th>Opérateur</th><th>Éliminations</th><th>Morts</th></tr></thead>;
  const line = (p, i, cls = '') => (
    <tr key={p.id} className={`${p.id === myId ? 'me' : ''} ${cls}`}>
      <td>{i + 1}</td><td>{p.username}</td><td>{p.kills}</td><td>{p.deaths}</td>
    </tr>
  );
  if (mode === 'team') {
    return (
      <div className="team-tables">
        {[0, 1].map((t) => (
          <div key={t} className={`team-table team-${t === 0 ? 'a' : 'b'}`}>
            <div className="team-head"><b>{teamNames[t]}</b><span>{teamKills ? teamKills[t] : 0}</span></div>
            <table>
              {head}
              <tbody>{rows.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills).map((p, i) => line(p, i))}</tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => b.kills - a.kills);
  return (
    <table>
      {head}
      <tbody>{sorted.map((p, i) => line(p, i, highlightWinner && i === 0 ? 'winner' : ''))}</tbody>
    </table>
  );
}

const MODE_TXT = { auto: 'AUTO', semi: 'SEMI', burst: 'RAFALE' };

export default function GameCanvas({ user, roomCode, onExit }) {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [score, setScore] = useState(0);
  const [locked, setLocked] = useState(false);
  const [riftReady, setRiftReady] = useState(true);
  const [myHp, setMyHp] = useState(100);
  const [regenOn, setRegenOn] = useState(false);
  const [hurt, setHurt] = useState(0);
  const [alive, setAlive] = useState(true);
  const [scores, setScores] = useState([]);
  const [killFeed, setKillFeed] = useState([]);
  const [matchStatus, setMatchStatus] = useState('waiting');
  const [matchEnd, setMatchEnd] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [respawnIn, setRespawnIn] = useState(0);
  const [rewards, setRewards] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState('Initialisation…');
  const [weaponHud, setWeaponHud] = useState(null);
  const [scoped, setScoped] = useState(false);
  const [hitMark, setHitMark] = useState(null);
  const [fps, setFps] = useState({ fps: 0, avg: 0 });
  const [showFps, setShowFps] = useState(true);
  const [showArsenal, setShowArsenal] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [lunar, setLunar] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState({ state: 'idle', msg: '' });
  const [talking, setTalking] = useState(false);
  const [heading, setHeading] = useState(0);
  const [killedBy, setKilledBy] = useState(null);
  const [banner, setBanner] = useState(null);
  const [loadPct, setLoadPct] = useState(5);
  const [mode, setMode] = useState('ffa');
  const [myTeam, setMyTeam] = useState(0);
  const [teamKills, setTeamKills] = useState([0, 0]);
  const [killTarget, setKillTarget] = useState(15);

  useEffect(() => {
    const canvas = canvasRef.current;
    const socket = getSocket();
    let cancelled = false;

    const game = {
      renderer: null, scene: null, camera: null, sky: null,
      player: null, weapons: null, rift: null, remotes: null, config: null, voice: null,
      raf: null, sendState: null, timerInt: null, respawnInt: null, hudInt: null, fpsInt: null,
      handlers: {},
    };
    gameRef.current = game;

    // --- Moteur 3D ---
    const { renderer, scene, camera, sky } = createEngine(canvas);
    game.renderer = renderer;
    game.scene = scene;
    game.camera = camera;
    game.sky = sky;

    let hitTimer = null;
    let regenTimer = null;
    const weaponName = (id) => game.config?.weapons.find((w) => w.id === id)?.name || '';

    // --- Listeners socket ---
    const sendLoadout = () => {
      if (!socket.connected || !game.config) return;
      socket.emit('player:loadout', { loadout: getLoadout(game.config) });
    };

    const onPlayerJoined = (p) => {
      if (!game.remotes) return;
      if (p.id === socket.id) return;
      game.remotes.add(p.id, p, p.position, p.rotation);
      game.voice?.connect(p.id);
    };
    const onPlayerLeft = ({ id }) => {
      game.remotes?.remove(id);
      game.voice?.closePeer(id);
    };
    const onPlayerState = ({ id, position, rotation }) => game.remotes?.update(id, position, rotation);

    const onMatchEntered = ({ players, me, mode: m }) => {
      if (!game.remotes) return;
      setMode(m); setMyTeam(me.team);
      game.remotes.setContext({ mode: m, myTeam: me.team });
      game.remotes.clear();
      for (const p of players) {
        if (p.id === socket.id) continue;
        game.remotes.add(p.id, p, p.position, p.rotation);
        game.voice?.connect(p.id);
      }
    };
    const onPlayerWeapon = ({ id, weaponId }) => game.remotes?.setWeapon(id, weaponId);
    const onPlayerLook = ({ id, skin, username, team }) => {
      if (id !== socket.id) game.remotes?.setLook(id, { skin, username, team });
    };
    const onTeamsUpdate = ({ teamKills: tk, mode: m, killTarget: kt }) => { setTeamKills(tk); setMode(m); setKillTarget(kt); };
    const onKicked = () => onExit();

    // Tir d'un autre joueur : traînée + son (plus faible avec la distance)
    const onPlayerFired = ({ id, weaponId, dir, tracer }) => {
      const def = game.config?.weapons.find((w) => w.id === weaponId);
      if (!def || !game.remotes || !game.weapons) return;
      const eye = game.remotes.getEyePosition(id, new THREE.Vector3());
      if (!eye) return;
      game.weapons.remoteShot(eye, dir, def, tracer);
      const dist = eye.distanceTo(camera.position);
      sound.playShotAt(def.type, Math.pow(Math.max(0, 1 - dist / 140), 1.5));
    };

    const onScoresUpdate = (list) => setScores(list);
    const onMatchStarted = ({ duration, timeLeft: tl, mode: m, teams, killTarget: kt }) => {
      if (m) {
        const t = teams && teams[socket.id] !== undefined ? teams[socket.id] : 0;
        setMode(m); setMyTeam(t); setKillTarget(kt); setTeamKills([0, 0]);
        game.remotes?.setContext({ mode: m, myTeam: t });
        game.remotes?.setTeams(teams);
      }
      setMatchStatus('playing');
      setMatchEnd(null);
      setRewards(null);
      setTimeLeft(tl != null ? Math.floor(tl / 1000) : Math.floor(duration / 1000));
      game.weapons?.resetAmmo();
    };
    const onMatchEnded = (data) => { setMatchStatus('ended'); setMatchEnd(data); };
    const onMatchReset = () => { setMatchStatus('waiting'); setMatchEnd(null); setRewards(null); };
    const onMatchRewards = (data) => setRewards(data);

    const onPlayerHit = ({ targetId, hp, damage }) => {
      if (targetId === socket.id) {
        setMyHp(hp);
        setRegenOn(false);
        setHurt((h) => h + 1);
        sound.playHurt();
      } else {
        game.remotes?.setHp(targetId, hp);
      }
      void damage;
    };
    // Régénération envoyée par le serveur
    const onPlayerHp = ({ id, hp }) => {
      if (id === socket.id) {
        setMyHp(hp);
        setRegenOn(true);
        clearTimeout(regenTimer);
        regenTimer = setTimeout(() => setRegenOn(false), 900);
      } else {
        game.remotes?.setHp(id, hp);
      }
    };
    const onPlayerDied = ({ id, username, killerName, killerId, killerTeam, victimTeam, weaponId, head }) => {
      const kid = Date.now() + Math.random();
      setKillFeed((prev) => [
        ...prev.slice(-4),
        { id: kid, killer: killerName, victim: username, kTeam: killerTeam, vTeam: victimTeam, head, weapon: weaponId ? weaponName(weaponId) : '' },
      ]);
      setTimeout(() => setKillFeed((prev) => prev.filter((k) => k.id !== kid)), 5000);
      if (killerId === socket.id && id !== socket.id) {
        sound.playKill();
        setBanner({ id: kid, name: username, head });
        setTimeout(() => setBanner((b) => (b && b.id === kid ? null : b)), 2300);
      }
      if (id === socket.id) {
        setKilledBy({ name: killerName, weapon: weaponId ? weaponName(weaponId) : '', head });
        setAlive(false);
        setRespawnIn(3);
        game.weapons?.triggerUp();
        game.weapons?.setAds(false);
      } else {
        game.remotes?.kill(id);
      }
    };
    const onPlayerRespawned = ({ id, position }) => {
      if (id === socket.id) {
        game.player?.teleport(position.x, position.y, position.z);
        game.weapons?.resetAmmo();
        setAlive(true);
        setMyHp(100);
        setRegenOn(false);
        setRespawnIn(0);
      } else {
        game.remotes?.respawn(id, position);
      }
    };

    const rejoinRoom = () => {
      if (!roomCode) return;
      socket.emit('room:join', { code: roomCode }, (res) => {
        if (res?.error) { console.warn('Reconnexion échouée:', res.error); onExit(); return; }
        sendLoadout();
        socket.emit('match:enter');
      });
    };
    const onConnect = () => rejoinRoom();
    const onDisconnect = (reason) => console.warn('⚠️ Socket déconnecté:', reason);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('player:joined', onPlayerJoined);
    socket.on('player:left', onPlayerLeft);
    socket.on('player:state', onPlayerState);
    socket.on('match:entered', onMatchEntered);
    socket.on('scores:update', onScoresUpdate);
    socket.on('match:started', onMatchStarted);
    socket.on('match:ended', onMatchEnded);
    socket.on('match:reset', onMatchReset);
    socket.on('match:rewards', onMatchRewards);
    socket.on('player:hit', onPlayerHit);
    socket.on('player:hp', onPlayerHp);
    socket.on('player:died', onPlayerDied);
    socket.on('player:respawned', onPlayerRespawned);
    socket.on('player:fired', onPlayerFired);
    socket.on('player:weapon', onPlayerWeapon);
    socket.on('player:look', onPlayerLook);
    socket.on('teams:update', onTeamsUpdate);
    socket.on('room:kicked', onKicked);

    game.handlers = {
      onConnect, onDisconnect, onPlayerJoined, onPlayerLeft, onPlayerState, onMatchEntered,
      onScoresUpdate, onMatchStarted, onMatchEnded, onMatchReset, onMatchRewards,
      onPlayerHit, onPlayerHp, onPlayerDied, onPlayerRespawned, onPlayerFired,
      onPlayerWeapon, onPlayerLook, onTeamsUpdate, onKicked,
    };

    // --- Chargement ---
    (async () => {
      try {
        setLoadProgress('Récupération de la configuration…');
        const config = await getGameConfig();
        game.config = config;
        try { await loadCatalog(); } catch { /* skins par défaut */ }
        if (cancelled) return;

        const { world, pads } = await buildMap(scene, {
          spawns: config.spawns,
          onProgress: (m) => {
            if (cancelled) return;
            setLoadProgress(m);
            const mm = /(\d+)\/(\d+)/.exec(m);
            if (mm) setLoadPct(Math.max(6, Math.round((Number(mm[1]) / Number(mm[2])) * 80)));
            else if (/terrain/i.test(m)) setLoadPct(86);
            else if (/objets/i.test(m)) setLoadPct(92);
          },
        });
        if (cancelled) return;

        setLoadProgress('Préparation du joueur et des armes…');
        const spawn = config.spawns[Math.floor(Math.random() * config.spawns.length)];
        game.player = createPlayer(camera, canvas, world, spawn);
        game.player.setPads(pads);
        game.remotes = createRemotePlayersManager(scene);
        game.rift = createRift(scene, camera, game.player);
        game.weapons = createWeaponSystem({
          scene, camera, player: game.player, world, remotes: game.remotes,
          defs: config.weapons,
          loadout: getLoadout(config),
          onShoot: (data) => { if (socket.connected) socket.emit('player:shoot', data); },
          onFired: (data) => { if (socket.connected) socket.emit('player:fire', data); },
          onScope: (v) => setScoped(v),
          onHitFeedback: ({ head }) => {
            sound.playHit(head);
            setHitMark({ head, id: Math.random() });
            clearTimeout(hitTimer);
            hitTimer = setTimeout(() => setHitMark(null), 180);
          },
          onTargetHit: (s) => setScore(s),
          onWeaponChange: (id) => { if (socket.connected) socket.emit('player:weapon', { weaponId: id }); },
        });
        getProfile().then(({ profile }) => {
          const t = tracerById(profile.equippedTracer);
          game.weapons?.setTracer(t && t.color !== null && t.color !== undefined ? t.color : null);
        }).catch(() => {});
        await game.weapons.ready;
        if (cancelled) return;

        // Chat vocal (le micro demande l'autorisation ; on écoute même sans micro)
        game.voice = createVoice(socket, { onStatus: (state, msg) => setVoiceStatus({ state, msg }) });
        game.voice.start();

        // --- Contrôles ---
        const isLocked = () => document.pointerLockElement === canvas;
        const onMouseDown = (e) => {
          if (!isLocked() || !game.weapons) return;
          if (e.button === 0) game.weapons.triggerDown();
          if (e.button === 2) game.weapons.setAds(true);
        };
        const onMouseUp = (e) => {
          if (!game.weapons) return;
          if (e.button === 0) game.weapons.triggerUp();
          if (e.button === 2) game.weapons.setAds(false);
        };
        const onWheel = (e) => {
          if (!isLocked() || !game.weapons) return;
          game.weapons.cycle(e.deltaY > 0 ? 1 : -1);
        };
        const onContext = (e) => e.preventDefault();
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: true });
        canvas.addEventListener('contextmenu', onContext);

        const onKeyDown = (e) => {
          if (e.code === 'KeyE' && game.rift && isLocked()) {
            const ok = game.rift.use();
            if (ok) {
              if (socket.connected) socket.emit('player:rift');
              setRiftReady(false);
              setTimeout(() => setRiftReady(true), 4000);
            }
          }
          if (isLocked() && game.weapons) {
            if (e.code === 'KeyR') game.weapons.reload();
            const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
            if (m) game.weapons.select(Number(m[1]) - 1);
          }
          if (e.code === 'KeyV' && !e.repeat && game.voice?.hasMic()) {
            game.voice.setTalking(true);
            setTalking(true);
          }
          if (e.code === 'F3') { e.preventDefault(); setShowFps((v) => !v); }
          if (e.code === 'Escape') document.exitPointerLock();
          if (e.code === 'Tab') { e.preventDefault(); setShowScoreboard(true); }
        };
        const onKeyUp = (e) => {
          if (e.code === 'Tab') { e.preventDefault(); setShowScoreboard(false); }
          if (e.code === 'KeyV') { game.voice?.setTalking(false); setTalking(false); }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);

        const onLockChange = () => {
          const l = isLocked();
          setLocked(l);
          if (!l) { game.weapons?.triggerUp(); game.weapons?.setAds(false); }
        };
        document.addEventListener('pointerlockchange', onLockChange);

        const onResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);

        Object.assign(game.handlers, {
          onMouseDown, onMouseUp, onWheel, onContext, onKeyDown, onKeyUp, onLockChange, onResize,
        });

        if (socket.connected) rejoinRoom();

        // Position envoyée à 20 Hz
        game.sendState = setInterval(() => {
          if (!game.player || !socket.connected) return;
          const st = game.player.state;
          socket.emit('player:state', {
            position: { x: st.position.x, y: st.position.y, z: st.position.z },
            rotation: { yaw: st.yaw, pitch: st.pitch },
          });
        }, 50);

        game.timerInt = setInterval(() => setTimeLeft((t) => (t > 0 ? t - 1 : 0)), 1000);
        game.respawnInt = setInterval(() => {
          setRespawnIn((r) => {
            if (r <= 1) {
              if (r === 1 && socket.connected) socket.emit('player:respawn');
              return 0;
            }
            return r - 1;
          });
        }, 1000);

        // HUD des armes (10 Hz suffisent)
        const _eye = new THREE.Vector3();
        game.hudInt = setInterval(() => {
          if (game.weapons) setWeaponHud(game.weapons.getHud());
          if (game.player) {
            setLunar(Math.ceil(game.player.state.lunarT));
            setHeading(Math.round((((-game.player.state.yaw * 180) / Math.PI) % 360 + 360) % 360) % 360);
          }
          // Voix : le volume de chaque joueur dépend de sa distance
          if (game.voice && game.remotes && game.player) {
            for (const id of game.remotes.ids()) {
              if (game.remotes.getEyePosition(id, _eye)) {
                game.voice.setVolume(id, voiceVolume(_eye.distanceTo(camera.position)));
              }
            }
          }
        }, 100);

        // Compteur de FPS : instantané + moyenne sur 10 s
        const samples = [];
        let frames = 0;
        let fpsT = performance.now();
        game.fpsInt = setInterval(() => {
          const t = performance.now();
          const cur = Math.round((frames * 1000) / (t - fpsT));
          frames = 0; fpsT = t;
          samples.push(cur);
          if (samples.length > 20) samples.shift();
          const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
          setFps({ fps: cur, avg });
        }, 500);

        // --- Boucle principale ---
        let last = performance.now();
        function loop() {
          if (cancelled) return;
          const now = performance.now();
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          frames++;

          game.player.update(dt);
          game.weapons.update(dt);
          game.rift.update(dt);
          game.remotes.tick(dt);
          sky.position.copy(camera.position);

          renderer.render(scene, camera);
          game.raf = requestAnimationFrame(loop);
        }
        loop();

        setLoadPct(100);
        setMapLoading(false);
      } catch (e) {
        console.error('❌ Erreur de chargement :', e);
        setLoadProgress(`Erreur : ${e.message || e}. Le serveur est-il lancé ? (voir README)`);
      }
    })();

    // --- Nettoyage ---
    return () => {
      cancelled = true;
      cancelAnimationFrame(game.raf);
      clearInterval(game.sendState);
      clearInterval(game.timerInt);
      clearInterval(game.respawnInt);
      clearInterval(game.hudInt);
      clearInterval(game.fpsInt);
      clearTimeout(hitTimer);
      clearTimeout(regenTimer);

      socket.emit('match:leave');
      const h = game.handlers;
      socket.off('connect', h.onConnect);
      socket.off('disconnect', h.onDisconnect);
      socket.off('player:joined', h.onPlayerJoined);
      socket.off('player:left', h.onPlayerLeft);
      socket.off('player:state', h.onPlayerState);
      socket.off('match:entered', h.onMatchEntered);
      socket.off('scores:update', h.onScoresUpdate);
      socket.off('match:started', h.onMatchStarted);
      socket.off('match:ended', h.onMatchEnded);
      socket.off('match:reset', h.onMatchReset);
      socket.off('match:rewards', h.onMatchRewards);
      socket.off('player:hit', h.onPlayerHit);
      socket.off('player:hp', h.onPlayerHp);
      socket.off('player:died', h.onPlayerDied);
      socket.off('player:respawned', h.onPlayerRespawned);
      socket.off('player:fired', h.onPlayerFired);
      socket.off('player:weapon', h.onPlayerWeapon);
      socket.off('player:look', h.onPlayerLook);
      socket.off('teams:update', h.onTeamsUpdate);
      socket.off('room:kicked', h.onKicked);

      if (h.onMouseDown) document.removeEventListener('mousedown', h.onMouseDown);
      if (h.onMouseUp) document.removeEventListener('mouseup', h.onMouseUp);
      if (h.onWheel) canvas.removeEventListener('wheel', h.onWheel);
      if (h.onContext) canvas.removeEventListener('contextmenu', h.onContext);
      if (h.onKeyDown) document.removeEventListener('keydown', h.onKeyDown);
      if (h.onKeyUp) document.removeEventListener('keyup', h.onKeyUp);
      if (h.onLockChange) document.removeEventListener('pointerlockchange', h.onLockChange);
      if (h.onResize) window.removeEventListener('resize', h.onResize);

      game.voice?.dispose();
      game.weapons?.dispose();
      game.remotes?.clear();
      game.player?.dispose();
      document.exitPointerLock();
      renderer.dispose();
    };
  }, [user.username, roomCode]);

  const enterGame = () => {
    sound.resumeAudio();
    gameRef.current?.voice?.resume();
    canvasRef.current?.requestPointerLock();
  };

  // Le joueur valide un nouvel arsenal pendant la partie
  const applyLoadout = (ids) => {
    const g = gameRef.current;
    saveLoadout(ids);
    g?.weapons?.setLoadout(ids);
    const socket = getSocket();
    if (socket.connected) socket.emit('player:loadout', { loadout: ids });
  };

  const min = Math.floor(timeLeft / 60);
  const sec = String(timeLeft % 60).padStart(2, '0');
  const dead = !alive && matchStatus === 'playing';

  if (mapLoading) {
    return (
      <div className="game-container">
        <canvas ref={canvasRef} className="game-canvas" />
        <div className="full-overlay loading">
          <div className="stamp">Déploiement en cours</div>
          <h2 className="logo">PIXEL<span>RIFT</span></h2>
          <div className="loading-bar"><div className="loading-fill" style={{ width: `${loadPct}%` }} /></div>
          <p>{loadProgress}</p>
        </div>
      </div>
    );
  }

  const gap = weaponHud ? Math.max(5, Math.min(48, 5 + weaponHud.spread * 5)) : 8;
  const hpClass = regenOn ? 'regen' : myHp > 50 ? '' : myHp > 25 ? 'mid' : 'low';
  const ammoClass = !weaponHud ? '' : weaponHud.ammo === 0 ? 'empty' : weaponHud.ammo <= weaponHud.mag * 0.25 ? 'low' : '';

  return (
    <div className="game-container">
      <canvas ref={canvasRef} className={`game-canvas ${dead ? 'dead' : ''}`} />

      <div className="hud">
        {hurt > 0 && <div key={hurt} className="hurt-flash" />}
        {alive && myHp <= 30 && <div className="lowhp" />}
        {lunar > 0 && <div className="lunar-tint" />}
        {scoped && <div className="scope-overlay"><div className="scope-h" /><div className="scope-v" /></div>}

        <Compass heading={heading} />

        <div className="hud-killfeed">
          {killFeed.map((k) => (
            <div key={k.id} className="kill-line">
              <span className={`k ${mode === 'team' ? (k.kTeam === myTeam ? 'ally' : 'enemy') : ''}`}>{k.killer}</span>
              <span className={`ico ${k.head ? 'head' : ''}`}>{k.head ? '◎' : '✖'}</span>
              <span className={`v ${mode === 'team' ? (k.vTeam === myTeam ? 'ally' : 'enemy') : ''}`}>{k.victim}</span>
              {k.weapon && <em>{k.weapon}</em>}
            </div>
          ))}
        </div>

        <div className="hud-topright">
          <div className="hud-box"><span className="lbl">Temps</span><span className="val">{min}:{sec}</span></div>
          {mode === 'team'
            ? (
              <div className="hud-box small team">
                <span className="lbl">Alpha · Bravo / {killTarget}</span>
                <span className="val"><i className="ta">{teamKills[0]}</i> – <i className="tb">{teamKills[1]}</i></span>
              </div>
            )
            : (
              <div className="hud-box small"><span className="lbl">Cibles · Objectif {killTarget}</span><span className="val">{score}</span></div>
            )}
          {showFps && (
            <div className={`hud-fps ${fps.avg && fps.avg < 30 ? 'low' : ''}`}>
              {fps.fps} FPS · MOY {fps.avg}
            </div>
          )}
          {!locked && <button className="hud-exit" onClick={onExit}>Quitter</button>}
        </div>

        {lunar > 0 && <div className="hud-lunar">Gravité lunaire · {lunar}s</div>}

        <div
          className={`crosshair ${weaponHud?.ads ? 'ads' : ''} ${scoped ? 'hidden' : ''}`}
          style={{ '--gap': `${weaponHud?.ads ? Math.max(3, gap * 0.5) : gap}px` }}
        >
          <i className="t" /><i className="b" /><i className="l" /><i className="r" /><b />
        </div>
        {hitMark && (
          <div key={hitMark.id} className={`hitmarker ${hitMark.head ? 'head' : ''}`}>
            <i /><i /><i /><i />
          </div>
        )}
        {banner && (
          <div key={banner.id} className="kill-banner">
            <div className="t">ÉLIMINATION</div>
            <div className="n">{banner.name}{banner.head && <small>TÊTE</small>}</div>
          </div>
        )}

        <div className="hud-bl">
          <div>
            <div className="hp-top">
              <span className="lbl">VITALITÉ</span>
              {regenOn && <span className="regen">RÉGÉNÉRATION</span>}
              <span className="num">{myHp}</span>
            </div>
            <div className="hp-bar"><div className={`hp-fill ${hpClass}`} style={{ width: `${myHp}%` }} /></div>
          </div>
          <div className={`ability ${riftReady ? '' : 'cooling'}`}>
            <span className="keycap">E</span>
            <span className="name">RIFT</span>
            <div className="cool"><i /></div>
            <span className="st">{riftReady ? 'PRÊT' : 'RECHARGE'}</span>
          </div>
          <div className={`hud-voice ${talking ? 'talking' : ''} ${voiceStatus.state}`}>
            {voiceStatus.state === 'ready' && (talking ? 'MICRO ACTIF' : 'MAINTIENS V POUR PARLER')}
            {(voiceStatus.state === 'denied' || voiceStatus.state === 'unavailable') && voiceStatus.msg}
          </div>
        </div>

        {weaponHud && (
          <div className="hud-br">
            <div className="slots">
              {weaponHud.slots.map((sl, i) => (
                <div key={sl.id} className={`slot ${i === weaponHud.index ? 'active' : ''}`}>
                  <b>{i + 1}</b>{sl.name}
                </div>
              ))}
            </div>
            <div className="ammo-panel">
              <div className="wtype">{weaponHud.type}</div>
              <div className="wname">{weaponHud.name}</div>
              <div className="ammo-line">
                <span className={`mag ${ammoClass}`}>{weaponHud.ammo}</span>
                <span className="sep">/</span>
                <span className="res">∞</span>
              </div>
              <div className="firemode">
                <span className="pips">{Array.from({ length: weaponHud.mode === 'burst' ? 3 : 1 }).map((_, k) => <i key={k} />)}</span>
                {MODE_TXT[weaponHud.mode]}
                {weaponHud.ammo === 0 && !weaponHud.reloading && <span style={{ color: 'var(--danger)' }}>· RECHARGE (R)</span>}
              </div>
              {weaponHud.reloading && (
                <div className="reload-wrap">
                  RECHARGEMENT
                  <div className="reload-bar"><i style={{ width: `${weaponHud.reloadPct * 100}%` }} /></div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="hud-hint">
          Clic tirer · Clic droit viser · R recharger · 1-4 armes · C glisser · E rift · V parler · Tab scores
        </div>
      </div>

      {showScoreboard && (
        <div className="full-overlay scoreboard-overlay">
          <div className="score-table-wrap">
            <h3>Classement</h3>
            <ScoreTable rows={scores} mode={mode} myId={socket.id} teamKills={teamKills} />
          </div>
        </div>
      )}

      {dead && (
        <div className="full-overlay death">
          <div className="t">ÉLIMINÉ</div>
          {killedBy && (
            <div className="by">
              par <b>{killedBy.name}</b>
              {killedBy.weapon && <small>{killedBy.weapon}{killedBy.head ? ' · TÊTE' : ''}</small>}
            </div>
          )}
          <div className="re">
            RÉAPPARITION
            <strong>{respawnIn}</strong>
          </div>
        </div>
      )}

      {matchEnd && (
        <div className="full-overlay match-end">
          <div className="big">
            {matchEnd.mode === 'team'
              ? (matchEnd.winnerTeam === null ? 'ÉGALITÉ' : matchEnd.winnerTeam === myTeam ? 'VICTOIRE' : 'DÉFAITE')
              : (matchEnd.winnerId === socket.id ? 'VICTOIRE' : matchEnd.winnerId ? 'FIN DU MATCH' : 'ÉGALITÉ')}
          </div>
          {matchEnd.mode === 'team' && matchEnd.winnerTeam !== null && (
            <p className="match-sub">Équipe {matchEnd.teamNames[matchEnd.winnerTeam]} · {matchEnd.teamKills[0]} – {matchEnd.teamKills[1]}</p>
          )}
          <div className="match-end-cols">
            <div className="score-table-wrap">
              <ScoreTable rows={matchEnd.results} mode={matchEnd.mode} myId={socket.id} teamKills={matchEnd.teamKills} teamNames={matchEnd.teamNames} highlightWinner />
            </div>
            {rewards && (
              <div className="score-table-wrap rewards-box">
                <h3>Récompenses</h3>
                {rewards.lines.map((l, i) => (
                  <div key={i} className="reward-line">
                    <span>{l.label}</span>
                    <span><Icon name="xp" size={14} /> {l.xp} <Icon name="coin" size={14} /> {l.coins}</span>
                  </div>
                ))}
                <div className="reward-total">
                  <span>Total</span>
                  <b><Icon name="xp" size={16} /> +{rewards.xpGain} XP · <Icon name="coin" size={16} /> +{rewards.coinGain}</b>
                </div>
                {rewards.levelAfter > rewards.levelBefore && <p className="levelup"><Icon name="star" size={16} /> Niveau {rewards.levelAfter} atteint !</p>}
                {rewards.tierAfter > rewards.tierBefore && <p className="levelup"><Icon name="ticket" size={16} /> Pass de combat : palier {rewards.tierAfter}</p>}
              </div>
            )}
          </div>
          <p className="muted small">Nouveau match dans quelques secondes…</p>
        </div>
      )}

      {!locked && !matchEnd && alive && !showArsenal && !showCredits && (
        <div className="full-overlay pause" onClick={enterGame}>
          <div className="pause-menu" onClick={(e) => e.stopPropagation()}>
            <h2 className="logo">PIXEL<span>RIFT</span></h2>
            <p className="pause-sub">// EN PAUSE</p>
            <button className="menu-item primary" onClick={enterGame}>Reprendre<small>Clique n'importe où pour jouer</small></button>
            <button className="menu-item" onClick={() => setShowArsenal(true)}>Arsenal<small>Changer mes 4 armes</small></button>
            <button className="menu-item" onClick={() => setShowCredits(true)}>Crédits<small>Modèles 3D</small></button>
            <button className="menu-item dim" onClick={onExit}>Quitter la partie</button>
          </div>
          <div className="controls" onClick={(e) => e.stopPropagation()}>
            <h3>// Commandes</h3>
            <span><span className="kbd">Z Q S D</span></span><span>Se déplacer · <span className="kbd">Shift</span> courir</span>
            <span><span className="kbd">Espace</span></span><span>Sauter</span>
            <span><span className="kbd">C</span></span><span>Glisser (en courant)</span>
            <span><span className="kbd">Clic</span></span><span>Tirer · <span className="kbd">Clic D.</span> viser</span>
            <span><span className="kbd">R</span></span><span>Recharger</span>
            <span><span className="kbd">1-4</span></span><span>Armes (ou molette)</span>
            <span><span className="kbd">E</span></span><span>Rift (téléportation)</span>
            <span><span className="kbd">V</span></span><span>Parler (maintenu)</span>
            <span><span className="kbd">Tab</span></span><span>Classement · <span className="kbd">F3</span> FPS</span>
          </div>
        </div>
      )}

      {showArsenal && (
        <Loadout onClose={() => setShowArsenal(false)} onSave={applyLoadout} />
      )}

      {showCredits && (
        <div className="arsenal-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="arsenal credits-box">
            <div className="arsenal-head"><h2>Crédits des modèles 3D</h2></div>
            <p className="muted small">Modèles publiés sous licence CC-BY, via Poly Pizza (poly.pizza).</p>
            <ul className="credits-list">
              {CREDITS.map((c) => (
                <li key={c.pack}>
                  <strong>{c.pack}</strong>
                  {c.author
                    ? <> par <a href={c.url} target="_blank" rel="noreferrer">{c.author}</a> [{c.license}] via {c.via}</>
                    : <span className="muted"> — auteur et licence à confirmer</span>}
                </li>
              ))}
            </ul>
            <div className="arsenal-foot">
              <button onClick={() => setShowCredits(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
