import {
  applyMatchRewards,
  registerRiftUse,
  getOrCreateProfile,
  getDisplayName,
  setLoadout as saveLoadout,
} from './dataManager.js';
import { getTracer, getSkin } from './catalog.js';
import { levelInfo } from './economy.js';
import {
  WEAPONS,
  DEFAULT_LOADOUT,
  REGEN,
  PLAYER_MAX_HP,
  pickSpawn,
  isValidLoadout,
  computeDamage,
} from './weapons.js';

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MATCH_DURATION = 5 * 60 * 1000;
const END_SCREEN_DURATION = 10000;
const GHOST_TIMEOUT = 5000;
export const KILL_TARGETS = [10, 15, 25, 40];
const DEFAULT_TARGET = { ffa: 15, team: 25 };
export const TEAM_NAMES = ['Alpha', 'Bravo'];

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(hostId) {
  return {
    players: new Map(),
    scores: new Map(),
    deaths: new Map(),
    teamKills: [0, 0],
    matchStatus: 'waiting',
    matchStartTime: 0,
    host: hostId,
    mode: 'ffa',
    killTarget: DEFAULT_TARGET.ffa,
  };
}

// Ce que les autres joueurs ont le droit de voir
function lobbyView(p, room) {
  return {
    id: p.id, login: p.login, username: p.username, skin: p.skin, tracer: p.tracer,
    team: p.team, weaponId: p.weaponId, level: p.level, inGame: p.inGame, isHost: room.host === p.id,
  };
}
function gameView(p) {
  return {
    id: p.id, login: p.login, username: p.username, position: p.position, rotation: p.rotation,
    skin: p.skin, team: p.team, weaponId: p.weaponId, hp: p.hp, alive: p.alive,
  };
}
function tracerColor(id) {
  const t = getTracer(id);
  if (!t || t.color === null || t.color === undefined) return null;
  return t.color;
}

export function setupGameServer(io) {
  const roomState = (code) => {
    const room = rooms.get(code);
    if (!room) return null;
    return {
      code, host: room.host, mode: room.mode, killTarget: room.killTarget,
      status: room.matchStatus, teamNames: TEAM_NAMES, targets: KILL_TARGETS,
      players: Array.from(room.players.values()).map((p) => lobbyView(p, room)),
    };
  };
  const broadcastRoom = (code) => {
    const st = roomState(code);
    if (st) io.to(code).emit('room:state', st);
  };

  function broadcastScores(code) {
    const room = rooms.get(code);
    if (!room) return;
    const list = Array.from(room.players.values()).map((p) => ({
      id: p.id, username: p.username, team: p.team,
      kills: room.scores.get(p.id) || 0, deaths: room.deaths.get(p.id) || 0,
    }));
    io.to(code).emit('scores:update', list);
    io.to(code).emit('teams:update', { teamKills: room.teamKills, mode: room.mode, killTarget: room.killTarget });
  }

  // Un match peut-il démarrer ? (2 joueurs en jeu ; en équipes : au moins un par équipe)
  function canStart(room) {
    const inGame = Array.from(room.players.values()).filter((x) => x.inGame);
    if (inGame.length < 2) return false;
    if (room.mode === 'team') return inGame.some((x) => x.team === 0) && inGame.some((x) => x.team === 1);
    return true;
  }

  function startMatch(code) {
    const room = rooms.get(code);
    if (!room) return;
    room.matchStatus = 'playing';
    room.matchStartTime = Date.now();
    room.scores.clear();
    room.deaths.clear();
    room.teamKills = [0, 0];
    const taken = [];
    for (const p of room.players.values()) {
      room.scores.set(p.id, 0);
      room.deaths.set(p.id, 0);
      p.hp = PLAYER_MAX_HP;
      p.alive = true;
      p.lastCombat = 0;
      p.matchHeadshots = 0;
      p.matchJoinedAt = Date.now();
      p.position = pickSpawn(taken, room.mode === 'team' ? p.team : null);
      taken.push(p.position);
      io.to(p.id).emit('player:respawned', { id: p.id, position: p.position });
    }
    const teams = {};
    for (const p of room.players.values()) teams[p.id] = p.team;
    io.to(code).emit('match:started', {
      duration: MATCH_DURATION, killTarget: room.killTarget, mode: room.mode, teams,
    });
    broadcastScores(code);
    broadcastRoom(code);
    console.log(`🎮 Match démarré dans ${code} (${room.mode})`);
  }

  function endMatch(code) {
    const room = rooms.get(code);
    if (!room || room.matchStatus !== 'playing') return;
    room.matchStatus = 'ended';
    const teamMode = room.mode === 'team';

    const list = Array.from(room.players.values())
      .map((p) => ({
        id: p.id, username: p.username, team: p.team,
        kills: room.scores.get(p.id) || 0, deaths: room.deaths.get(p.id) || 0,
      }))
      .sort((a, b) => b.kills - a.kills);

    // Vainqueur : équipe ayant le plus d'éliminations, ou joueur en tête (égalité = pas de vainqueur)
    let winnerTeam = null;
    let winnerId = null;
    if (teamMode) {
      if (room.teamKills[0] !== room.teamKills[1]) winnerTeam = room.teamKills[0] > room.teamKills[1] ? 0 : 1;
    } else if (list.length && (list.length === 1 || list[0].kills > list[1].kills)) {
      winnerId = list[0].id;
    }

    for (const p of room.players.values()) {
      if (!p.inGame) continue;
      const isWinner = teamMode ? p.team === winnerTeam : p.id === winnerId;
      const rewards = applyMatchRewards(p.login, {
        kills: room.scores.get(p.id) || 0,
        deaths: room.deaths.get(p.id) || 0,
        headshots: p.matchHeadshots || 0,
        isWinner,
        teamMode,
        playedMs: Date.now() - Math.max(p.matchJoinedAt || 0, room.matchStartTime),
      });
      p.level = rewards.levelAfter;
      io.to(p.id).emit('match:rewards', {
        xpGain: rewards.xpGain, coinGain: rewards.coinGain, lines: rewards.lines,
        levelBefore: rewards.levelBefore, levelAfter: rewards.levelAfter,
        tierBefore: rewards.tierBefore, tierAfter: rewards.tierAfter,
        isWinner,
      });
    }

    io.to(code).emit('match:ended', {
      results: list, mode: room.mode, winnerTeam, winnerId, teamKills: room.teamKills, teamNames: TEAM_NAMES,
    });
    const who = teamMode
      ? (winnerTeam === null ? '—' : `équipe ${TEAM_NAMES[winnerTeam]}`)
      : (getDisplayName(room.players.get(winnerId)?.login) || '—');
    console.log(`🏆 Match terminé dans ${code} — ${who}`);

    setTimeout(() => {
      if (!rooms.has(code)) return;
      room.matchStatus = 'waiting';
      const taken = [];
      for (const p of room.players.values()) {
        p.hp = PLAYER_MAX_HP;
        p.alive = true;
        p.lastCombat = 0;
        p.position = pickSpawn(taken, teamMode ? p.team : null);
        taken.push(p.position);
      }
      io.to(code).emit('match:reset');
      broadcastRoom(code);
      if (canStart(room)) startMatch(code);
    }, END_SCREEN_DURATION);
  }

  // Fin de match par temps écoulé
  setInterval(() => {
    for (const [code, room] of rooms) {
      if (room.matchStatus === 'playing' && Date.now() - room.matchStartTime >= MATCH_DURATION) endMatch(code);
    }
  }, 1000);

  // 💚 Régénération : après REGEN.delayMs sans tirer ni être touché
  setInterval(() => {
    const now = Date.now();
    const gain = (REGEN.ratePerSec * REGEN.tickMs) / 1000;
    for (const [code, room] of rooms) {
      if (room.matchStatus !== 'playing') continue;
      for (const p of room.players.values()) {
        if (!p.alive || !p.inGame || p.hp >= PLAYER_MAX_HP) continue;
        if (now - (p.lastCombat || 0) < REGEN.delayMs) continue;
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + gain);
        io.to(code).emit('player:hp', { id: p.id, hp: Math.round(p.hp), regen: true });
      }
    }
  }, REGEN.tickMs);

  function removePlayer(code, socketId) {
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socketId);
    room.scores.delete(socketId);
    room.deaths.delete(socketId);
    io.to(code).emit('player:left', { id: socketId });
    if (room.players.size === 0) { rooms.delete(code); return; }
    if (room.host === socketId) room.host = room.players.keys().next().value; // nouvel hôte
    broadcastScores(code);
    broadcastRoom(code);
  }

  // 🧹 Watchdog : supprime les joueurs inactifs (fantômes)
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      for (const [socketId, p] of Array.from(room.players)) {
        if (p.inGame && p.lastSeen && now - p.lastSeen > GHOST_TIMEOUT) {
          console.log(`🧹 Fantôme supprimé : ${p.login} (${socketId})`);
          removePlayer(code, socketId);
        }
      }
    }
  }, 3000);

  // ---------- Identité : le serveur ne croit que la session (cookie) ----------
  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) { socket.disconnect(true); return; }
    let currentRoom = null;

    function refreshFromProfile(p) {
      const prof = getOrCreateProfile(p.login);
      p.username = prof.displayName;
      p.skin = prof.equippedSkin;
      p.tracer = prof.equippedTracer;
      p.level = levelInfo(prof.xp).level;
    }

    function autoTeam(room) {
      const c = [0, 0];
      for (const q of room.players.values()) c[q.team]++;
      return c[0] <= c[1] ? 0 : 1;
    }

    function joinRoom(code, cb) {
      // Déjà dans ce salon (retour d'une partie) : on renvoie simplement l'état
      if (currentRoom === code && rooms.get(code)?.players.has(socket.id)) {
        const r = rooms.get(code);
        cb({
          ok: true, code, state: roomState(code),
          players: Array.from(r.players.values()).map(gameView), matchStatus: r.matchStatus,
        });
        return;
      }
      if (currentRoom) leaveRoom();
      if (!rooms.has(code)) rooms.set(code, createRoom(socket.id));

      // Même compte déjà présent (reconnexion) → on remplace
      for (const [oldId, oldP] of Array.from(rooms.get(code).players)) {
        if (oldP.login === user.username) removePlayer(code, oldId);
      }
      if (!rooms.has(code)) rooms.set(code, createRoom(socket.id));
      const room = rooms.get(code);

      const prof = getOrCreateProfile(user.username);
      const saved = Array.isArray(prof.loadout) && isValidLoadout(prof.loadout) ? prof.loadout : DEFAULT_LOADOUT;
      const playerData = {
        id: socket.id,
        login: user.username,
        username: prof.displayName,
        position: pickSpawn(Array.from(room.players.values()).map((x) => x.position)),
        rotation: { yaw: 0, pitch: 0 },
        hp: PLAYER_MAX_HP,
        alive: true,
        inGame: false,
        skin: prof.equippedSkin,
        tracer: prof.equippedTracer,
        level: levelInfo(prof.xp).level,
        team: autoTeam(room),
        lastSeen: Date.now(),
        lastCombat: 0,
        loadout: [...saved],
        weaponId: saved[0],
        shotTokens: 3, lastTokenAt: Date.now(),
        fireTokens: 3, lastFireAt: Date.now(),
        matchHeadshots: 0, matchJoinedAt: 0,
      };
      if (room.players.size === 0) room.host = socket.id;
      room.players.set(socket.id, playerData);
      room.scores.set(socket.id, 0);
      room.deaths.set(socket.id, 0);
      socket.join(code);
      currentRoom = code;

      cb({
        ok: true, code,
        state: roomState(code),
        players: Array.from(room.players.values()).map(gameView),
        matchStatus: room.matchStatus,
      });
      socket.to(code).emit('player:joined', gameView(playerData));
      broadcastScores(code);
      broadcastRoom(code);
    }

    function leaveRoom() {
      if (!currentRoom) return;
      const code = currentRoom;
      socket.leave(code);
      currentRoom = null;
      removePlayer(code, socket.id);
    }

    const me = () => {
      if (!currentRoom) return {};
      const room = rooms.get(currentRoom);
      return { room, p: room?.players.get(socket.id), code: currentRoom };
    };

    socket.on('room:create', (_d, cb) => {
      if (typeof cb !== 'function') return;
      const code = generateCode();
      rooms.set(code, createRoom(socket.id));
      joinRoom(code, cb);
    });

    socket.on('room:join', ({ code } = {}, cb) => {
      if (typeof cb !== 'function') return;
      const c = String(code || '').toUpperCase();
      if (!rooms.has(c)) return cb({ error: 'Salon introuvable.' });
      joinRoom(c, cb);
    });

    socket.on('room:leave', () => leaveRoom());

    // --- Réglages du salon (hôte uniquement) ---
    socket.on('room:setMode', ({ mode } = {}) => {
      const { room, code } = me();
      if (!room || room.host !== socket.id || room.matchStatus === 'playing') return;
      if (mode !== 'ffa' && mode !== 'team') return;
      room.mode = mode;
      room.killTarget = DEFAULT_TARGET[mode];
      if (mode === 'team') { // répartit équitablement les équipes
        let i = 0;
        for (const q of room.players.values()) q.team = i++ % 2;
      }
      broadcastRoom(code);
    });
    socket.on('room:setTarget', ({ target } = {}) => {
      const { room, code } = me();
      if (!room || room.host !== socket.id || room.matchStatus === 'playing') return;
      if (!KILL_TARGETS.includes(target)) return;
      room.killTarget = target;
      broadcastRoom(code);
    });
    socket.on('room:kick', ({ id } = {}) => {
      const { room, code } = me();
      if (!room || room.host !== socket.id || id === socket.id || !room.players.has(id)) return;
      io.to(id).emit('room:kicked');
      io.sockets.sockets.get(id)?.leave(code);
      removePlayer(code, id);
    });
    socket.on('room:setTeam', ({ team } = {}) => {
      const { room, p, code } = me();
      if (!room || !p || p.inGame || (team !== 0 && team !== 1)) return;
      p.team = team;
      broadcastRoom(code);
    });

    // Le joueur a changé de skin / pseudo / traînée via l'API : on relit son profil
    socket.on('profile:changed', () => {
      const { room, p, code } = me();
      if (!room || !p) return;
      refreshFromProfile(p);
      broadcastRoom(code);
      if (p.inGame) io.to(code).emit('player:look', { id: p.id, skin: p.skin, username: p.username, team: p.team });
    });

    socket.on('match:enter', () => {
      const { room, p, code } = me();
      if (!room || !p) return;
      p.inGame = true;
      p.hp = PLAYER_MAX_HP;
      p.alive = true;
      p.lastCombat = 0;
      p.lastSeen = Date.now();
      p.matchJoinedAt = Date.now();

      const others = Array.from(room.players.values()).filter((x) => x.id !== socket.id);
      socket.emit('match:entered', { players: others.map(gameView), me: gameView(p), mode: room.mode });
      broadcastRoom(code);

      if (room.matchStatus === 'waiting' && canStart(room)) {
        startMatch(code);
      } else if (room.matchStatus === 'playing') {
        const teams = {};
        for (const q of room.players.values()) teams[q.id] = q.team;
        socket.emit('match:started', {
          duration: MATCH_DURATION, killTarget: room.killTarget, mode: room.mode, teams,
          timeLeft: MATCH_DURATION - (Date.now() - room.matchStartTime),
        });
        broadcastScores(code);
      }
    });

    socket.on('match:leave', () => {
      const { p, code } = me();
      if (!p) return;
      p.inGame = false;
      broadcastRoom(code);
    });

    socket.on('player:state', ({ position, rotation }) => {
      const { room, p } = me();
      if (!room || !p || !p.alive) return;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
      p.position = position;
      p.rotation = rotation;
      p.lastSeen = Date.now();
      socket.to(currentRoom).emit('player:state', { id: socket.id, position, rotation });
    });

    // Choix des armes (4 max) — validé côté serveur, mémorisé dans le profil
    socket.on('player:loadout', ({ loadout }) => {
      const { p, code } = me();
      if (!p || !isValidLoadout(loadout)) return;
      p.loadout = loadout;
      if (!loadout.includes(p.weaponId)) p.weaponId = loadout[0];
      saveLoadout(p.login, loadout);
      broadcastRoom(code);
    });

    // Arme en main (visible par les autres joueurs)
    socket.on('player:weapon', ({ weaponId } = {}) => {
      const { p, code } = me();
      if (!p || !p.loadout.includes(weaponId)) return;
      p.weaponId = weaponId;
      socket.to(code).emit('player:weapon', { id: socket.id, weaponId });
    });

    // Chaque tir est diffusé aux autres joueurs (traînée + son), qu'il touche ou non.
    socket.on('player:fire', ({ weaponId, dir } = {}) => {
      const { room, p, code } = me();
      if (!room || room.matchStatus !== 'playing') return;
      const def = WEAPONS[weaponId];
      if (!p || !p.alive || !def || !p.loadout.includes(weaponId)) return;
      if (!Array.isArray(dir) || dir.length !== 3 || !dir.every((n) => Number.isFinite(n))) return;
      const now = Date.now();
      p.fireTokens = Math.min(3, p.fireTokens + ((now - p.lastFireAt) / 1000) * def.fireRate * 1.4);
      p.lastFireAt = now;
      if (p.fireTokens < 1) return;
      p.fireTokens -= 1;
      p.lastCombat = now; // tirer = être au combat (pas de régénération)
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      socket.to(code).emit('player:fired', {
        id: socket.id, weaponId, dir: [dir[0] / l, dir[1] / l, dir[2] / l], tracer: tracerColor(p.tracer),
      });
    });

    // Chat vocal : relais de la signalisation WebRTC entre deux joueurs du salon
    socket.on('voice:signal', ({ to, data } = {}) => {
      const { room } = me();
      if (!room || typeof to !== 'string' || !data || !room.players.has(to)) return;
      io.to(to).emit('voice:signal', { from: socket.id, data });
    });

    // Un message = une pression de gâchette (tous les plombs d'un tir de fusil à pompe).
    // hits : [{ id, n, head }] → n plombs touchés sur la cible, dont head à la tête.
    socket.on('player:shoot', ({ weaponId, hits } = {}) => {
      const { room, p: shooter, code } = me();
      if (!room || room.matchStatus !== 'playing') return;
      if (!shooter || !shooter.alive) return;
      const def = WEAPONS[weaponId];
      if (!def || !shooter.loadout.includes(weaponId)) return;
      if (!Array.isArray(hits) || hits.length === 0 || hits.length > 8) return;

      // Anti-triche léger : limite de cadence (jetons qui se rechargent)
      const now = Date.now();
      const rate = def.fireRate * 1.4;
      shooter.shotTokens = Math.min(3, shooter.shotTokens + ((now - shooter.lastTokenAt) / 1000) * rate);
      shooter.lastTokenAt = now;
      if (shooter.shotTokens < 1) return;
      shooter.shotTokens -= 1;

      let pelletsLeft = def.pellets;
      shooter.lastCombat = now;

      for (const h of hits) {
        if (pelletsLeft <= 0) break;
        const target = room.players.get(h?.id);
        if (!target || !target.alive || target.id === shooter.id) continue;
        if (room.mode === 'team' && target.team === shooter.team) continue; // pas de tir allié

        const dist = Math.hypot(
          target.position.x - shooter.position.x,
          target.position.y - shooter.position.y,
          target.position.z - shooter.position.z
        );
        if (dist > def.range[1] * 1.6 + 8) continue; // trop loin pour cette arme

        const n = Math.max(1, Math.min(pelletsLeft, Math.floor(h.n) || 1));
        pelletsLeft -= n;
        const heads = Math.max(0, Math.min(n, Math.floor(h.head) || 0));
        const damage = computeDamage(def, dist, n, heads);

        target.hp -= damage;
        target.lastCombat = now;
        io.to(code).emit('player:hit', {
          targetId: target.id,
          hp: Math.max(0, Math.round(target.hp)),
          shooterId: shooter.id,
          shooterName: shooter.username,
          damage,
          head: heads > 0,
        });

        if (target.hp <= 0) {
          target.alive = false;
          target.hp = 0;
          room.scores.set(shooter.id, (room.scores.get(shooter.id) || 0) + 1);
          room.deaths.set(target.id, (room.deaths.get(target.id) || 0) + 1);
          if (heads > 0) shooter.matchHeadshots = (shooter.matchHeadshots || 0) + 1;
          if (room.mode === 'team') room.teamKills[shooter.team]++;

          io.to(code).emit('player:died', {
            id: target.id,
            username: target.username,
            killerName: shooter.username,
            killerId: shooter.id,
            killerTeam: shooter.team,
            victimTeam: target.team,
            weaponId,
            head: heads > 0,
          });
          broadcastScores(code);

          const reached = room.mode === 'team'
            ? room.teamKills[shooter.team] >= room.killTarget
            : (room.scores.get(shooter.id) || 0) >= room.killTarget;
          if (reached) { endMatch(code); return; }
        }
      }
    });

    socket.on('player:respawn', () => {
      const { room, p, code } = me();
      if (!room || !p || p.alive) return;
      p.alive = true;
      p.hp = PLAYER_MAX_HP;
      p.lastCombat = 0;
      p.position = pickSpawn(
        Array.from(room.players.values()).filter((o) => o.id !== p.id && o.alive).map((o) => o.position),
        room.mode === 'team' ? p.team : null
      );
      p.lastSeen = Date.now();
      io.to(code).emit('player:respawned', { id: socket.id, position: p.position });
    });

    socket.on('player:rift', () => {
      const { p } = me();
      if (p) registerRiftUse(p.login);
    });

    socket.on('chat:message', ({ text }) => {
      const { p, code } = me();
      if (!p || typeof text !== 'string' || !text.trim() || text.length > 200) return;
      io.to(code).emit('chat:message', { username: p.username, team: p.team, text: text.trim(), time: Date.now() });
    });

    socket.on('disconnect', () => leaveRoom());
  });

  // ---------- Fonctions utilisées par le panneau administrateur ----------
  return {
    getRoomsSnapshot() {
      return Array.from(rooms.entries()).map(([code, room]) => ({
        code, mode: room.mode, status: room.matchStatus, killTarget: room.killTarget,
        players: Array.from(room.players.values()).map((p) => ({
          id: p.id, login: p.login, username: p.username, team: p.team, inGame: p.inGame,
          kills: room.scores.get(p.id) || 0, deaths: room.deaths.get(p.id) || 0,
        })),
      }));
    },
    kickLogin(login) {
      let n = 0;
      for (const [code, room] of Array.from(rooms)) {
        for (const p of Array.from(room.players.values())) {
          if (p.login === login) {
            io.to(p.id).emit('room:kicked');
            io.sockets.sockets.get(p.id)?.leave(code);
            removePlayer(code, p.id);
            n++;
          }
        }
      }
      return n;
    },
    closeRoom(code) {
      const room = rooms.get(code);
      if (!room) return false;
      for (const p of Array.from(room.players.values())) {
        io.to(p.id).emit('room:kicked');
        io.sockets.sockets.get(p.id)?.leave(code);
      }
      rooms.delete(code);
      return true;
    },
    refreshLogin(login) {
      for (const [code, room] of rooms) {
        for (const p of room.players.values()) {
          if (p.login !== login) continue;
          const prof = getOrCreateProfile(login);
          p.username = prof.displayName; p.skin = prof.equippedSkin; p.tracer = prof.equippedTracer;
          p.level = levelInfo(prof.xp).level;
          broadcastRoom(code);
          if (p.inGame) io.to(code).emit('player:look', { id: p.id, skin: p.skin, username: p.username, team: p.team });
        }
      }
    },
    isOnline(login) {
      for (const room of rooms.values()) for (const p of room.players.values()) if (p.login === login) return true;
      return false;
    },
    announce(text) { io.emit('announce', { text, time: Date.now() }); },
    skinKnown: (id) => !!getSkin(id),
  };
}
