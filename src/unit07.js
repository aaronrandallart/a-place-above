// Unit 07: greybox body, heavy procedural walk, boost, quick boost, jump, rifle and punch.
import * as THREE from 'three';
import { TUNE } from './config.js';
import { COL } from './world.js';
import { loadModel, Rig, gait } from './models.js';

const HIP = 2.3, STRIDE = 1.5;
// How the rifle is carried: in the right hand only, at Unit 07's right side, pointing forward.
// Offsets are from the hips (x: + is Unit 07's left, z: forward), angles in radians.
// yaw toes the barrel in slightly so shots cross the line Unit 07 is facing about 14 m out; turn is how far
// the body stands off its aim (0 = square on).
const HOLD = { x: -1.05, y: 0.95, z: 1.0, yaw: 0.08, pitch: 0.05, turn: 0 };
// Where the hands close on the rifle, in the gun's own space (y runs along the barrel, muzzle at -2.7; z is up).
const GRIP = new THREE.Vector3(0, -0.3, -0.12);                        // the point on the rifle, at the top of its pistol grip, that sits in the palm
// The right arm that carries it: upper arm hangs down and a little back, forearm reaches forward, and the hand
// lies along the barrel with its palm turned in toward the gun. The rifle is then set into that hand, so it
// can never drift away from the grip. All directions are in Unit 07's own space.
const ARM = {
  upper: new THREE.Vector3(-0.28, -0.94, -0.14).normalize(),
  fore: new THREE.Vector3(0.11, -0.25, 0.96).normalize(),
  handRest: new THREE.Vector3(-0.045, -0.8, 0.6).normalize(),           // wrist to the middle of the hand, at rest
  palm: new THREE.Vector3(-0.03, -0.53, 0.4),                            // wrist to the middle of the palm, at rest (metres)
  inward: new THREE.Vector3(1, 0, 0), inset: 0.05,                       // the palm faces Unit 07's left; grip sits this far into it
};
const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3(), TMP3 = new THREE.Vector3();

// The "07" stencil for the shoulder: worn off-white numerals on a transparent card.
function stencil07() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.font = '900 190px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ddd6c2'; g.fillText('07', 128, 138);
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, 131, 256, 9);                                           // stencil bridge through the middle
  for (let i = 0; i < 520; i++) {                                       // chips and wear
    g.globalAlpha = 0.25 + Math.random() * 0.6;
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 4.5, 0, 6.3); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Finds the flat outer face of the left shoulder block on the model and fixes the 07 to it,
// parented to whichever bone moves that part of the armour so it stays put when the arm moves.
function addStencil(rig) {
  const model = rig.root; model.updateMatrixWorld(true);
  let mesh = null; model.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!mesh) return;
  mesh.skeleton.update();
  const ray = new THREE.Raycaster(), hits = [];
  for (let y = 3.75; y <= 4.65; y += 0.08) for (let z = -1.3; z <= 0.6; z += 0.08) {       // shoulder block height only, above the arm
    ray.set(new THREE.Vector3(9, y, z), new THREE.Vector3(-1, 0, 0));
    const h = ray.intersectObject(mesh, false)[0];
    if (h) hits.push(h);
  }
  if (!hits.length) return;
  const maxX = Math.max(...hits.map((h) => h.point.x)), face = hits.filter((h) => h.point.x > maxX - 0.07);
  const ys = face.map((h) => h.point.y), zs = face.map((h) => h.point.z);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const size = Math.max(0.5, Math.min(Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)) * 0.85);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ map: stencil07(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  plate.position.set(maxX + 0.025, cy, cz); plate.rotation.y = Math.PI / 2;            // facing out to Unit 07's left
  // the bone with the most pull on that face
  const near = face.reduce((a, b) => (Math.hypot(a.point.y - cy, a.point.z - cz) < Math.hypot(b.point.y - cy, b.point.z - cz) ? a : b));
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, v = near.face.a;
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > bw) { bw = w; best = si.getComponent(v, k); } }
  const bone = mesh.skeleton.bones[best];
  model.add(plate); plate.updateMatrixWorld(true); bone.attach(plate);
  rig.stencil = { bone: bone.name, x: +maxX.toFixed(2), y: +cy.toFixed(2), z: +cz.toFixed(2), size: +size.toFixed(2) };
}
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; return m;
};

export class Unit07 {
  constructor(scene) {
    const steel = new THREE.MeshLambertMaterial({ color: 0x565b58 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x33373a });
    const hazard = new THREE.MeshLambertMaterial({ color: 0xd9a520 });
    const moss = new THREE.MeshLambertMaterial({ color: 0x4d6b2a });
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.cyan).multiplyScalar(3) });
    this.bodyMats = [steel, dark];

    const root = this.root = new THREE.Group();
    const upper = this.upper = new THREE.Group(); upper.position.y = HIP; root.add(upper);
    upper.add(box(1.7, 0.55, 1.1, dark, 0, 0.1, 0));                    // pelvis
    upper.add(box(2.5, 1.55, 1.7, steel, 0, 1.15, 0.05));               // torso
    upper.add(box(1.3, 0.7, 0.3, dark, 0, 0.9, 0.95));                  // chest plate
    upper.add(box(0.65, 0.45, 0.6, dark, 0, 2.15, 0.25));               // head
    upper.add(box(0.3, 0.2, 0.1, this.lensMat, 0, 2.15, 0.58));         // lens
    upper.add(box(1.6, 1.2, 0.5, dark, 0, 1.2, -1.0));                  // back pack (monkeys hang here)
    this.arms = [];
    for (const sx of [-1, 1]) {
      upper.add(box(0.95, 1.35, 1.3, steel, sx * 1.72, 1.35, 0));       // pauldron
      upper.add(box(0.97, 0.22, 1.32, hazard, sx * 1.72, 1.1, 0));      // hazard stripe
      upper.add(box(0.7, 0.14, 0.9, moss, sx * 1.72, 2.08, 0));         // moss
      const arm = new THREE.Group(); arm.position.set(sx * 1.75, 0.9, 0);
      arm.add(box(0.55, 1.2, 0.6, dark, 0, -0.6, 0));
      arm.add(box(0.7, 1.35, 0.8, steel, 0, -1.85, 0));
      arm.add(box(0.6, 0.4, 0.7, dark, 0, -2.7, 0));
      upper.add(arm); this.arms.push(arm);
    }
    // The gun: an assault rifle held in both hands in front of the chest, close to the centre line
    // so rounds go where Unit 07 is pointing.
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x191b1e });
    const gun = this.gun = new THREE.Group(); gun.position.set(HOLD.x, HOLD.y, HOLD.z);
    this.armed = false;                    // Unit 07 lands without a weapon and picks the rifle up on the trail
    this.tune = { HOLD, GRIP, ARM };       // live-adjustable from the console: __game.player.tune
    gun.add(box(0.32, 1.3, 0.5, gunMat, 0, 0, 0));                      // receiver
    gun.add(box(0.26, 0.95, 0.42, dark, 0, 1.1, -0.06));                // stock
    gun.add(box(0.28, 0.95, 0.38, dark, 0, -1.1, 0.02));                // handguard
    gun.add(box(0.2, 0.42, 0.7, gunMat, 0, -0.15, -0.55));              // magazine
    gun.add(box(0.18, 0.28, 0.42, gunMat, 0, 0.5, -0.42));              // grip
    gun.add(box(0.1, 0.6, 0.16, hazard, 0, -0.2, 0.33));                // sight rail
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.1, 8), gunMat);
    barrel.position.y = -2.1; barrel.castShadow = true; gun.add(barrel);
    upper.add(gun);
    this.flash = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe9a0).multiplyScalar(3) }));
    this.flash.position.set(0, -3.2, 0); this.flash.visible = false; gun.add(this.flash);
    // Laser sight straight down the barrel: bullets fly exactly along it.
    const beamGeo = new THREE.BoxGeometry(0.022, 1, 0.022); beamGeo.translate(0, -0.5, 0);      // one metre long, stretched each frame
    this.laser = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(1.6),
      transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.laser.position.set(0, -2.7, 0); gun.add(this.laser);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(7) }));
    gun.add(this.dot);

    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.62, HIP, 0);
      hip.add(box(0.75, 1.25, 0.85, steel, 0, -0.6, 0));
      const knee = new THREE.Group(); knee.position.y = -1.2;
      knee.add(box(0.65, 1.0, 0.75, dark, 0, -0.5, 0));
      knee.add(box(0.85, 0.3, 1.3, steel, 0, -0.95, 0.18));
      hip.add(knee); root.add(hip); this.legs.push({ hip, knee });
    }
    scene.add(root);
    // The real Unit 07 and its rifle replace the greybox boxes once their models load.
    loadModel('unit07').then((gltf) => {
      this.rig = new Rig(gltf, 5, { ownMaterial: true });
      addStencil(this.rig);
      for (const c of upper.children) if (c !== gun) c.visible = false;
      for (const leg of this.legs) leg.hip.visible = false;
      root.add(this.rig.root);
    }).catch(() => {});
    loadModel('reaper_rifle').then((gltf) => {      // "Reaper impulse assault rifle" by Alexandr33D, CC BY 4.0 (see CREDITS.md)
      const m = gltf.scene.clone(true); m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      m.position.sub(ctr);
      const hold = new THREE.Group(); hold.add(m); hold.scale.setScalar(3.9 / size.z);
      // the model lies along z with its muzzle at +z and its top at +y; the gun group fires along -y with +z up
      hold.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
      hold.position.set(0, -0.75, 0);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      for (const c of [...gun.children]) if (c !== this.flash && c !== this.laser && c !== this.dot) gun.remove(c);
      gun.add(hold);
    }).catch(() => {});
    this.reset(1, 0);
  }

  reset(s, d) {
    this.s = s; this.d = d; this.face = 0; this.moveDir = 0;   // angles in trail space, 0 = up the trail
    this.hull = TUNE.hull; this.ammo = TUNE.ammoMax;
    this.crouch = 0; this.ducking = false; this.pop = 0;
    this.phase = 0; this.amp = 0; this.speed = 0;
    this.fireCd = 0; this.invuln = 0; this.punchT = 0; this.punchCd = 0; this.punchLanded = false; this.freeAim = null;
    this.run = false; this.jumpY = 0; this.vy = 0; this.dashT = 0; this.dashCd = 0; this.dashDir = 0; this.armUp = 0; this.ready = 1; this.hitFlash = 0; this.moving = false; this.hurrying = false; this.land = 0;
  }

  get exposed() { return !this.ducking || this.pop > 0; }
  get aimY() { return 3.8 + this.jumpY; }

  // Returns the number of footfalls this frame (for shake, rumble and sound).
  update(dt, inp, world, level, maxS) {
    let steps = 0;
    this.ducking = false;                 // no ducking: stand behind a tree for cover, or quick boost out of the way
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.pop = Math.max(0, this.pop - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.punchCd = Math.max(0, this.punchCd - dt);

    const mag = Math.hypot(inp.x, inp.y);
    if (inp.runToggle) this.run = !this.run;                         // boost stays on until toggled off
    this.hurrying = this.run && mag > 0.1;
    const top = this.hurrying ? TUNE.hurry : TUNE.walk;
    const target = top * Math.min(1, mag);
    this.speed += (target - this.speed) * Math.min(1, dt * 4);        // heavy: slow to start and stop
    this.moving = this.speed > 0.25;
    if (mag > 0.1) this.moveDir = Math.atan2(inp.x, inp.y);
    // Quick boost: a hard burst in the direction of travel (or straight ahead when standing still).
    this.dashed = false;
    if (inp.dash && this.dashCd <= 0) {
      this.dashT = TUNE.dashTime; this.dashCd = TUNE.dashCd; this.dashDir = mag > 0.1 ? this.moveDir : this.face;
      this.invuln = Math.max(this.invuln, TUNE.dashTime + 0.05); this.dashed = true;
    }
    let ds = Math.cos(this.moveDir) * this.speed * dt, dd = Math.sin(this.moveDir) * this.speed * dt;
    if (this.dashT > 0) {
      this.dashT -= dt;
      ds = Math.cos(this.dashDir) * TUNE.dashSpeed * dt; dd = Math.sin(this.dashDir) * TUNE.dashSpeed * dt;
    }
    // Jump: boosters kick Unit 07 off the ground; it comes down hard.
    this.jumped = false; this.landed = false;
    if (inp.jump && this.jumpY <= 0) { this.vy = TUNE.jumpV; this.jumpY = 0.01; this.jumped = true; }
    if (this.jumpY > 0) {
      this.vy -= TUNE.gravity * dt; this.jumpY += this.vy * dt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.vy = 0; this.landed = true; }
    }
    let ns = this.s + ds, nd = this.d + dd;
    this.bumped = null;
    for (const c of level.covers) {                                    // walking into a tree shoves it over
      const ox = ns - c.s, oy = nd - c.d, dist = Math.hypot(ox, oy), min = c.r + 0.95;
      if (dist < min && dist > 0.001) { ns = c.s + ox / dist * min; nd = c.d + oy / dist * min; this.bumped = this.bumped || c; }
    }
    ns = Math.min(Math.max(ns, 0), maxS);
    nd = Math.min(Math.max(nd, -TUNE.roam), TUNE.roam);            // free to leave the trail and walk the jungle
    const moved = Math.hypot(ns - this.s, nd - this.d);
    this.s = ns; this.d = nd;

    const before = Math.floor(this.phase / Math.PI);
    this.phase += moved / STRIDE * Math.PI;
    steps = this.jumpY > 0 || this.dashT > 0 ? 0 : Math.floor(this.phase / Math.PI) - before;
    this.amp += ((this.moving ? Math.min(1.25, this.speed / TUNE.walk) : 0) - this.amp) * Math.min(1, dt * 5);

    // Punch: the left fist drives forward; it lands a little under halfway through the swing.
    this.punchLanded = false;
    if (this.punchT > 0) {
      const before = this.punchT;
      this.punchT = Math.max(0, this.punchT - dt / TUNE.punchTime);
      if (before > 0.6 && this.punchT <= 0.6) this.punchLanded = true;
    }

    this.armUp = Math.max(0, this.armUp - dt * 2.5);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.pose(dt, world);
    return steps;
  }

  // Stretch the laser to where it lands (len metres from the muzzle); hit = it is resting on something.
  setLaser(len, hit) { this.laser.scale.y = len; this.dot.position.y = -2.7 - len; this.laserHit = hit; }

  startPunch(target) {
    if (this.punchT > 0 || this.punchCd > 0) return false;
    this.punchT = 1; this.punchCd = TUNE.punchCd; this.punchTarget = target || null;
    if (this.ducking) this.pop = TUNE.popTime;
    return true;
  }

  // Fires one round. With no target the rifle sprays wherever Unit 07 is facing.
  tryFire() {
    if (!this.armed || this.fireCd > 0 || this.ammo <= 0 || this.punchT > 0) return false;
    this.ammo--; this.fireCd = TUNE.fireCd;
    if (this.ducking) this.pop = TUNE.popTime;
    this.armUp = 1;
    return true;
  }

  pose(dt, world) {
    const wantCrouch = this.ducking && this.pop <= 0 ? 1 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * (wantCrouch ? 7 : 11));
    const c = this.crouch, a = this.amp, sw = Math.sin(this.phase);

    // Turn to face a locked bad robot (or whatever was just shot) and level the gun at it.
    const tucked = this.ducking && this.pop <= 0;
    const look = this.punchT > 0 && this.punchTarget ? this.punchTarget : null;
    let wantFace = this.moveDir;
    if (look) wantFace = Math.atan2(look.d - this.d, look.s - this.s);
    else if (this.freeAim !== null && !tucked) wantFace = this.freeAim;
    let df = wantFace - this.face; df = Math.atan2(Math.sin(df), Math.cos(df));
    this.face += df * Math.min(1, dt * (this.freeAim !== null || look ? 13 : 5));

    world.toW(this.s, this.d, this.jumpY, this.root.position);
    this.root.rotation.y = world.yaw(this.s, Math.cos(this.face + HOLD.turn), Math.sin(this.face + HOLD.turn));
    this.root.rotation.z = sw * 0.035 * a;

    const hipY = HIP - 1.25 * c - Math.abs(Math.cos(this.phase)) * 0.14 * a;
    this.upper.position.y = hipY;
    this.upper.rotation.x = 0.55 * c + 0.06 * a;
    this.legs.forEach((leg, i) => {
      const sgn = i ? -1 : 1, swing = sw * sgn;
      leg.hip.position.y = hipY;
      leg.hip.rotation.x = -swing * 0.48 * a - 1.0 * c;
      leg.knee.rotation.x = Math.max(0, -swing) * 0.7 * a + 2.1 * c;
    });
    const jab = Math.sin(Math.min(1, this.punchT) * Math.PI);            // 0 -> 1 -> 0 over the swing
    // The rifle is held level at the ready whenever Unit 07 is not tucked behind cover.
    this.ready += ((tucked ? 0 : 1) - this.ready) * Math.min(1, dt * 12);
    const r = this.ready;
    this.arms[0].rotation.x = ((sw * 0.3 * a - 0.55 * c) * (1 - r) - 1.4 * r) * (1 - jab) - 1.55 * jab;
    this.arms[0].rotation.z = 0.45 * r * (1 - jab);                      // both hands reach in to the rifle
    this.arms[0].position.z = jab * 0.9;
    this.upper.rotation.y = jab * 0.5;
    this.arms[1].rotation.x = (-sw * 0.3 * a - 0.55 * c) * (1 - r) - 1.4 * r;
    this.arms[1].rotation.z = -0.45 * r;
    this.gun.rotation.set(-Math.PI / 2 - this.upper.rotation.x + HOLD.pitch + (1 - r) * 0.8, 0, HOLD.yaw);
    this.gun.position.set(HOLD.x, HOLD.y, HOLD.z - this.armUp * 0.12);   // recoil chatter
    this.gun.visible = this.armed;
    this.laser.visible = this.armed && r > 0.9; this.dot.visible = this.laser.visible && this.laserHit;
    this.flash.visible = this.armed && this.armUp > 0.8 && Math.random() < 0.7;
    this.flash.scale.setScalar(0.7 + Math.random() * 0.7);
    const f = this.hitFlash;
    this.bodyMats[0].emissive.setRGB(f * 0.9, f * 0.15, f * 0.1);
    this.bodyMats[1].emissive.setRGB(f * 0.9, f * 0.15, f * 0.1);
    if (this.rig) {
      // Drive the model's skeleton from the same walk, lean and punch values the greybox used.
      const r = this.rig, lean = 0.07 * a + (this.hurrying ? 0.08 : 0);       // the model is already hunched forward at rest
      // Legs and feet walk a proper cycle; the body rides them: it drops as each foot takes the weight,
      // leans over the leg that is carrying it, and the shoulders counter the hips.
      const g = gait(r, this.phase, a, this.hurrying ? 0.58 : 0.5);
      this.walk = g;
      // Superhero landing (this.land, 0..1): down on the right knee, left foot planted ahead, left fist driven
      // into the ground, body folded forward over it. Blended over the normal stance.
      const L = this.land ? this.land * this.land * (3 - 2 * this.land) : 0;
      r.turn('Hips', 0.05 * g.impact + 0.22 * L, sw * 0.09 * a, g.side * 0.07);
      r.turn('Spine', lean * 0.6 + 0.06 * g.impact + 0.3 * L, jab * 0.2 - sw * 0.03 * a, g.side * 0.03);
      r.turn('Spine01', lean + 0.09 * g.impact + 0.36 * L, jab * 0.35 - sw * 0.06 * a, -g.side * 0.02);
      r.turn('Spine02', lean * 1.3 + 0.11 * g.impact + 0.3 * L, jab * 0.5 - sw * 0.09 * a, -g.side * 0.04);
      if (L > 0) {
        r.turn('LeftUpLeg', -1.3 * L, 0.12 * L); r.turn('LeftLeg', 0.12 * L); r.turn('LeftFoot', 0); r.turn('LeftToeBase', 0);         // thigh level, shin upright
        r.turn('RightUpLeg', 0.2 * L, -0.1 * L); r.turn('RightLeg', 1.5 * L); r.turn('RightFoot', 0.95 * L); r.turn('RightToeBase', 0.5 * L);   // kneeling, toes dug in
      }
      // The rifle is held in the right hand alone. The left arm swings free with the walk and throws the punches.
      const swingL = sw * 0.3 * a;
      r.turn('LeftArm', (swingL * (1 - jab) - 1.5 * jab) * (1 - L) - 0.42 * L, -0.1 * jab, 0.1 * L);
      r.turn('LeftForeArm', ((swingL - 0.3) * (1 - jab) - 1.55 * jab) * (1 - L) - 0.2 * L);       // straight down to the ground when landing
      if (this.armed) {
        // Right arm and hand take their carrying pose; the hand lies along the barrel, palm in.
        const cp = Math.cos(HOLD.pitch), barrel = TMP3.set(Math.sin(HOLD.yaw) * cp, -Math.sin(HOLD.pitch), Math.cos(HOLD.yaw) * cp);
        r.point('RightArm', ARM.upper);
        r.point('RightForeArm', TMP.copy(ARM.fore).setY(ARM.fore.y + this.armUp * 0.05).normalize());     // recoil lifts the forearm a touch
        r.frame('RightHand', ARM.handRest, ARM.inward, barrel, ARM.inward);
        r.apply(true);
        this.root.updateMatrixWorld(true);
        // Now seat the rifle in that hand: slide it so the middle of its grip sits in the palm.
        const hand = r.byName.get('RightHand');
        const palm = r.jointPos('RightHand', TMP).add(TMP2.copy(ARM.palm).applyQuaternion(hand.cur)).addScaledVector(ARM.inward, ARM.inset);
        r.root.localToWorld(palm);
        const now = this.gun.localToWorld(TMP2.copy(GRIP));
        this.gun.position.add(this.upper.worldToLocal(palm).sub(this.upper.worldToLocal(now)));
        r.apply();
      } else {
        // No rifle yet: the right arm swings with the walk like the left, and sweeps back and out in the landing pose.
        r.turn('RightArm', -swingL * (1 - L) + 0.75 * L, 0, -0.5 * L);
        r.turn('RightForeArm', (-swingL - 0.3) * (1 - L) + 0.25 * L);
        r.apply();
      }
      r.root.position.y = -0.2 * a + 0.16 * g.rise - 0.2 * g.impact - 1.2 * L;       // sinks onto each step, lifts through mid-stride; drops to one knee when landing
      r.root.position.x = g.side * 0.16;                                    // weight shifts over the standing leg
      r.glow(f * 0.9, f * 0.15, f * 0.1);
    }
    this.root.updateMatrixWorld(true);
  }

  // World position of the n-th monkey handhold on the back.
  riderPos(i, out) {
    const col = (i % 3) - 1, row = Math.floor(i / 3);
    out.set(col * 0.6, 1.75 - row * 0.6, -1.4);
    return this.upper.localToWorld(out);
  }
  chest(out) { return this.upper.localToWorld(out.set(0, 1.1, 0)); }
  muzzle(out) { return this.gun.localToWorld(out.set(0, -2.7, 0)); }
  breech(out) { return this.gun.localToWorld(out.set(0, -0.7, 0)); }
}
