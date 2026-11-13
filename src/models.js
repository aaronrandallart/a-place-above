// Loads the 3D models in assets/models and hands out copies sized for the game.
// Every user of a model keeps its greybox stand-in until the model arrives, so a missing
// or broken file never stops the game.
import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../assets/vendor/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader(), cache = new Map();

// Promise of the parsed .glb (cached, so nine monkeys cost one download).
export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((resolve, reject) => loader.load(`assets/models/${name}.glb`, resolve, undefined, reject)));
  }
  return cache.get(name);
}

// A fresh copy of the model inside a Group, scaled so that `height` (y) or `length` (longest side)
// has the given size in metres, centred on x and z, standing on y = 0.
export function fitted(gltf, { height, length } = {}) {
  const skinned = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  const obj = skinned.length ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const k = height ? height / size.y : length ? length / Math.max(size.x, size.y, size.z) : 1;
  obj.position.set(-ctr.x, -box.min.y, -ctr.z);
  const holder = new THREE.Group(); holder.add(obj); holder.scale.setScalar(k);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = !o.isSkinnedMesh; } });
  const out = new THREE.Group(); out.add(holder);
  out.userData = { model: obj, scale: k, size: size.multiplyScalar(k) };
  return out;
}

// Soft sky-and-ground lighting for the metal and paint on the models to reflect.
export function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 24, 12), col = [], p = geo.attributes.position;
  const sky = new THREE.Color(0xb8c9c2), horizon = new THREE.Color(0x6f7f72), ground = new THREE.Color(0x232b22), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 10;                                      // -1 straight down, 1 straight up
    if (t > 0) c.lerpColors(horizon, sky, Math.min(1, t * 1.6)); else c.lerpColors(horizon, ground, Math.min(1, -t * 2.5));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer), tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose(); geo.dispose();
  return tex;
}

// A rigged character posed in code. Each frame the game says how far each bone should be turned
// from its rest pose, as pitch / yaw / roll in the character's own space (x = its side-to-side axis,
// y = up, z = forward), and the rig works out the local bone rotations. Bones that are not given a
// rotation follow their parent. The models face +z; turning a limb about x by a negative angle swings it forward.
export class Rig {
  constructor(gltf, height, { ownMaterial = false } = {}) {
    this.root = fitted(gltf, { height });
    const model = this.root.userData.model;
    model.updateMatrixWorld(true);
    this.bones = []; this.mats = [];
    model.traverse((o) => {
      if (o.isBone) {
        const parentBone = o.parent && o.parent.isBone ? o.parent : null;
        this.bones.push({ bone: o, name: o.name, parent: parentBone ? parentBone.name : null,
          rest: o.getWorldQuaternion(new THREE.Quaternion()),
          restParent: o.parent.getWorldQuaternion(new THREE.Quaternion()),
          want: new THREE.Quaternion(), has: false, cur: new THREE.Quaternion() });
      }
      if (o.isMesh) { if (ownMaterial) o.material = o.material.clone(); this.mats.push(o.material); }
    });
    this.byName = new Map(this.bones.map((b) => [b.name, b]));
    // where each bone sits and which way it points at rest, in the character's own space (metres)
    this.root.updateMatrixWorld(true);
    for (const b of this.bones) b.restPos = this.root.worldToLocal(b.bone.getWorldPosition(new THREE.Vector3()));
    for (const b of this.bones) {
      const kid = this.bones.find((c) => c.parent === b.name);
      b.restDir = kid ? kid.restPos.clone().sub(b.restPos).normalize() : new THREE.Vector3(0, -1, 0);
      b.len = kid ? kid.restPos.distanceTo(b.restPos) : 0;
    }
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._m0 = new THREE.Matrix4(); this._m1 = new THREE.Matrix4();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._q = new THREE.Quaternion(); this._w = new THREE.Quaternion();
  }
  has(name) { return this.byName.has(name); }
  // Turn a bone from its rest pose: pitch about x, then yaw about y (roll about z first, rarely needed).
  turn(name, pitch = 0, yaw = 0, roll = 0) {
    const b = this.byName.get(name); if (!b) return;
    b.want.setFromEuler(this._e.set(pitch, yaw, roll)); b.has = true;
  }
  // Point a bone along a direction given in the character's space.
  point(name, dir) {
    const b = this.byName.get(name); if (!b) return;
    b.want.setFromUnitVectors(b.restDir, dir); b.has = true;
  }
  // Fully orient a bone: turn it so that rest direction a0 ends up along a1, and rest direction b0
  // ends up as close to b1 as it can (all in the character's space). Used to set a hand's facing.
  frame(name, a0, b0, a1, b1) {
    const b = this.byName.get(name); if (!b) return;
    const basis = (a, s, m) => {
      const x = this._a.copy(a).normalize(), z = this._b.crossVectors(x, s).normalize(), y = this._c.crossVectors(z, x);
      return m.makeBasis(x, y, z);
    };
    basis(a0, b0, this._m0); basis(a1, b1, this._m1);
    b.want.setFromRotationMatrix(this._m1.multiply(this._m0.transpose())); b.has = true;
  }
  // Where a joint is right now, in the character's space. Needs apply() and updateMatrixWorld first.
  jointPos(name, out) {
    return this.root.worldToLocal(this.byName.get(name).bone.getWorldPosition(out));
  }
  // Bend one arm ('Left' or 'Right') so its hand reaches `target` (character space). `pole` says roughly
  // which way the elbow should stick out. `palm` is how far past the wrist the grip is.
  reach(side, target, pole, palm = 0.3) {
    const up = this.byName.get(side + 'Arm'), fore = this.byName.get(side + 'ForeArm'); if (!up || !fore) return;
    const S = this.jointPos(side + 'Arm', this._a), L1 = up.len, L2 = fore.len + palm;
    const to = this._b.copy(target).sub(S), dist = Math.min(to.length(), (L1 + L2) * 0.995), dir = to.normalize();
    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))), sinA = Math.sqrt(1 - cosA * cosA);
    const perp = this._c.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();          // elbow direction, square to the reach
    const elbow = this._d.copy(S).addScaledVector(dir, L1 * cosA).addScaledVector(perp, L1 * sinA);
    this.point(side + 'Arm', this._c.copy(elbow).sub(S).normalize());
    this.point(side + 'ForeArm', this._c.copy(target).sub(elbow).normalize());
  }
  // Apply this frame's turns, then forget them (unless keep is set, for a second pass).
  apply(keep = false) {
    for (const b of this.bones) {
      const p = b.parent ? this.byName.get(b.parent) : null;
      if (b.has) b.cur.copy(b.want); else if (p) b.cur.copy(p.cur); else b.cur.identity();
      this._w.multiplyQuaternions(b.cur, b.rest);                                   // where this bone should point
      if (p) this._q.multiplyQuaternions(p.cur, p.rest); else this._q.copy(b.restParent);
      b.bone.quaternion.copy(this._q.invert().multiply(this._w));                   // expressed relative to its parent
      if (!keep) b.has = false;
    }
  }
  glow(r, g, b) { for (const m of this.mats) if (m.emissive) m.emissive.setRGB(r, g, b); }
}

// A walking cycle for a two-legged rig, with real foot roll: the heel lands with the toes up, the foot
// goes flat as it takes the weight, the heel peels off, and the toes push away last. `phase` advances by
// PI per step (a foot lands every time it passes a multiple of PI). `amp` is 0 standing still, 1 walking.
// Returns how the body should ride the legs: `impact` spikes at each footfall and decays (the weight
// landing), `rise` is 0 at footfall and 1 at mid-stride, `side` is -1..1 toward the leg carrying the weight.
const TAU = Math.PI * 2;
const bump = (u, c, w) => { let d = Math.abs(u - c); d = Math.min(d, 1 - d); return Math.exp(-(d * d) / (w * w)); };
export function gait(rig, phase, amp, swing = 0.5) {
  for (const [side, off] of [['Right', 0], ['Left', Math.PI]]) {
    const u = (((phase + off) / TAU) % 1 + 1) % 1;                    // 0 heel strike, 0.5 toe-off, then the swing forward
    const thigh = -swing * amp * Math.cos(u * TAU);
    const knee = amp * (0.1 + 0.32 * bump(u, 0.1, 0.09) + 1.05 * bump(u, 0.72, 0.15));      // gives under load, folds to clear the ground
    const foot = amp * (-0.42 * bump(u, 0.98, 0.09) + 0.8 * bump(u, 0.53, 0.1));            // toes up at strike, heel up at push-off
    rig.turn(side + 'UpLeg', thigh); rig.turn(side + 'Leg', thigh + knee);
    rig.turn(side + 'Foot', foot); rig.turn(side + 'ToeBase', foot * 0.2);                  // toes stay nearer the ground than the heel
  }
  const step = ((phase / Math.PI) % 1 + 1) % 1;
  return { impact: amp * Math.exp(-(step * step) / 0.025), rise: amp * Math.sin(step * Math.PI), side: -amp * Math.sin(phase) };
}
