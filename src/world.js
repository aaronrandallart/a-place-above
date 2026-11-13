// Trail spline, greybox jungle, cover, markers and the rail camera.
// Gameplay runs in flat trail space: s = metres along the trail, d = metres right of its centre.
import * as THREE from 'three';
import { TUNE, TRAIL_LEN, OBJECT_HP, SECTION_LEN, SECTIONS } from './config.js';
import { GLTFLoader } from '../assets/vendor/jsm/loaders/GLTFLoader.js';

const PAD = 30, STEP = 0.5;
export const COL = {
  fog: 0x2c3a34, ground: 0x1c2a1d, trail: 0x4a4233, trunk: 0x2b271f, leaf: 0x2a4a33,
  rock: 0x59605c, stump: 0x4b3a27, gold: 0xe8b85a, cyan: 0x5fe0e6, red: 0xff4b3a,
};

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Cells of the undergrowth sheet: [u0, v0, u1, v1, width / height].
const UNDER = [[0.0054, 0.0592, 0.25, 0.6086, 1.5], [0.25, 0.0609, 0.4956, 0.9589, 0.921], [0.5049, 0.0609, 0.75, 0.5954, 1.545], [0.75, 0.0609, 1.0, 0.6053, 1.547]];

// Colour multiplied into the pine needles: less red and blue, a touch more green. (1, 1, 1) = the model as downloaded.
const PINE_GREEN = new THREE.Color(0.62, 1.08, 0.6);

export class World {
  constructor(scene, level) {
    this.scene = scene; this.level = level;
    this.objects = level.covers.slice();      // every cover tree, standing or felled
    this.debris = [];
    const pts = [];
    for (let z = 40; z >= -230; z -= 10) pts.push(new THREE.Vector3(9 * Math.sin(z / 24) + 2 * Math.sin(z / 11), 0, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const len = curve.getLength();
    this.n = Math.floor(len / STEP);
    this.pts = curve.getSpacedPoints(this.n);
    this.step = len / this.n;
    this._p = new THREE.Vector3(); this._t = new THREE.Vector3();

    this.loader = new THREE.TextureLoader();
    this.buildGround();
    this.buildTrees(level);
    this.buildUndergrowth(level);
    this.buildMarkers(level);
    this.camS = 0; this.camD = 0;
    this.shake = 0;
  }

  // Trail frame at s: writes point into this._p and unit tangent into this._t.
  frame(s) {
    const f = Math.min(Math.max((s + PAD) / this.step, 0), this.n - 1.001);
    const i = Math.floor(f), a = f - i, A = this.pts[i], B = this.pts[i + 1];
    this._p.lerpVectors(A, B, a);
    this._t.subVectors(B, A).setY(0).normalize();
  }
  toW(s, d, y = 0, out = new THREE.Vector3()) {
    this.frame(s);
    return out.set(this._p.x - this._t.z * d, y, this._p.z + this._t.x * d);
  }
  // World position -> trail space, measured around the trail frame at sRef (accurate near it).
  toTrail(v, sRef) {
    this.frame(sRef);
    const dx = v.x - this._p.x, dz = v.z - this._p.z;
    return { s: sRef + dx * this._t.x + dz * this._t.z, d: -dx * this._t.z + dz * this._t.x };
  }
  // World yaw for a direction given in trail space (models face local +z).
  yaw(s, ds, dd) {
    this.frame(s);
    return Math.atan2(this._t.x * ds - this._t.z * dd, this._t.z * ds + this._t.x * dd);
  }

  // Loads one of the Higgsfield-made textures from assets/textures.
  tex(name, rx = 1, ry = 1) {
    const t = this.loader.load('assets/textures/' + name);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
    return t;
  }

  buildGround() {
    const mid = this.toW(TRAIL_LEN / 2, 0);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(520, 520),
      new THREE.MeshLambertMaterial({ map: this.tex('floor.jpg', 74, 74), color: 0xc4cdbf }));     // leaf litter, 7 m per tile
    g.rotation.x = -Math.PI / 2; g.position.set(mid.x, 0, mid.z); g.receiveShadow = true;
    this.scene.add(g);

    // The trail: packed mud, 6 m per tile along its length, fading into the jungle floor at both edges.
    const pos = [], uv = [], col = [], idx = [], w = TUNE.halfWidth + 0.2;
    const across = [[-w - 1.6, 0], [-w + 0.5, 1], [w - 0.5, 1], [w + 1.6, 0]];
    let k = 0;
    for (let s = -28; s <= TRAIL_LEN + 22; s += 1, k++) {
      for (const [d, a] of across) {
        const p = this.toW(s, d, 0.03);
        pos.push(p.x, p.y, p.z); uv.push((d + w + 1.6) / 6, s / 6); col.push(1, 1, 1, a);
      }
      if (k > 0) for (let j = 0; j < 3; j++) { const i = k * 4 + j; idx.push(i - 4, i - 3, i, i - 3, i + 1, i); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx); geo.computeVertexNormals();
    const trail = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.tex('trail.jpg'), color: 0xf0e2cc, vertexColors: true,
      transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    trail.receiveShadow = true; trail.renderOrder = 1;
    this.scene.add(trail);
  }

  // Low plants scattered over the jungle floor: ferns, grass and shrubs on crossed cards. No collision.
  buildUndergrowth(level) {
    const R = rng(23), map = this.tex('undergrowth.png');
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xb9c6b4 });
    const keepOut = level.cages.map((o) => ({ s: o.s, d: o.d, r: 3.2 })).concat(level.safeZones.map((z) => ({ s: z.s, d: 0, r: 7 })));
    const spots = UNDER.map(() => []);
    for (let i = 0; i < 1300; i++) {
      const s = -26 + R() * (TRAIL_LEN + 50), side = R() < 0.5 ? -1 : 1, d = side * (3.9 + Math.pow(R(), 1.3) * 30);
      if (keepOut.some((o) => Math.hypot(o.s - s, o.d - d) < o.r)) continue;
      spots[Math.floor(R() * UNDER.length)].push({ p: this.toW(s, d), sc: 0.8 + R() * 1.3, rot: R() * 3.14 });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    UNDER.forEach(([u0, v0, u1, v1, aspect], n) => {
      const wd = 1.5, ht = wd / aspect, pos = [], uv = [], nor = [], idx = [];
      for (let c = 0; c < 2; c++) {                                   // two cards at right angles
        const cx = c ? 0 : wd / 2, cz = c ? wd / 2 : 0, b = c * 4;
        pos.push(-cx, 0, -cz, cx, 0, cz, cx, ht, cz, -cx, ht, -cz);
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        for (let j = 0; j < 4; j++) nor.push(0, 1, 0);                // lit like the ground, never black on the back
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setIndex(idx);
      const mesh = new THREE.InstancedMesh(geo, mat, spots[n].length);
      spots[n].forEach((o, i) => { q.setFromAxisAngle(up, o.rot); sc.setScalar(o.sc); m.compose(o.p, q, sc); mesh.setMatrixAt(i, m); });
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    });
  }

  // Stand-in pine bough drawn in code: a woody stem with side twigs bristling with needles.
  // Used only until a real pine model is dropped into assets/models (see loadPineModel).
  boughTexture() {
    const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rng(91);
    const shape = (t) => Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI), 0.55) * (1 - t * 0.55);
    g.fillStyle = 'rgba(12, 26, 18, 0.9)';
    g.beginPath(); g.moveTo(W / 2, H);
    for (let i = 0; i <= 40; i++) { const t = i / 40; g.lineTo(W / 2 - shape(t) * W * 0.44, H - t * H * 0.98); }
    for (let i = 40; i >= 0; i--) { const t = i / 40; g.lineTo(W / 2 + shape(t) * W * 0.44, H - t * H * 0.98); }
    g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const t = 0.03 + i / 46 * 0.95, side = i % 2 ? 1 : -1, y0 = H - t * H * 0.98, len = shape(t) * W * 0.46;
      const ang = -Math.PI / 2 + side * (0.95 + R() * 0.25), dx = Math.cos(ang), dy = Math.sin(ang);
      g.strokeStyle = '#3a2c1c'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(W / 2, y0); g.lineTo(W / 2 + dx * len, y0 + dy * len); g.stroke();
      for (let k = 0; k < len; k += 2.2) {
        const px = W / 2 + dx * k, py = y0 + dy * k, shade = 26 + Math.floor(R() * 52) + Math.floor(k / len * 22);
        g.strokeStyle = `rgb(${Math.floor(shade * 0.55)}, ${shade + 12}, ${Math.floor(shade * 0.62)})`; g.lineWidth = 1.3;
        for (const s2 of [-1, 1]) {
          const na = ang + s2 * (0.75 + R() * 0.3), nl = 9 + R() * 7;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); g.stroke();
        }
      }
    }
    g.strokeStyle = '#33271a'; g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, H * 0.03); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }

  // Stand-in pine crown: tiers of drooping boughs, long at the bottom and short at the top.
  crownGeometry() {
    const pos = [], uv = [], nor = [], idx = [];
    const quad = (o, yaw, tilt, len) => {
      const wd = len * 0.4, ct = Math.cos(tilt);
      const ax = Math.cos(yaw) * ct, ay = -Math.sin(tilt), az = Math.sin(yaw) * ct, sx = -Math.sin(yaw) * wd / 2, sz = Math.cos(yaw) * wd / 2;
      const b = pos.length / 3;
      pos.push(o[0] - sx, o[1], o[2] - sz, o[0] + sx, o[1], o[2] + sz,
        o[0] + ax * len + sx, o[1] + ay * len, o[2] + az * len + sz, o[0] + ax * len - sx, o[1] + ay * len, o[2] + az * len - sz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let j = 0; j < 4; j++) nor.push(0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const TIERS = 13, BOTTOM = 3.0, TOP = 12.4;
    for (let k = 0; k < TIERS; k++) {
      const f = k / (TIERS - 1), y = BOTTOM + f * (TOP - BOTTOM), len = 3.7 * (1 - f * 0.82), n = f > 0.7 ? 6 : 9;
      for (let i = 0; i < n; i++) { const yaw = k * 0.7 + i / n * Math.PI * 2; quad([Math.cos(yaw) * 0.15, y, Math.sin(yaw) * 0.15], yaw, 0.6 - f * 0.25, len); }
    }
    for (let i = 0; i < 3; i++) quad([0, TOP + 0.2, 0], i * 2.1, -1.25, 1.5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  // Makes a material fade per tree: a per-instance alpha fed to a dithered discard in the shader.
  fading(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float instAlpha;\nvarying float vInstAlpha;\n' +
        sh.vertexShader.replace('void main() {', 'void main() {\n  vInstAlpha = instAlpha;');
      sh.fragmentShader = 'varying float vInstAlpha;\n' + sh.fragmentShader.replace('void main() {',
        'void main() {\n  if (vInstAlpha < 0.999) { float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (n > vInstAlpha) discard; }');
    };
    return mat;
  }

  // Every tree uses the pine model in assets/models/pine_tree ("Pine tree" by Andriy Shekh, CC BY 4.0,
  // see CREDITS.md). If it fails to load, the code-drawn stand-in stays. It is scaled to 13 m tall with its base on the ground,
  // and shares the stand-in's per-tree transforms, so falling, fading and collisions all keep working.
  loadPineModel() {
    const tryLoad = (urls) => {
      if (!urls.length) return;
      new GLTFLoader().load(urls[0], (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
        const k = 13 / size.y, fix = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-ctr.x, -box.min.y, -ctr.z));
        this.pineMeshes = [];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.applyMatrix4(fix);
          geo.setAttribute('instAlpha', this.treeAlpha);
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          const leafy = /leav|leaf/i.test(src.name || o.name);
          const tint = src.color ? src.color.clone() : new THREE.Color(1, 1, 1);
          if (leafy) tint.multiply(PINE_GREEN);                          // push the yellow-olive needles toward green
          const mat = new THREE.MeshLambertMaterial({ map: src.map || null, color: tint, side: THREE.DoubleSide,
            alphaTest: src.map && (src.transparent || src.alphaTest > 0 || src.alphaMap) ? 0.5 : 0 });
          const im = new THREE.InstancedMesh(geo, this.fading(mat), this.trees.length);
          im.instanceMatrix = this.trunks.instanceMatrix;             // same transforms as the stand-in trees
          im.frustumCulled = false;
          this.scene.add(im); this.pineMeshes.push(im);
        });
        if (this.pineMeshes.length) { this.trunks.visible = false; this.leaves.visible = false; this.pineModel = urls[0]; }
      }, undefined, () => tryLoad(urls.slice(1)));
    };
    tryLoad(['assets/models/pine_tree/scene.gltf']);
  }

  buildTrees(level) {
    const R = rng(7), trees = [];
    const keepOut = [...level.enemies, ...level.cages].map((o) => ({ s: o.s, d: o.d, r: 2.4 }))
      .concat(level.safeZones.map((z) => ({ s: z.s, d: 0, r: 8.5 })));
    for (let tries = 0; trees.length < 340 && tries < 4000; tries++) {
      const s = -26 + R() * (TRAIL_LEN + 50);
      const side = R() < 0.5 ? -1 : 1;
      const d = side * (9.5 + Math.pow(R(), 1.5) * 24);
      if (keepOut.some((k) => Math.hypot(k.s - s, k.d - d) < k.r)) continue;
      const p = this.toW(s, d);
      trees.push({ x: p.x, z: p.z, s, d, sc: 0.75 + R() * 0.7, rot: R() * 6.28, vis: 1, shown: -1, dead: false, fall: 0, shownFall: 0, fx: 0, fz: 1 });
    }
    this.trees = trees;
    // Every jungle tree is solid: Unit 07 and the bad robots walk around it, it stops shots,
    // and it can be shot or punched down like the trees on the trail.
    for (const t of trees) {
      const c = { s: t.s, d: t.d, r: 0.42 * t.sc, kind: 'forest', forest: t, h: 9 * t.sc, aimY: 2.4, low: false, isObject: true,
        section: Math.min(SECTIONS.length - 1, Math.max(0, Math.floor(t.s / SECTION_LEN))),
        mesh: { position: new THREE.Vector3(t.x, 0, t.z), visible: true },
        maxHp: OBJECT_HP.forest, hp: OBJECT_HP.forest, alive: true, punch: 0 };
      level.covers.push(c); this.objects.push(c);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.42, 13, 8); trunkGeo.translate(0, 6.5, 0);
    const leafGeo = this.crownGeometry();
    // Trees never change size. One that blocks the view fades to a faint see-through ghost instead
    // (a per-tree alpha fed to a dithered discard in the shader), then fades back.
    this.treeAlpha = new THREE.InstancedBufferAttribute(new Float32Array(trees.length).fill(1), 1);
    trunkGeo.setAttribute('instAlpha', this.treeAlpha); leafGeo.setAttribute('instAlpha', this.treeAlpha);
    const leafMap = this.boughTexture();
    this.trunks = new THREE.InstancedMesh(trunkGeo, this.fading(new THREE.MeshLambertMaterial({ map: this.tex('bark.jpg', 2, 5), color: 0xb9b3a8 })), trees.length);
    this.leaves = new THREE.InstancedMesh(leafGeo, this.fading(new THREE.MeshLambertMaterial({ map: leafMap, alphaTest: 0.35, side: THREE.DoubleSide, color: 0xa3b3a0 })), trees.length);
    this.trunks.frustumCulled = this.leaves.frustumCulled = false;
    this.scene.add(this.trunks, this.leaves);
    this._q2 = new THREE.Quaternion(); this._ax = new THREE.Vector3(); this._pos = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._sc = new THREE.Vector3(); this._tp = new THREE.Vector3();
    this.updateTrees(null, null, 1);
    this.loadPineModel();
  }

  // Fade out a tree only when it blocks the camera's view of Unit 07. cam, robot: world positions.
  // Also animates trees that Unit 07 has pushed over.
  updateTrees(cam, robot, dt) {
    let dirty = false;
    const up = this._tp.set(0, 1, 0);
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      let want = 1;
      if (t.fall > 0) {
        if (t.fall < 1) t.fall = Math.min(1, t.fall + dt / 0.85);
        want = 1;                                              // always show a tree that is going over
      } else if (cam) {
        // Only a tree that really sits on the camera's line of sight to Unit 07 goes: find where the
        // sight line passes closest to the tree, and compare with how wide the tree is at that height
        // (thin trunk below, cone of leaves above), plus Unit 07's own half width.
        const bx = robot.x - cam.x, by = robot.y - cam.y, bz = robot.z - cam.z;
        const u = ((t.x - cam.x) * bx + (t.z - cam.z) * bz) / (bx * bx + bz * bz);
        if (u > 0 && u < 1) {
          const h = cam.y + by * u, base = 1.4 * t.sc, tip = 13.4 * t.sc;                   // the pine is a cone between these heights
          const r = h > tip + 2 ? -9 : h > base ? 4.6 * t.sc * (1 - (h - base) / (tip - base)) + 0.4 : 0.42 * t.sc;
          if (Math.hypot(t.x - (cam.x + bx * u), t.z - (cam.z + bz * u)) < r + 1.5 + (1 - u) * 2.5) want = 0;    // nearer the lens it covers more
        }
      }
      t.vis += (want - t.vis) * Math.min(1, dt * (t.fall > 0 ? 30 : 9));
      const v = Math.abs(t.vis - want) < 0.01 ? want : t.vis;
      if (v === t.shown && t.fall === t.shownFall) continue;
      t.shown = v; t.shownFall = t.fall; dirty = true;
      this._q.setFromAxisAngle(up, t.rot);
      if (t.fall > 0) {                                        // tip over away from the push, speeding up as it goes
        const ang = t.fall * t.fall * 1.5;
        this._q.premultiply(this._q2.setFromAxisAngle(this._ax.set(t.fz, 0, -t.fx), ang));
      }
      this._sc.setScalar(t.sc);                                 // size is fixed; only the alpha changes
      this.treeAlpha.array[i] = v;
      this._m.compose(this._pos.set(t.x, 0, t.z), this._q, this._sc);
      this.trunks.setMatrixAt(i, this._m); this.leaves.setMatrixAt(i, this._m);
    }
    if (dirty) { this.trunks.instanceMatrix.needsUpdate = true; this.leaves.instanceMatrix.needsUpdate = true; this.treeAlpha.needsUpdate = true; }
    return this.trees.reduce((n, t) => n + (t.vis < 0.5 ? 1 : 0), 0);
  }

  buildMarkers(level) {
    // Cover trees: same look as the jungle, but thick enough to hide a ducked Unit 07.
    this.coverTrunkMat = new THREE.MeshLambertMaterial({ color: 0x3a3226, flatShading: true });
    this.coverLeafMat = new THREE.MeshLambertMaterial({ color: 0x2a7a55, flatShading: true });
    this.chunkGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    for (const c of this.objects) {
      if (c.forest) continue;
      c.h = 10; c.aimY = 2.4; c.low = false; c.isObject = true;
      const g = new THREE.Group();
      const trunkGeo = new THREE.CylinderGeometry(c.r * 0.8, c.r * 1.15, c.h, 9); trunkGeo.translate(0, c.h / 2, 0);
      const trunk = new THREE.Mesh(trunkGeo, this.coverTrunkMat); trunk.castShadow = true; trunk.receiveShadow = true;
      const leafGeo = new THREE.ConeGeometry(2.4, 6, 8); leafGeo.translate(0, c.h + 2, 0);
      c.canopy = new THREE.Mesh(leafGeo, this.coverLeafMat);
      g.add(trunk, c.canopy);
      const p = this.toW(c.s, c.d); g.position.set(p.x, 0, p.z); g.rotation.y = c.s;
      c.mesh = g; c.maxHp = OBJECT_HP[c.kind]; c.hp = c.maxHp; c.alive = true; c.punch = 0; c.leafVis = 1;
      this.scene.add(g);
    }
    this.checkRings = level.checkpoints.map((c) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TUNE.halfWidth, 0.07, 6, 40),
        new THREE.MeshBasicMaterial({ color: COL.cyan }));
      ring.rotation.x = Math.PI / 2; ring.position.copy(this.toW(c.s, 0, 0.08));
      ring.visible = false;            // checkpoints are invisible now; they still save progress and show a toast
      this.scene.add(ring); return ring;
    });
    // Safe zones: no light shafts, no radar. Just a soft patch of light on the ground that slowly
    // breathes in and out, brightest in the middle and fading to nothing at the edge.
    this.pulses = [];
    const glowGeo = new THREE.CircleGeometry(6.5, 48); glowGeo.rotateX(-Math.PI / 2);
    const col = new THREE.Color(0x8dffc0), cols = [];
    const pos = glowGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {                      // fade toward the rim so there is no hard outline
      const k = 1 - Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / 6.5);
      cols.push(col.r * k, col.g * k, col.b * k);
    }
    glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    for (const z of level.safeZones) {
      const p = this.toW(z.s, 0, 0.05);
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.position.copy(p);
      this.scene.add(glow);
      this.pulses.push(glow);
    }
    this.pulseT = 0;
  }
  updateRadar(dt) {
    this.pulseT += dt;
    const k = 0.5 - 0.5 * Math.cos(this.pulseT * (Math.PI * 2 / 4.5));     // one slow breath every 4.5 seconds
    for (const g of this.pulses) g.material.opacity = 0.08 + 0.2 * k;
  }

  // ---- destructible cover trees
  burst(c, n, power) {
    for (let i = 0; i < n; i++) {
      const leaf = i % 3 === 2;
      const m = new THREE.Mesh(this.chunkGeo, leaf ? this.coverLeafMat : this.coverTrunkMat);
      m.position.copy(c.mesh.position); m.position.y = leaf ? 6 + Math.random() * 4 : 0.5 + Math.random() * 5;
      m.position.x += (Math.random() - 0.5) * c.r * 2; m.position.z += (Math.random() - 0.5) * c.r * 2;
      m.scale.setScalar(0.6 + Math.random() * 1.6);
      const a = Math.random() * 6.28, v = (1.5 + Math.random() * 4) * power;
      this.scene.add(m);
      this.debris.push({ m, vx: Math.cos(a) * v, vy: 2 + Math.random() * 5 * power, vz: Math.sin(a) * v, life: 1.2 + Math.random() * 0.7,
        rx: Math.random() * 8, rz: Math.random() * 8 });
    }
  }
  // Unit 07 has walked into a tree: it goes over, away from the push, and stops being an obstacle.
  // from: world position of whatever pushed it. Returns true if the tree started to fall.
  topple(c, from) {
    if (!c.alive || !c.forest) return false;
    const t = c.forest, dx = t.x - from.x, dz = t.z - from.z, len = Math.hypot(dx, dz) || 1;
    t.fx = dx / len; t.fz = dz / len; t.fall = 0.001;
    c.alive = false;
    this.level.covers = this.objects.filter((o) => o.alive);
    this.shake += 0.35;
    return true;
  }
  // Returns true when the tree comes down.
  // from: world position of the attacker; a tree that is shot or punched down falls away from it.
  damageObject(c, n = 1, from = null) {
    if (!c.alive) return false;
    c.hp -= n; c.punch = 1;
    if (c.hp > 0) { this.burst(c, n > 1 ? 8 : 1, 0.7); return false; }
    this.burst(c, 14, 1.1);
    if (c.forest && from) { this.topple(c, from); this.shake += 0.3; return true; }
    c.alive = false; c.mesh.visible = false; if (c.forest) c.forest.dead = true;
    this.level.covers = this.objects.filter((o) => o.alive);
    this.shake += 0.6;
    return true;
  }
  resetObjects(section) {
    for (const c of this.objects) if (c.section === section) { c.hp = c.maxHp; c.alive = true; c.mesh.visible = true; c.punch = 0; if (c.forest) { c.forest.dead = false; c.forest.fall = 0; } }
    this.level.covers = this.objects.filter((o) => o.alive);
  }
  // cam, robot: world positions. A cover tree's leaves pull back when they would hide Unit 07; the trunk stays.
  updateObjects(dt, cam, robot) {
    const bx = robot.x - cam.x, bz = robot.z - cam.z, len2 = bx * bx + bz * bz || 1;
    for (const c of this.objects) {
      if (!c.alive || c.forest) continue;
      c.punch = Math.max(0, c.punch - dt * 5);
      const lean = c.punch * 0.07, k = 0.8 + 0.2 * c.hp / c.maxHp;          // thins out and shudders as it takes hits
      c.mesh.scale.set(k, 1, k); c.mesh.rotation.z = lean;
      const px = c.mesh.position.x, pz = c.mesh.position.z;
      const u = Math.min(Math.max(((px - cam.x) * bx + (pz - cam.z) * bz) / len2, 0), 1.1);
      const want = Math.hypot(px - (cam.x + bx * u), pz - (cam.z + bz * u)) < 3.6 ? 0 : 1;
      c.leafVis += (want - c.leafVis) * Math.min(1, dt * 9);
      c.canopy.scale.setScalar(Math.max(0.001, c.leafVis));
      c.canopy.position.y = (1 - c.leafVis) * (c.h + 2);                  // shrink toward its own centre
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const b = this.debris[i];
      b.life -= dt; b.vy -= 18 * dt;
      b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt;
      if (b.m.position.y < 0.15) { b.m.position.y = 0.15; b.vy *= -0.3; b.vx *= 0.6; b.vz *= 0.6; }
      b.m.rotation.x += b.rx * dt; b.m.rotation.z += b.rz * dt;
      if (b.life < 0.4) b.m.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (b.life <= 0) { this.scene.remove(b.m); this.debris.splice(i, 1); }
    }
  }

  // Rail camera: rides the trail behind Unit 07, high up, looking a little ahead.
  updateCamera(camera, s, d, dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 3.2);
    this.camS += (s - this.camS) * k; this.camD += (d - this.camD) * k;
    const pos = this.toW(this.camS - 17, this.camD * 0.85, 15);        // follows Unit 07 off the trail too
    const look = this.toW(this.camS + 6, this.camD * 0.92, 1.6);
    if (this.shake > 0.001) {
      pos.x += (Math.random() - 0.5) * this.shake; pos.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    camera.position.copy(pos); camera.lookAt(look);
  }
}
