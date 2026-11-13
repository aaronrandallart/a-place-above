// Combat effects: bullet sparks, damage smoke, explosions with flying wreckage, and scorch marks.
// Everything is drawn from small pools of reusable sprites and boxes, so effects never allocate mid-fight.
import * as THREE from 'three';

// A round blob: `core` is how far out from the middle it stays solid before fading to nothing at the rim.
function softDot(core = 0.45, coreAlpha = 0.55) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(core, `rgba(255,255,255,${coreAlpha})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Fx {
  constructor(scene) {
    this.scene = scene; this.live = [];
    const map = softDot(), puff = softDot(0.62, 0.9);                  // smoke uses a fuller blob so it reads as a cloud
    const pool = (n, additive) => Array.from({ length: n }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: additive ? map : puff, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      s.visible = false; s.renderOrder = additive ? 6 : 4;       // fire and sparks always draw over smoke
      scene.add(s); return s;
    });
    this.glow = pool(150, true);        // sparks, fire, flashes
    this.smokes = pool(140, false);     // smoke
    const chunkGeo = new THREE.BoxGeometry(1, 1, 1), chunkMat = new THREE.MeshLambertMaterial({ color: 0x1c1d1f });
    this.chunks = Array.from({ length: 48 }, () => { const m = new THREE.Mesh(chunkGeo, chunkMat); m.visible = false; m.castShadow = true; scene.add(m); return m; });
    const scorchMat = new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false });
    const scorchGeo = new THREE.PlaneGeometry(1, 1); scorchGeo.rotateX(-Math.PI / 2);
    this.scorches = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(scorchGeo, scorchMat); m.visible = false; m.renderOrder = 2; scene.add(m); return m; });
    this.nextScorch = 0;
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
  }

  // One particle. color0 -> color1 and size0 -> size1 over its life; alpha fades out (and in, for smoke).
  spawn(pool, o) {
    const s = pool.find((p) => !p.visible); if (!s) return;
    s.visible = true; s.position.set(o.x, o.y, o.z);
    this.live.push({ s, t: 0, life: o.life, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g || 0, drag: o.drag || 0,
      s0: o.s0, s1: o.s1, c0: o.c0, c1: o.c1 === undefined ? o.c0 : o.c1, a: o.a === undefined ? 1 : o.a, fadeIn: o.fadeIn || 0, k: o.k || 1 });
  }

  // Small burst where a round strikes metal.
  sparks(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, v = 3 + Math.random() * 7;
      this.spawn(this.glow, { x, y, z, vx: Math.cos(a) * v, vy: 1 + Math.random() * 5, vz: Math.sin(a) * v, g: 14, life: 0.18 + Math.random() * 0.22,
        s0: 0.22, s1: 0.05, c0: 0xffd27a, c1: 0xff5a10, k: 4 });
    }
    this.spawn(this.glow, { x, y, z, life: 0.07, s0: 0.9, s1: 0.2, c0: 0xfff0c0, k: 3 });
  }

  // One puff of smoke from a damaged robot. heavy = thick black with a lick of flame.
  smoke(x, y, z, heavy) {
    this.spawn(this.smokes, { x: x + (Math.random() - 0.5) * 0.7, y, z: z + (Math.random() - 0.5) * 0.7, vx: (Math.random() - 0.5) * 0.5, vy: 0.6 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.5,
      life: 1.4 + Math.random() * 0.8, s0: 0.8, s1: heavy ? 4.2 : 2.8, c0: heavy ? 0x2e2e2e : 0x9a9a94, c1: heavy ? 0x808080 : 0xd2d2ca, a: heavy ? 0.9 : 0.6, fadeIn: 0.1 });
    if (heavy && Math.random() < 0.5) this.spawn(this.glow, { x: x + (Math.random() - 0.5) * 0.5, y: y - 0.2, z: z + (Math.random() - 0.5) * 0.5, vy: 1.5 + Math.random(), life: 0.3 + Math.random() * 0.2,
      s0: 0.7, s1: 0.15, c0: 0xffa030, c1: 0xff3000, k: 3 });
  }

  // A light wisp from the rifle's muzzle.
  wisp(x, y, z) {
    this.spawn(this.smokes, { x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4, life: 0.7, s0: 0.25, s1: 1.1, c0: 0xb8b8b0, a: 0.22, fadeIn: 0.05 });
  }

  // A bad robot blows apart: flash, fireball, black smoke, sparks, tumbling wreckage and a scorch on the ground.
  explosion(x, y, z) {
    this.spawn(this.glow, { x, y, z, life: 0.18, s0: 5, s1: 14, c0: 0xfff2c8, k: 6 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, v = 1 + Math.random() * 4.5, up = Math.random();
      this.spawn(this.glow, { x, y: y + Math.random() * 0.8, z, vx: Math.cos(a) * v, vy: 0.5 + up * 2.5, vz: Math.sin(a) * v, drag: 2.2, life: 0.45 + Math.random() * 0.45,
        s0: 2 + Math.random() * 1.4, s1: 4.6 + Math.random() * 2, c0: 0xffc060, c1: 0xb02000, k: 3.5 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, v = 0.6 + Math.random() * 2.4;
      this.spawn(this.smokes, { x, y: y + Math.random(), z, vx: Math.cos(a) * v, vy: 0.4 + Math.random() * 1.1, vz: Math.sin(a) * v, drag: 0.9, life: 2.2 + Math.random() * 1.6,
        s0: 1.2, s1: 6 + Math.random() * 3, c0: 0x333333, c1: 0xa0a09a, a: 0.9, fadeIn: 0.3 });        // the smoke swells in as the fire dies
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28, v = 6 + Math.random() * 12;
      this.spawn(this.glow, { x, y, z, vx: Math.cos(a) * v, vy: 3 + Math.random() * 9, vz: Math.sin(a) * v, g: 16, life: 0.4 + Math.random() * 0.6, s0: 0.28, s1: 0.06, c0: 0xffe090, c1: 0xff5000, k: 4 });
    }
    for (let i = 0; i < 14; i++) {
      const m = this.chunks.find((c) => !c.visible); if (!m) break;
      const a = Math.random() * 6.28, v = 3 + Math.random() * 8;
      m.visible = true; m.position.set(x, y + Math.random(), z); m.scale.set(0.2 + Math.random() * 0.6, 0.15 + Math.random() * 0.4, 0.2 + Math.random() * 0.7);
      this.live.push({ chunk: m, t: 0, life: 2.6 + Math.random() * 1.5, vx: Math.cos(a) * v, vy: 4 + Math.random() * 8, vz: Math.sin(a) * v, g: 20,
        rx: (Math.random() - 0.5) * 14, rz: (Math.random() - 0.5) * 14, smokeT: 0 });
    }
    const sc = this.scorches[this.nextScorch++ % this.scorches.length];
    sc.visible = true; sc.position.set(x, 0.06, z); sc.scale.setScalar(6 + Math.random() * 2); sc.rotation.y = Math.random() * 6.28;
  }

  clear() {
    for (const p of this.live) { if (p.s) p.s.visible = false; if (p.chunk) p.chunk.visible = false; }
    this.live.length = 0;
    for (const s of this.scorches) s.visible = false;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]; p.t += dt;
      const f = p.t / p.life, o = p.s || p.chunk;
      if (f >= 1) { o.visible = false; this.live.splice(i, 1); continue; }
      const damp = Math.exp(-(p.drag || 0) * dt);
      p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.g * dt;
      o.position.x += p.vx * dt; o.position.y += p.vy * dt; o.position.z += p.vz * dt;
      if (p.chunk) {
        if (o.position.y < 0.15) { o.position.y = 0.15; p.vy *= -0.35; p.vx *= 0.55; p.vz *= 0.55; p.rx *= 0.5; p.rz *= 0.5; }
        o.rotation.x += p.rx * dt; o.rotation.z += p.rz * dt;
        if (f > 0.85) o.scale.multiplyScalar(Math.max(0, 1 - dt * 5));
        p.smokeT -= dt;                                               // wreckage trails smoke for a moment
        if (p.t < 1.2 && p.smokeT <= 0) { p.smokeT = 0.09; this.spawn(this.smokes, { x: o.position.x, y: o.position.y, z: o.position.z, vy: 0.6, life: 0.8, s0: 0.35, s1: 1.4, c0: 0x8a8a84, a: 0.55, fadeIn: 0.05 }); }
        continue;
      }
      if (o.position.y < 0.05) { o.position.y = 0.05; p.vy = 0; }
      o.scale.setScalar(p.s0 + (p.s1 - p.s0) * f);
      this._c.set(p.c0).lerp(this._c2.set(p.c1), f).multiplyScalar(p.k);
      o.material.color.copy(this._c);
      o.material.opacity = p.a * (p.fadeIn && f < p.fadeIn ? f / p.fadeIn : 1 - Math.max(0, (f - 0.35) / 0.65));
    }
  }
}
