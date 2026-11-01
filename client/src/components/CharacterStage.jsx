import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createCharacter } from '../game/characters.js';

// ============================================================
// Scène 3D réutilisable : un personnage au centre (« hero ») ou une rangée d'opérateurs (« row »).
// slots : [{ key, skin, weaponId, label, sub, team }]
// ============================================================
const TEAM_COLORS = [0xff9d1c, 0x4aa3ff];
const DEFAULT_RING = 0xff9d1c;

function makePlatform(radius, color) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.04, 0.05, 40),
    new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.4 })
  );
  disc.position.y = -0.025;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.98, 0.012, 8, 64),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.003;
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.92, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.004;
  g.add(disc, ring, glow);
  g.userData.parts = [disc, ring, glow];
  return g;
}

export default function CharacterStage({ slots = [], variant = 'hero', interactive = true, className = '' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const labelRefs = useRef(new Map());
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // ----- Création de la scène -----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const hero = variant === 'hero';
    const camera = new THREE.PerspectiveCamera(hero ? 26 : 30, 1, 0.1, 60);

    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1c1f24, 1.0));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(-2.5, 3.5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9d1c, 2.0);   // liseré orange derrière le personnage
    rim.position.set(3, 2.5, -3.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x7aa7ff, 0.7);
    fill.position.set(3, 1, 3);
    scene.add(fill);

    const entries = new Map();
    const state = { dragYaw: 0, dragging: false, lastX: 0, t: 0, w: 1, h: 1 };

    const resize = () => {
      const w = wrap.clientWidth || 400;
      const h = wrap.clientHeight || 400;
      state.w = w; state.h = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const n = Math.max(1, slotsRef.current.length);
      if (hero) {
        camera.position.set(0, 1.05, 5.2);
        camera.lookAt(0, 0.92, 0);
      } else {
        const spacing = 1.35;
        const needW = n * spacing + 0.8;
        const dist = Math.max(4.6, needW / (2 * Math.tan(THREE.MathUtils.degToRad(15)) * camera.aspect) + 0.6);
        camera.position.set(0, 1.25, dist);
        camera.lookAt(0, 0.9, 0);
      }
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // Rotation à la souris (menu principal)
    const down = (e) => { if (!interactive || !hero) return; state.dragging = true; state.lastX = e.clientX; canvas.setPointerCapture?.(e.pointerId); };
    const move = (e) => { if (!state.dragging) return; state.dragYaw += (e.clientX - state.lastX) * 0.012; state.lastX = e.clientX; };
    const up = () => { state.dragging = false; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    let raf;
    let last = performance.now();
    const v = new THREE.Vector3();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      state.t += dt;
      if (!state.dragging && state.dragYaw !== 0) state.dragYaw *= Math.pow(0.35, dt); // revient doucement
      const list = slotsRef.current;
      const n = Math.max(1, list.length);
      list.forEach((s, i) => {
        const e = entries.get(s.key);
        if (!e) return;
        const targetX = hero ? 0 : (i - (n - 1) / 2) * 1.35;
        e.group.position.x += (targetX - e.group.position.x) * Math.min(1, dt * 6);
        if (e.handle) {
          e.handle.update(dt, {});
          const base = hero ? 0.8 + Math.sin(state.t * 0.5) * 0.12 + state.dragYaw : -(targetX * 0.09) + Math.sin(state.t * 0.6 + i) * 0.05;
          e.handle.root.rotation.y += (base - e.handle.root.rotation.y) * Math.min(1, dt * 8);
        }
      });
      renderer.render(scene, camera);

      // Étiquettes HTML placées sous les pieds
      list.forEach((s) => {
        const el = labelRefs.current.get(s.key);
        const e = entries.get(s.key);
        if (!el || !e) return;
        v.set(e.group.position.x, 0, 0).project(camera);
        const px = (v.x * 0.5 + 0.5) * state.w;
        const py = (-v.y * 0.5 + 0.5) * state.h;
        el.style.transform = `translate(${px}px, ${py + 14}px) translateX(-50%)`;
        el.style.opacity = '1';
      });
    };
    raf = requestAnimationFrame(loop);

    ctxRef.current = { scene, entries, hero };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      for (const e of entries.values()) {
        e.handle?.dispose();
        e.platform.userData.parts.forEach((p) => { p.geometry.dispose(); p.material.dispose(); });
      }
      renderer.dispose();
      ctxRef.current = null;
    };
  }, [variant, interactive]);

  // ----- Synchronisation des personnages avec les slots -----
  const signature = slots.map((s) => `${s.key}|${s.skin ? s.skin.id : ''}|${s.weaponId || ''}|${s.team ?? ''}`).join(',');
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return undefined;
    const wanted = new Map(slots.map((s) => [s.key, s]));

    for (const [key, e] of Array.from(ctx.entries)) {
      const w = wanted.get(key);
      if (!w || e.skinId !== (w.skin ? w.skin.id : '')) {
        ctx.scene.remove(e.group);
        e.handle?.dispose();
        e.platform.userData.parts.forEach((p) => { p.geometry.dispose(); p.material.dispose(); });
        ctx.entries.delete(key);
      }
    }

    slots.forEach((s) => {
      const ring = s.team === 0 || s.team === 1 ? TEAM_COLORS[s.team] : DEFAULT_RING;
      let e = ctx.entries.get(s.key);
      if (!e) {
        const group = new THREE.Group();
        const platform = makePlatform(ctx.hero ? 0.95 : 0.62, ring);
        group.add(platform);
        ctx.scene.add(group);
        e = { group, platform, handle: null, skinId: s.skin ? s.skin.id : '', weaponId: s.weaponId, ringColor: ring };
        ctx.entries.set(s.key, e);
        const entry = e;
        createCharacter(s.skin, { weaponId: s.weaponId }).then((handle) => {
          if (ctx.entries.get(s.key) !== entry) { handle.dispose(); return; }
          entry.handle = handle;
          group.add(handle.root);
        });
      } else {
        if (e.weaponId !== s.weaponId) { e.weaponId = s.weaponId; e.handle?.setWeapon(s.weaponId); }
        if (e.ringColor !== ring) {
          e.ringColor = ring;
          e.platform.userData.parts[1].material.color.setHex(ring);
          e.platform.userData.parts[2].material.color.setHex(ring);
        }
      }
    });
    return undefined;
  }, [signature, variant]);

  return (
    <div ref={wrapRef} className={`stage stage-${variant} ${className}`}>
      <canvas ref={canvasRef} className="stage-canvas" />
      {variant === 'row' && slots.map((s) => (
        <div
          key={s.key}
          className={`stage-label ${s.team === 0 ? 'team-a' : s.team === 1 ? 'team-b' : ''}`}
          ref={(el) => { if (el) labelRefs.current.set(s.key, el); else labelRefs.current.delete(s.key); }}
          style={{ opacity: 0 }}
        >
          <b>{s.label}</b>
          {s.sub && <span>{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}
