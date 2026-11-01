// Sons synthétisés (aucun fichier audio nécessaire) — WebAudio.
let ctx = null;
let master = null;
let noiseBuf = null;
let volMul = 1; // volume appliqué aux sons créés pendant un appel (tirs lointains)

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  // 1 s de bruit blanc réutilisable
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

function noise(dur, { freq = 1800, q = 0.8, gain = 0.8, type = 'bandpass', decay = 1 } = {}) {
  const c = ensure(); if (!c) return;
  const src = c.createBufferSource(); src.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(Math.max(0.0002, gain * volMul), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur * decay);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur);
}
function tone(freq, dur, { type = 'square', gain = 0.3, slide = 0.5 } = {}) {
  const c = ensure(); if (!c) return;
  const o = c.createOscillator(); o.type = type;
  const g = c.createGain();
  const t = c.currentTime;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(Math.max(0.0002, gain * volMul), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

// Chaque type d'arme a sa signature sonore
const SHOTS = {
  Pistolet:        () => { noise(0.12, { freq: 2400, gain: 0.9 }); tone(260, 0.1, { gain: 0.25 }); },
  Revolver:        () => { noise(0.28, { freq: 900, gain: 1.1 }); tone(120, 0.22, { gain: 0.5, type: 'sawtooth' }); },
  SMG:             () => { noise(0.07, { freq: 3000, gain: 0.7 }); tone(300, 0.05, { gain: 0.2 }); },
  Fusil:           () => { noise(0.14, { freq: 1500, gain: 1.0 }); tone(170, 0.12, { gain: 0.35, type: 'sawtooth' }); },
  'Fusil à pompe': () => { noise(0.35, { freq: 700, gain: 1.3, q: 0.5 }); tone(90, 0.3, { gain: 0.6, type: 'sawtooth' }); },
  'Tireur d’élite': () => { noise(0.45, { freq: 1100, gain: 1.2, q: 0.6 }); tone(70, 0.4, { gain: 0.6, type: 'sawtooth' }); noise(0.9, { freq: 400, gain: 0.25, type: 'lowpass' }); },
};
export function playShot(type) {
  (SHOTS[type] || SHOTS.Fusil)();
}
// Tir d'un autre joueur : plus il est loin, plus c'est faible (vol entre 0 et 1)
export function playShotAt(type, vol) {
  if (vol < 0.03) return;
  volMul = vol;
  try { playShot(type); } finally { volMul = 1; }
}
export function playEmpty() { tone(900, 0.05, { gain: 0.15, slide: 0.8 }); }
export function playReload() {
  tone(500, 0.06, { gain: 0.2, slide: 0.6 });
  setTimeout(() => tone(380, 0.08, { gain: 0.2, slide: 0.7 }), 420);
}
export function playHit(head) {
  tone(head ? 1500 : 1000, 0.08, { type: 'sine', gain: 0.35, slide: 0.7 });
}
export function playKill() {
  tone(700, 0.18, { type: 'triangle', gain: 0.4, slide: 2 });
}
export function playHurt() {
  noise(0.18, { freq: 300, gain: 0.7, type: 'lowpass' });
}
export function playSwitch() { noise(0.05, { freq: 2500, gain: 0.25 }); }
