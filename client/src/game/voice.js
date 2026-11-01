// ============================================================
// CHAT VOCAL — WebRTC en maillage (chaque joueur est relié à chaque autre).
// Le serveur ne fait que relayer la signalisation ('voice:signal'). Le son passe en direct
// entre les joueurs. Parler : maintenir V (push-to-talk). Le volume dépend de la distance.
//
// Le micro demande un contexte sécurisé : http://localhost ou une adresse https (tunnel).
// Avec une adresse http://192.168.x.x, on peut entendre mais pas parler.
// ============================================================
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const VOICE_RANGE = { full: 12, max: 90 }; // plein volume jusqu'à 12 m, silence à 90 m

export function voiceVolume(distance) {
  if (distance <= VOICE_RANGE.full) return 1;
  return Math.max(0, 1 - (distance - VOICE_RANGE.full) / (VOICE_RANGE.max - VOICE_RANGE.full));
}

export function createVoice(socket, { onStatus } = {}) {
  let stream = null;
  let track = null;
  let ctx = null;
  const peers = new Map(); // id -> { pc, gain, audio, src, pending, remoteSet }

  const setStatus = (state, msg = '') => { if (onStatus) onStatus(state, msg); };
  const signal = (to, data) => socket.emit('voice:signal', { to, data });

  function audioCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('unavailable', 'Micro indisponible (il faut https ou localhost) — tu peux quand même écouter');
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      track = stream.getAudioTracks()[0];
      track.enabled = false; // muet tant qu'on n'appuie pas sur V
      setStatus('ready');
      return true;
    } catch (e) {
      setStatus('denied', 'Micro refusé — tu peux quand même écouter');
      return false;
    }
  }

  function attach(peer, remoteStream) {
    const c = audioCtx();
    // Chrome : le flux distant doit être branché à un <audio> pour être lu par WebAudio
    const el = new Audio();
    el.srcObject = remoteStream;
    el.muted = true;
    el.play?.().catch(() => {});
    peer.audio = el;
    if (!c) return;
    const src = c.createMediaStreamSource(remoteStream);
    const gain = c.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(c.destination);
    peer.src = src;
    peer.gain = gain;
  }

  function createPeer(id) {
    const pc = new RTCPeerConnection(ICE);
    const peer = { pc, gain: null, audio: null, src: null, pending: [], remoteSet: false };
    if (track) pc.addTrack(track, stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { candidate: e.candidate }); };
    pc.ontrack = (e) => attach(peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(id);
    };
    peers.set(id, peer);
    return peer;
  }

  async function makeOffer(id, peer) {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      signal(id, { sdp: peer.pc.localDescription });
    } catch (e) { console.warn('voice offer', e); }
  }

  // Appelé quand un joueur est présent : le plus petit identifiant lance l'appel
  function connect(id) {
    if (!id || id === socket.id || peers.has(id)) return;
    const peer = createPeer(id);
    if (socket.id < id) makeOffer(id, peer);
  }

  async function onSignal({ from, data }) {
    if (!from || !data) return;
    const peer = peers.get(from) || createPeer(from);
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        peer.remoteSet = true;
        for (const c of peer.pending) await pc.addIceCandidate(c).catch(() => {});
        peer.pending = [];
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(from, { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        if (peer.remoteSet) await pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (e) { console.warn('voice signal', e); }
  }
  socket.on('voice:signal', onSignal);

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { p.src?.disconnect(); p.gain?.disconnect(); } catch { /* déjà déconnecté */ }
    if (p.audio) p.audio.srcObject = null;
    try { p.pc.close(); } catch { /* déjà fermé */ }
  }

  function setTalking(on) {
    if (track) track.enabled = !!on;
  }
  function setVolume(id, v) {
    const p = peers.get(id);
    if (p && p.gain) p.gain.gain.value = v;
  }
  function resume() {
    const c = audioCtx();
    if (c && c.state === 'suspended') c.resume();
  }
  function hasMic() { return !!track; }

  function dispose() {
    socket.off('voice:signal', onSignal);
    for (const id of Array.from(peers.keys())) closePeer(id);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    ctx = null; stream = null; track = null;
  }

  return { start, connect, closePeer, setTalking, setVolume, resume, hasMic, dispose };
}
