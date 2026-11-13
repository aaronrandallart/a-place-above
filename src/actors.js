// Bad robots, their shots, cages and the monkey family.
import * as THREE from 'three';
import { TUNE } from './config.js';
import { COL } from './world.js';
import { loadModel, fitted, Rig, gait } from './models.js';

const V = new THREE.Vector3();

// Does the straight line a->b (trail space) pass through any cover?
export function coverBetween(covers, as, ad, bs, bd) {
  const vx = bs - as, vy = bd - ad, len2 = vx * vx + vy * vy || 1;
  for (const c of covers) {
    if (c.low) continue;
    const u = Math.min(Math.max(((c.s - as) * vx + (c.d - ad) * vy) / len2, 0), 1);
    if (Math.hypot(c.s - (as + vx * u), c.d - (ad + vy * u)) < c.r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- bad robots
// How a bad robot holds its rifle (directions in its own space: x = its left, y = up, z = forward):
// upper arm down and a little forward, forearm levelled straight ahead at chest height.
const GUN_ARM = { upper: new THREE.Vector3(-0.12, -0.9, 0.42).normalize(), fore: new THREE.Vector3(0.1, 0.02, 1).normalize() };
export class Enemy {
  constructor(scene, world, def) {
    Object.assign(this, def);                       // s, d, section, kind
    this.hs = this.s; this.hd = this.d; this.world = world;     // home post, where it starts and respawns
    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b2326 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.red).multiplyScalar(4) });
    const g = this.mesh = new THREE.Group();
    const mk = (w, h, dp, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
    mk(0.45, 1.3, 0.5, this.bodyMat, -0.5, 0.65, 0); mk(0.45, 1.3, 0.5, this.bodyMat, 0.5, 0.65, 0);
    mk(1.7, 1.3, 1.1, this.bodyMat, 0, 1.95, 0);
    mk(0.5, 1.1, 0.5, this.bodyMat, -1.1, 1.8, 0.2); mk(0.5, 1.1, 0.5, this.bodyMat, 1.1, 1.8, 0.2);
    mk(0.8, 0.5, 0.7, this.bodyMat, 0, 2.85, 0.1);
    this.eye = mk(0.5, 0.16, 0.1, this.eyeMat, 0, 2.88, 0.48);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: COL.red, transparent: true, opacity: 0.85 }));
    this.glow.position.set(0, 2.2, 0.9); g.add(this.glow);
    this.base = world.toW(this.s, this.d);
    this.walkT = 0;
    scene.add(g);
    loadModel('bad_robot').then((gltf) => {                       // the real bad robot replaces the greybox boxes
      this.rig = new Rig(gltf, 3.6, { ownMaterial: true });       // 20% bigger than first built
      for (const c of g.children) if (c !== this.glow) c.visible = false;
      this.glow.position.set(-0.66, 2.1, 2.9);                    // muzzle flash, at the end of its rifle when levelled
      this.glow.material.color.set(0xffe0a0).multiplyScalar(4); this.glow.material.opacity = 1;
      g.add(this.rig.root);
      // Its own rifle ("Rapi Assault Rifle", see CREDITS.md): level the right arm, set the gun into the hand
      // pointing forward, then fix it to the forearm. The rifle stays raised and levelled the whole time.
      loadModel('rapi_rifle').then((gun) => {
        const r = this.rig; r.point('RightArm', GUN_ARM.upper); r.point('RightForeArm', GUN_ARM.fore); r.apply();
        r.root.updateMatrixWorld(true);
        const m = gun.scene.clone(true); m.rotation.y = Math.PI; m.updateMatrixWorld(true);       // the model's muzzle points -z; turn it forward
        const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
        m.position.sub(ctr);
        const L = 1.7, hold = new THREE.Group(); hold.add(m); hold.scale.setScalar(L / size.z);
        const hand = r.jointPos('RightHand', new THREE.Vector3());
        hold.position.set(hand.x, hand.y + 0.1 * L, hand.z + 0.2 * L);          // pistol grip (behind and below the middle) sits in the hand
        m.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.material = o.material.clone(); o.material.metalness = 0.35; o.material.roughness = 0.6;
          o.material.color.setScalar(40);          // the model's paint is almost pure black; lift it to dark gunmetal so it reads in the forest
        });
        this.glow.position.set(hold.position.x, hold.position.y + 0.04 * L, hold.position.z + L / 2 + 0.2);    // muzzle flash at the barrel's end
        this.muzzle = this.glow.position.clone();
        r.root.add(hold); hold.updateMatrixWorld(true);
        r.byName.get('RightForeArm').bone.attach(hold);
      }).catch(() => {});
    }).catch(() => {});
    this.reset();
  }
  reset() {
    this.s = this.hs; this.d = this.hd; this.world.toW(this.s, this.d, 0, this.base);
    this.meleeT = 0; this.meleeCd = 0; this.meleeHit = false; this.moving = false;
    this.hp = TUNE.enemyHp; this.charge = 0; this.cd = 0.6 + Math.random() * 0.8; this.exploded = false; this.smokeT = 0;
    this.burst = 0; this.burstT = 0; this.muzzleT = 0; this.gaitAmp = 0;
    // Every bad robot stands in plain sight from the start; nothing comes up out of the ground.
    // Ambush robots wait back among the trees and walk in once a cage is opened (or if they are shot).
    this.state = 'idle'; this.waiting = this.kind === 'ambush';
    this.rise = 1; this.fall = 0; this.flash = 0;
    this.eyeMat.color.set(COL.red).multiplyScalar(4);
  }
  get alive() { return this.state === 'idle'; }
  wake() { this.waiting = false; }
  damage(n = 1) {
    if (!this.alive) return false;
    this.hp -= n; this.flash = 1; this.waiting = false; if (n > 1) this.charge = 0;      // a punch staggers it
    if (this.hp <= 0) { this.state = 'out'; this.charge = 0; this.eyeMat.color.set(0x221111); return true; }
    return false;
  }
  // Bad robots only shoot. Once Unit 07 enters its section a bad robot leaves its post, walks in,
  // stops at firing distance and shoots whenever it has a clear line.
  // Returns true on each frame it fires a round.
  update(dt, world, player, covers, engaged, others) {
    let fired = false;
    this.meleeHit = false; this.moving = false;
    if (this.state === 'idle') this.rise = Math.min(1, this.rise + dt * 1.4);
    if (this.state === 'out') this.fall = Math.min(1, this.fall + dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 5);

    if (this.alive && this.rise >= 1 && engaged) {
      let dx = player.s - this.s, dy = player.d - this.d, dist = Math.hypot(dx, dy) || 0.001;
      // advance
      // advance until it has a clear shot from a comfortable distance; it never closes to strike
      const blocked = coverBetween(covers, this.s, this.d, player.s, player.d);
      if (dist > TUNE.enemyHold || (blocked && dist > 4)) {
        const step = TUNE.enemySpeed * dt;
        let ns = this.s + dx / dist * step, nd = this.d + dy / dist * step;
        for (const c of covers) {                                      // walk around trees
          const ox = ns - c.s, oy = nd - c.d, dd = Math.hypot(ox, oy), min = c.r + 0.9;
          if (dd < min && dd > 0.001) { ns = c.s + ox / dd * min; nd = c.d + oy / dd * min; }
        }
        for (const o of others) {                                      // do not stack on each other
          if (o === this || !o.alive || o.rise < 1) continue;
          const ox = ns - o.s, oy = nd - o.d, dd = Math.hypot(ox, oy);
          if (dd < 2.8 && dd > 0.001) { ns = o.s + ox / dd * 2.8; nd = o.d + oy / dd * 2.8; }
        }
        this.s = ns; this.d = Math.min(TUNE.roam + 1, Math.max(-TUNE.roam - 1, nd));     // follows Unit 07 off the trail
        world.toW(this.s, this.d, 0, this.base);
        this.moving = true; this.walkT += dt;
        dx = player.s - this.s; dy = player.d - this.d; dist = Math.hypot(dx, dy) || 0.001;
      }
      // shoot whenever it has a clear line
      const sees = dist < TUNE.enemyRange && !coverBetween(covers, this.s, this.d, player.s, player.d);
      this.sees = sees;
      this.cd = Math.max(0, this.cd - dt);
      if (this.burst > 0) {                                 // mid-burst: one round at a time
        if ((this.burstT -= dt) <= 0) {
          this.burst--; this.burstT = TUNE.enemyBurstGap; fired = true; this.muzzleT = 0.05;
          if (!this.burst) this.cd = TUNE.enemyCd;
        }
      } else if (sees && this.cd <= 0) {
        this.charge += dt / TUNE.charge;                    // it levels its rifle first: that is the warning
        if (this.charge >= 1) { this.charge = 0; this.burst = TUNE.enemyBurst; this.burstT = 0; }
      } else this.charge = Math.max(0, this.charge - dt * 0.6);
    } else { this.charge = Math.max(0, this.charge - dt); this.sees = false; this.meleeT = 0; this.burst = 0; }

    const m = this.mesh, wind = this.meleeT > 0 ? 1 - this.meleeT / TUNE.enemyMeleeWindup : 0;
    const bob = this.moving && !this.rig ? Math.abs(Math.sin(this.walkT * 7)) * 0.14 : 0;
    m.position.set(this.base.x, -3.3 * (1 - this.rise) + bob, this.base.z);
    m.visible = this.rise > 0.01 && !this.exploded && Math.abs(this.s - player.s) < 70;    // far ones are lost in the haze anyway
    if (this.alive) m.rotation.y = world.yaw(this.s, player.s - this.s, player.d - this.d);
    m.rotation.x = -this.fall * 1.45 + (this.alive ? wind * 0.45 : 0);       // leans into the swing
    m.rotation.z = this.moving && this.alive && !this.rig ? Math.sin(this.walkT * 7) * 0.07 : 0;
    const c = this.charge;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.glow.visible = this.muzzleT > 0 && this.alive;                  // muzzle flash only; no charging glow
    this.glow.scale.setScalar(0.7 + Math.random() * 0.6);
    this.bodyMat.emissive.setRGB(c * 0.55 + this.flash + wind * 0.8, c * 0.06 + this.flash + wind * 0.35, c * 0.04 + this.flash);
    if (this.rig && m.visible) {
      const r = this.rig;
      this.gaitAmp += ((this.moving && this.alive ? 1 : 0) - this.gaitAmp) * Math.min(1, dt * 8);
      const ph = this.walkT * 7, wg = gait(r, ph, this.gaitAmp, 0.5), sw = Math.sin(ph) * this.gaitAmp;
      r.turn('Hips', 0, sw * 0.08, wg.side * 0.06);
      r.turn('Spine', 0.12 + wind * 0.15 + 0.04 * wg.impact); r.turn('Spine01', 0.2 + wind * 0.25 + 0.05 * wg.impact); r.turn('Spine02', 0.26 + wind * 0.3 + 0.06 * wg.impact);
      r.root.position.y = -0.12 * this.gaitAmp + 0.11 * wg.rise - 0.1 * wg.impact; r.root.position.x = wg.side * 0.1;
      // right arm: levels its forearm gun as the shot charges, or swings up and over for a strike
      // right arm keeps the rifle up and pointed at Unit 07 the whole time; the left arm swings with the walk
      r.point('RightArm', GUN_ARM.upper); r.point('RightForeArm', GUN_ARM.fore);
      r.turn('LeftArm', -sw * 0.35); r.turn('LeftForeArm', -sw * 0.35 - 0.3);
      r.apply();
      r.glow(this.flash * 0.8 + wind * 0.5, this.flash * 0.6 + wind * 0.2, this.flash * 0.5);
      const soot = 0.4 + 0.6 * Math.max(0, this.hp) / TUNE.enemyHp;        // armour blackens as it takes hits
      for (const mt of r.mats) mt.color.setScalar(soot);
    }
    return fired;
  }
  muzzleY() { return this.muzzle ? this.muzzle.y : 2.6; }
  muzzleOut() { return this.muzzle ? this.muzzle.z : 2.6; }                   // how far in front of it the barrel ends
}

// ---------------------------------------------------------------- shots
// All shots fly in dead straight lines in world space (they do not follow the bends of the trail).
export class Shots {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.list = [];
    this.geo = new THREE.SphereGeometry(1, 10, 8);
    this.bulletGeo = new THREE.BoxGeometry(0.07, 0.07, 1.1);        // slim tracers
    this.matE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a3a).multiplyScalar(3) });
    this.matP = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe08a).multiplyScalar(3) });
  }
  // A bad robot's rifle round, from one world point toward another.
  spawn(x, y, z, tx, ty, tz, speed) {
    const T = (Math.hypot(tx - x, tz - z) || 1) / speed;
    const mesh = new THREE.Mesh(this.bulletGeo, this.matE);
    this.scene.add(mesh);
    const p = { from: 'enemy', x, y, z, vx: (tx - x) / T, vy: (ty - y) / T, vz: (tz - z) / T, life: 2.2, mesh };
    this.place(p);
    this.list.push(p);
  }
  // Rifle round: a visible tracer that leaves the muzzle and flies straight along (dx, dz).
  // It hits the first bad robot or tree it touches. `body` is Unit 07's position: anything standing
  // between the body and the muzzle is hit straight away, so point blank shots still land.
  bullet(body, muzzle, dx, dz, speed, enemies, covers, onHit) {
    const mesh = new THREE.Mesh(this.bulletGeo, this.matP);
    this.scene.add(mesh);
    const p = { from: 'player', x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: dx * speed, vy: 0, vz: dz * speed, life: 0.9, mesh };
    for (let k = 1; k <= 8 && p.hitT === undefined; k++) {
      const px = body.x + (muzzle.x - body.x) * k / 8, pz = body.z + (muzzle.z - body.z) * k / 8;
      const hit = this.touch(px, pz, enemies, covers);
      if (hit) { p.x = px; p.z = pz; p.hitT = 0.06; mesh.scale.set(4, 4, 0.3); onHit(hit); }
    }
    this.place(p);
    this.list.push(p);
  }
  touch(x, z, enemies, covers) {
    for (const e of enemies) if (e.alive && e.rise > 0.5 && Math.hypot(x - e.base.x, z - e.base.z) < 1.4) return e;
    for (const c of covers) if (Math.hypot(x - c.mesh.position.x, z - c.mesh.position.z) < c.r) return c;
    return null;
  }
  place(p) {
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.lookAt(V.set(p.x + p.vx, p.y + p.vy, p.z + p.vz));
  }
  clear() { for (const p of this.list) this.scene.remove(p.mesh); this.list.length = 0; }
  // onHitPlayer(), onHit(thing) are callbacks.
  update(dt, player, covers, enemies, onHitPlayer, onHit) {
    const pp = player.root.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      let dead = false;
      if (p.from === 'enemy') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        dead = p.life <= 0 || p.y <= 0.1;
        for (const c of covers) if (p.y < c.h && Math.hypot(p.x - c.mesh.position.x, p.z - c.mesh.position.z) < c.r) { dead = true; break; }
        const low = player.jumpY + 0.3, top = player.jumpY + 4.9;
        if (!dead && p.y > low && p.y < top && Math.hypot(p.x - pp.x, p.z - pp.z) < 1.25) { dead = true; onHitPlayer(); }
      } else if (p.hitT !== undefined) {
        p.hitT -= dt; dead = p.hitT <= 0;                              // impact flash lingers a moment
      } else {
        let hit = false;
        for (let k = 0; k < 3 && !hit; k++) {                        // sub-steps so fast rounds cannot skip through things
          const h = dt / 3;
          p.x += p.vx * h; p.z += p.vz * h;
          const thing = this.touch(p.x, p.z, enemies, covers);
          if (thing) { hit = true; onHit(thing); }
        }
        if (hit) { p.hitT = 0.06; p.mesh.scale.set(4, 4, 0.3); }
        else dead = p.life <= 0;
      }
      if (dead) { this.scene.remove(p.mesh); this.list.splice(i, 1); continue; }
      this.place(p);
    }
  }
}

// Ammo crate: walk over it to refill the rifle.
export class AmmoCrate {
  constructor(scene, world, def) {
    Object.assign(this, def);
    const g = this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.9), new THREE.MeshLambertMaterial({ color: 0x4f6b3a }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.2, 0.94), new THREE.MeshBasicMaterial({ color: COL.gold }));
    body.castShadow = true;
    g.add(body, band);
    loadModel('ammo_crate').then((gltf) => {                      // swap the stand-in box for the real crate
      const m = fitted(gltf, { length: 1.5 }); m.position.y = -0.42;
      g.remove(body, band); g.add(m);
    }).catch(() => {});
    g.position.copy(world.toW(this.s, this.d, 0.7));
    scene.add(g); this.taken = false;
  }
  reset() { this.taken = false; this.mesh.visible = true; }
  update(dt) { this.mesh.rotation.y += dt * 1.2; this.mesh.position.y = 0.7 + Math.sin(performance.now() * 0.003) * 0.12; }
}

// ---------------------------------------------------------------- the rifle on the trail
// Unit 07's rifle, waiting a short way into the forest: it floats above the trail, turning slowly and
// bobbing, over a soft amber ring of light on the ground. Walking up to it picks it up.
export class RiflePickup {
  constructor(scene, world, s, d) {
    this.s = s; this.d = d; this.taken = false;
    const g = this.mesh = new THREE.Group();
    g.position.copy(world.toW(s, d, 0));
    const ringGeo = new THREE.RingGeometry(1.7, 1.9, 48); ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(2.2), transparent: true, opacity: 0.6, depthWrite: false }));
    this.ring.position.y = 0.08; g.add(this.ring);
    this.spin = new THREE.Group(); g.add(this.spin);
    loadModel('reaper_rifle').then((gltf) => {
      const m = fitted(gltf, { length: 3.4 });
      m.position.y = -m.userData.size.y / 2;                                  // centred on the spin point
      const tilt = new THREE.Group(); tilt.rotation.z = 0.3; tilt.add(m);     // muzzle tipped up
      this.spin.add(tilt);
    }).catch(() => {});
    scene.add(g);
  }
  take() { this.taken = true; this.mesh.visible = false; }
  update(dt) {
    if (this.taken) return;
    const t = performance.now() * 0.001, k = 0.5 + 0.5 * Math.sin(t * 2.2);
    this.spin.rotation.y += dt * 1.1; this.spin.position.y = 2.1 + Math.sin(t * 1.7) * 0.22;
    this.ring.material.opacity = 0.3 + 0.5 * k; this.ring.scale.setScalar(0.92 + 0.12 * k);
  }
}

// ---------------------------------------------------------------- electric fences
// The family is held inside a square electric fence: four posts with live wires strung between them.
// Shutting it off (Triangle / E) kills the wires and lets the monkeys out.
export class Cage {
  constructor(scene, world, def) {
    Object.assign(this, def);                       // s, d, section, count
    const g = this.mesh = new THREE.Group();
    const H = 1.6, TOP = 2.7;                        // half the side length, post height
    const postMat = new THREE.MeshLambertMaterial({ color: 0x3b4044 });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xd9a520 });
    this.wireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fefff).multiplyScalar(1.15), transparent: true, opacity: 1 });
    this.lampMat = new THREE.MeshBasicMaterial({ color: COL.red });
    for (const [x, z] of [[-H, -H], [H, -H], [H, H], [-H, H]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, TOP, 0.28), postMat); post.position.set(x, TOP / 2, z); post.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.4), capMat); cap.position.set(x, TOP - 0.25, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.lampMat); lamp.position.set(x, TOP + 0.12, z);
      g.add(post, cap, lamp);
    }
    this.wires = new THREE.Group();
    for (const y of [0.5, 1.1, 1.7, 2.3]) {
      for (let k = 0; k < 4; k++) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 0.06, 0.06), this.wireMat);
        w.position.set(k === 0 ? 0 : k === 1 ? H : k === 2 ? 0 : -H, y, k === 0 ? -H : k === 1 ? 0 : k === 2 ? H : 0);
        if (k % 2) w.rotation.y = Math.PI / 2;
        this.wires.add(w);
      }
    }
    // a few sparks that jump along the wires
    this.sparks = [];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.wires.add(s); this.sparks.push(s);
    }
    const pad = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 0.3, 0.08, H * 2 + 0.3), new THREE.MeshLambertMaterial({ color: 0x2a2f2c })); pad.position.y = 0.04;
    g.add(this.wires, pad);
    g.position.copy(world.toW(this.s, this.d));
    g.rotation.y = world.yaw(this.s, 1, 0);          // square to the trail
    scene.add(g);
    this.half = H; this.open = false; this.off = 0; this.t = 0;
  }
  reset() { this.open = false; }
  update(dt) {
    this.t += dt;
    this.off += ((this.open ? 1 : 0) - this.off) * Math.min(1, dt * 6);
    const live = 1 - this.off;
    this.wires.visible = live > 0.03;
    this.wireMat.opacity = live * (0.65 + 0.35 * Math.abs(Math.sin(this.t * 31) * Math.sin(this.t * 7.3)));    // electric flicker
    this.lampMat.color.set(this.open ? 0x4dff88 : COL.red);
    if (Math.floor(this.t * 14) !== this.tick) {
      this.tick = Math.floor(this.t * 14);
      for (const s of this.sparks) {
        const side = Math.floor(Math.random() * 4), a = (Math.random() * 2 - 1) * this.half, y = [0.5, 1.1, 1.7, 2.3][Math.floor(Math.random() * 4)];
        s.position.set(side === 0 ? a : side === 1 ? this.half : side === 2 ? a : -this.half, y, side === 0 ? -this.half : side === 1 ? a : side === 2 ? this.half : a);
        s.scale.setScalar(0.5 + Math.random());
      }
    }
  }
}

// ---------------------------------------------------------------- monkeys
// caged -> toBack -> riding -> (loose -> toBack ...) -> toSafe -> safe
export class Monkey {
  constructor(scene, world, cage, idx, safeZone) {
    this.world = world; this.cage = cage; this.section = cage.section; this.idx = idx; this.safeZone = safeZone;
    const fur = new THREE.MeshLambertMaterial({ color: 0x8a5a33 });
    const g = this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 3, 8), fur); body.position.y = 0.36;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd9c39a })); head.position.y = 0.78;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a2a1c })); cap.position.set(0, 0.86, -0.04);
    g.add(body, head, cap); g.scale.setScalar(1.25);
    loadModel('capuchin').then((gltf) => {                        // swap the capsule stand-in for the capuchin
      const m = fitted(gltf, { height: 0.62 });
      g.remove(body, head, cap); g.add(m);
    }).catch(() => {});
    scene.add(g);
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.reset();
  }
  cagePos(out) {
    const a = this.idx * 2.1;
    return out.copy(this.cage.mesh.position).add(V.set(Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.5));
  }
  reset() { this.state = 'caged'; this.t = 0; this.mesh.visible = true; this.mesh.scale.setScalar(1.25); this.cagePos(this.mesh.position); this.ls = 0; this.ld = 0; this.grace = 0; }
  climbOn() { this.state = 'toBack'; this.t = 0; this.from.copy(this.mesh.position); }
  drop(player) {
    this.state = 'loose'; this.grace = 1.2;
    this.ls = Math.max(0.5, player.s - 4 - Math.random() * 2.5);
    this.ld = Math.max(-2.6, Math.min(2.6, player.d + (Math.random() - 0.5) * 3));
    this.from.copy(this.mesh.position); this.world.toW(this.ls, this.ld, 0, this.to); this.t = 0;
  }
  // Jump down and run for the tree line, alternating left and right, then vanish into the jungle.
  goSafe(slot, zone = this.safeZone) {
    this.state = 'toSafe'; this.t = 0; this.from.copy(this.mesh.position);
    const side = slot % 2 ? 1 : -1;
    this.world.toW(zone.s + 1 + (Math.random() - 0.5) * 5, side * (10 + Math.random() * 2), 0, this.to);
    this.runTime = Math.max(0.9, this.from.distanceTo(this.to) / 7.5);
    this.mesh.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
  }
  // riderIndex: position in the riders list, or -1. Returns 'arrived' when it reaches safety.
  update(dt, player, riderIndex) {
    const m = this.mesh, now = performance.now() * 0.001;
    if (this.state === 'toBack') {
      this.t = Math.min(1, this.t + dt / 0.8);
      player.riderPos(Math.max(0, riderIndex), this.to);
      m.position.lerpVectors(this.from, this.to, this.t); m.position.y += Math.sin(this.t * Math.PI) * 1.4;
      if (this.t >= 1) this.state = 'riding';
    } else if (this.state === 'riding') {
      player.riderPos(Math.max(0, riderIndex), m.position);
      m.position.y += Math.sin(now * 9 + this.idx * 2) * 0.03;
      m.rotation.y = player.root.rotation.y;
    } else if (this.state === 'loose') {
      this.grace = Math.max(0, this.grace - dt);
      this.t = Math.min(1, this.t + dt / 0.7);
      m.position.lerpVectors(this.from, this.to, this.t);
      m.position.y += Math.sin(this.t * Math.PI) * 2 + (this.t >= 1 ? Math.abs(Math.sin(now * 7)) * 0.35 : 0);
    } else if (this.state === 'toSafe') {
      this.t = Math.min(1, this.t + dt / this.runTime);
      const t = this.t, drop = Math.min(1, t / 0.18);                       // quick hop down, then a scamper
      m.position.lerpVectors(this.from, this.to, t);
      m.position.y = this.from.y * (1 - drop) + Math.abs(Math.sin(t * this.runTime * 11)) * 0.3 * drop;
      m.scale.setScalar(1.25 * Math.min(1, (1 - t) / 0.2));                 // slips out of sight at the trees
      if (t >= 1) { this.state = 'safe'; m.visible = false; return 'arrived'; }
    }
    return null;
  }
}
