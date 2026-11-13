// A Place Above, greybox. Game loop and rules.
import * as THREE from 'three';
import { TUNE, SECTION_LEN, SECTIONS, TRAIL_LEN, FAMILY, buildLevel } from './config.js';
import { Input } from './input.js';
import { World, COL } from './world.js';
import { Unit07 } from './unit07.js';
import { Enemy, Shots, Cage, Monkey, AmmoCrate, RiflePickup } from './actors.js';
import { HUD, PilotCam, Cutscenes, Sfx } from './ui.js';
import { Post } from './post.js';
import { makeEnvironment } from './models.js';
import { Fx } from './fx.js';

const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.fog);
scene.fog = new THREE.Fog(COL.fog, 34, 100);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 200);
scene.add(new THREE.HemisphereLight(0xc4d6cc, 0x2a3326, 2.6));      // overcast jungle haze
const sun = new THREE.DirectionalLight(0xffe2b4, 3.4);             // low warm key light
const post = new Post(renderer, scene, camera);
scene.environment = makeEnvironment(renderer); scene.environmentIntensity = 0.7;       // reflections for the metal on the models
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 60 });
sun.shadow.bias = -0.002;
scene.add(sun, sun.target);

const level = buildLevel();
const world = new World(scene, level);
const player = new Unit07(scene);
const enemies = level.enemies.map((d) => new Enemy(scene, world, d));
const cages = level.cages.map((d) => new Cage(scene, world, d));
const monkeys = [];
cages.forEach((c) => { for (let i = 0; i < c.count; i++) monkeys.push(new Monkey(scene, world, c, i, level.safeZones[c.section])); });
const shots = new Shots(scene, world);
const fx = new Fx(scene);
const crates = level.ammo.map((d) => new AmmoCrate(scene, world, d));
const rifle = new RiflePickup(scene, world, 9, -1.4);            // Unit 07 lands unarmed; its rifle waits a few strides up the trail
const input = new Input(), hud = new HUD(), pilot = new PilotCam(), cuts = new Cutscenes(), sfx = new Sfx();

const G = {
  state: 'title', checkpoint: 0, riders: [], safe: 0, sectionDone: SECTIONS.map(() => false),
  ambushT: SECTIONS.map(() => -1), pendingCut: null, kits: TUNE.kits, aimHeld: false, aimAng: 0, hitT: 0, deadT: 0, safeSlot: 0, fps: 60, hiddenTrees: 0,
};
const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const dist = (a, s, d) => Math.hypot(a.s - s, a.d - d);
const show = (id, on) => $(id).classList.toggle('show', on);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.5));
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// The game opens with Unit 07 coming down out of the sky after its leap from the cliff: it falls into view,
// slams into the trail in a burst of dust, and only then does the player get control.
const DROP_HEIGHT = 36;
function beginDrop() {
  G.state = 'play'; G.drop = true;
  player.jumpY = DROP_HEIGHT; player.vy = -6;
}
// Gameplay music ("Helvv Kryd Holy Wars", instrumental, looping). It kicks in on the landing, holds under the
// action, drops low while Unit 07 is down, stops on the pause menu and fades out for the ending.
const gameMusic = new Audio('assets/audio/game_music.mp3');
gameMusic.loop = true; gameMusic.preload = 'auto'; gameMusic.volume = 0;
const MUSIC_VOL = { play: 0.42, dead: 0.16 };
function musicTick(dt) {
  if (!G.music) return;
  const want = MUSIC_VOL[G.state] || 0;
  const v = gameMusic.volume + (want - gameMusic.volume) * Math.min(1, dt * (want > gameMusic.volume ? 4 : 2.2));
  gameMusic.volume = Math.max(0, Math.min(1, Math.abs(v - want) < 0.004 ? want : v));
  if (G.state === 'paused' || (want === 0 && gameMusic.volume === 0)) { if (!gameMusic.paused) gameMusic.pause(); }
  else if (gameMusic.paused) gameMusic.play().catch(() => {});
}
const LAND_HOLD = 1.0, LAND_RISE = 0.7;                                 // seconds held in the landing pose, then seconds to stand up
function landDrop() {
  G.drop = false; G.landT = LAND_HOLD + LAND_RISE; player.land = 1;
  G.music = true; gameMusic.currentTime = 0; gameMusic.volume = MUSIC_VOL.play;       // the music hits with the landing
  const p = player.root.position;
  world.shake += 3.2; input.rumble(1, 1, 650);
  sfx.explosion(); sfx.step(true);
  for (let i = 0; i < 26; i++) {                                       // ring of dust thrown out along the ground
    const a = (i / 26) * Math.PI * 2, r = 1.5 + Math.random() * 2.5;
    fx.smoke(p.x + Math.cos(a) * r, 0.4 + Math.random() * 1.2, p.z + Math.sin(a) * r, false);
  }
  fx.sparks(p.x, 0.5, p.z, 16);
}

// Starting the game powers Unit 07 up first: the engine sound plays and its eye lights blue on the
// start screen, building until the engine catches, then the screen washes out into the opening cutscenes.
const powerClip = new Audio('assets/audio/power_up.mp3');          // engine powering on, with a combustion burst about 4.4 s in
powerClip.preload = 'auto'; powerClip.volume = 0.9;
const POWER_HIT = 4400;                                             // ms into the clip where the engine catches
let powering = false;
function start() {
  if (G.state !== 'title' || powering || $('title').classList.contains('gate')) return;      // the gate's own press only wakes the screen
  powering = true; dispatchEvent(new Event('title-start'));
  sfx.init(); $('title').classList.add('powered'); input.rumble(0.3, 0.7, POWER_HIT);
  powerClip.currentTime = 0;
  powerClip.play().catch(() => sfx.powerUp());                       // the built-in synth stands in if the clip cannot play
  setTimeout(() => input.rumble(1, 1, 500), POWER_HIT);
  setTimeout(() => {
    show('title', false);
    G.state = 'cutscene';
    cuts.play(['film'], beginDrop);                                   // the short film ends on the leap from the cliff; the game opens on the landing
  }, POWER_HIT + 500);                                               // the screen washes out on the burst; the clip's tail rings on into the cutscene
}
$('start').addEventListener('click', start);
// "Press any button to start": any key, any mouse click on the start screen, or any controller button.
addEventListener('keydown', (e) => {
  if (G.state !== 'title' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.code === 'KeyM') return;      // M is the music switch, not a start press
  start();
});      // a key still held down does not count
$('title').addEventListener('pointerdown', start);
let padArmed = false;            // a button still held from before the start screen appeared (such as the one used to exit) does not count
function anyPadButton() {
  let down = false;
  for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.buttons.some((b) => b.pressed)) down = true;
  if (!down) { padArmed = true; return false; }
  return padArmed;
}
$('resume').addEventListener('click', () => togglePause(false));
$('again').addEventListener('click', () => location.reload());
// Leaving a game in progress: back to the start screen (the page starts over, so progress is not kept).
const exitToStart = () => location.reload();       // the page starts over: back to the start screen, progress is not kept
$('quit').addEventListener('click', exitToStart);
// Pause menu: Resume or Quit game. The D-pad (or arrow keys, or A/D) moves between them and Cross (or Enter)
// confirms. Quitting goes back to the start screen. Options / Esc always resumes.
const PAUSE_ITEMS = ['resume', 'music-toggle', 'quit'];
let pauseSel = 0, padPrev = {};
function setPauseSel(i) {
  pauseSel = (i + PAUSE_ITEMS.length) % PAUSE_ITEMS.length;
  PAUSE_ITEMS.forEach((id, k) => $(id).classList.toggle('sel', k === pauseSel));
}
function confirmPause() {
  const id = PAUSE_ITEMS[pauseSel];
  if (id === 'resume') togglePause(false); else if (id === 'music-toggle') setMusic(!musicOn); else exitToStart();
}

// Music on / off (sound effects are not affected). Remembered between visits. M toggles it at any time;
// the pause menu has it as an option, and the start screen shows the current setting.
let musicOn = true;
try { musicOn = localStorage.getItem('apa-music') !== 'off'; } catch { /* storage unavailable: music stays on */ }
function setMusic(on) {
  musicOn = on;
  try { localStorage.setItem('apa-music', on ? 'on' : 'off'); } catch { /* not remembered */ }
  gameMusic.muted = !on;
  $('music-toggle').textContent = on ? 'Music: on' : 'Music: off';
  $('title-music').innerHTML = `M &nbsp;·&nbsp; MUSIC: ${on ? 'ON' : 'OFF'}`;
  dispatchEvent(new CustomEvent('music-set', { detail: on }));      // the start screen's music follows (titlefx.js)
}
addEventListener('keydown', (e) => { if (!e.repeat && e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey) setMusic(!musicOn); });
$('music-toggle').addEventListener('click', () => setMusic(!musicOn));
function padEdge(i) {                       // a controller button going down this frame (12 up, 13 down, 14 left, 15 right)
  let down = false;
  for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.buttons[i] && p.buttons[i].pressed) down = true;
  const edge = down && !padPrev[i]; padPrev[i] = down; return edge;
}
function pauseMenu(inp) {
  const prev = padEdge(14) || padEdge(12), next = padEdge(15) || padEdge(13);
  if (inp.pause) togglePause(false);
  else if (prev) setPauseSel(pauseSel - 1);
  else if (next) setPauseSel(pauseSel + 1);
  else if (inp.confirm) confirmPause();
}
addEventListener('keydown', (e) => {
  if (e.repeat || G.state !== 'paused') return;
  if (['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(e.code)) setPauseSel(pauseSel - 1);
  else if (['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(e.code)) setPauseSel(pauseSel + 1);
});
PAUSE_ITEMS.forEach((id, i) => $(id).addEventListener('mouseenter', () => setPauseSel(i)));
setMusic(musicOn);

function togglePause(on) {
  if (on && G.state === 'play') { G.state = 'paused'; show('pause', true); setPauseSel(0); padEdge(12); padEdge(13); padEdge(14); padEdge(15); }
  else if (!on && G.state === 'paused') { G.state = 'play'; show('pause', false); }
}

function hideWarn() { $('reload-warn').classList.remove('show'); }

function respawn() {
  const i = G.checkpoint;
  enemies.forEach((e) => { if (e.section === i) e.reset(); });
  G.riders = G.riders.filter((m) => m.section !== i);
  let reset = 0;
  monkeys.forEach((m) => { if (m.section === i && m.state !== 'safe' && m.state !== 'toSafe') { m.reset(); reset++; } });
  if (reset) cages[i].reset();
  G.ambushT[i] = -1; shots.clear(); world.resetObjects(i); fx.clear();
  crates.forEach((c) => { if (c.section === i) c.reset(); });
  const ammoKept = player.ammo;
  player.reset(level.checkpoints[i].s, 0);
  player.ammo = ammoKept; G.kits = TUNE.kits;                    // bullets only come back from ammo crates
  world.updateCamera(camera, player.s, player.d, 0, true);
  show('fade', false); G.state = 'play'; player.root.visible = true;
}

function hitPlayer() {
  if (G.state !== 'play') return;
  if (player.invuln > 0) {                              // the rest of a burst still rattles off the armour
    if (G.hitT > 0) { sfx.clang(0.6); fx.sparks(player.root.position.x + (Math.random() - 0.5), 2.5 + Math.random() * 1.5, player.root.position.z + (Math.random() - 0.5), 3); }
    return;
  }
  player.hull--; player.invuln = 0.9; player.hitFlash = 1; G.hitT = 0.8;
  world.shake += 1.0; input.rumble(1, 1, 350); sfx.hit();
  fx.sparks(player.root.position.x + (Math.random() - 0.5), 2.5 + Math.random() * 1.5, player.root.position.z + (Math.random() - 0.5), 6);
  if (player.hull <= 0) {
    // Unit 07 goes up
    const pp = player.root.position;
    fx.explosion(pp.x, 2.2, pp.z); fx.explosion(pp.x + 0.8, 3.6, pp.z - 0.5); sfx.explosion();
    world.shake += 2; input.rumble(1, 1, 700); player.root.visible = false;
    hideWarn(); G.state = 'dead'; G.deadT = 2.4; setTimeout(() => show('fade', true), 900); return;
  }
  const m = G.riders.pop();
  if (m) { m.drop(player); hud.toast('A monkey fell off!'); }
}

// Something took damage: n = 1 for a rifle round, more for a punch.
function hitEnemy(e, n = 1) {
  if (e.isObject) {
    if (n > 1 || (G.hitSnd = (G.hitSnd || 0) + 1) % 5 === 0) sfx.clank();
    if (world.damageObject(e, n, player.root.position)) { sfx.hit(); input.rumble(0.6, 0.8, 200); }
    return;
  }
  // sparks fly off the armour where it is hit
  fx.sparks(e.base.x + (Math.random() - 0.5) * 1.1, 1.5 + Math.random() * 1.6, e.base.z + (Math.random() - 0.5) * 0.9, n > 1 ? 14 : 3);
  if (n > 1) sfx.clank(); else sfx.ping();                 // every round that lands is heard
  if (e.damage(n)) {
    // it blows apart
    e.exploded = true;
    fx.explosion(e.base.x, 1.8, e.base.z); sfx.explosion();
    world.shake += 1.4; input.rumble(1, 1, 450);
    const left = enemies.filter((o) => o.section === e.section && o.kind === 'guard' && o.alive).length;
    if (e.kind === 'guard' && left === 0 && !cages[e.section].open) hud.toast('Guards out. Shut off the fence');
  }
}

addEventListener('gamepadconnected', () => { hud.toast('Controller connected'); $('pad').textContent = 'Controller connected'; $('pad').classList.add('on'); });
addEventListener('gamepaddisconnected', () => { $('pad').textContent = 'No controller: press a button on it'; $('pad').classList.remove('on'); });

// Free aim, no auto aim. Right stick: the rifle points where the stick points and holds that
// heading (R3 lets it follow movement again). Mouse: the rifle points at the cursor.
const ray = new THREE.Raycaster(), aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.8), V3 = new THREE.Vector3();
function aimAngle(inp) {
  if (inp.aimClear) { G.aimHeld = false; input.mouseAim = false; }
  if (inp.aiming) { G.aimAng = Math.atan2(inp.ax, inp.ay); G.aimHeld = true; }
  else if (inp.mouseAim) {
    ray.setFromCamera({ x: inp.mx / innerWidth * 2 - 1, y: -(inp.my / innerHeight) * 2 + 1 }, camera);
    if (ray.ray.intersectPlane(aimPlane, V3)) {
      const m = world.toTrail(V3, player.s);
      G.aimAng = Math.atan2(m.d - player.d, m.s - player.s); G.aimHeld = true;
    }
  }
  return G.aimHeld ? G.aimAng : null;
}

function play(dt, inp) {
  // The opening drop: no control while it falls, holds the superhero landing, and stands up.
  if (G.drop) player.land = Math.min(1, Math.max(0, 1 - player.jumpY / 9));          // folds into the landing pose over the last metres
  else if (G.landT > 0) {
    G.landT -= dt; player.land = Math.min(1, Math.max(0, G.landT / LAND_RISE));
    if (G.landT <= 0) { player.land = 0; hud.toast(player.armed ? 'Follow the trail' : 'Find your rifle', 3); }
  }
  if (G.drop || G.landT > 0) inp = Object.fromEntries(Object.entries(inp).map(([k, v]) => [k, typeof v === 'number' ? 0 : false]));
  let prompt = '';
  const sec = Math.min(SECTIONS.length - 1, Math.max(0, Math.floor(player.s / SECTION_LEN)));

  // checkpoints
  for (const c of level.checkpoints) {
    if (player.s >= c.s && c.section >= G.checkpoint && !c.hit) {
      c.hit = true; G.checkpoint = c.section;
      world.checkRings[c.section].material.color.set(COL.gold);
      if (c.section > 0) hud.toast('Checkpoint');
    }
  }

  // movement, with a soft gate at any cage that is still locked
  let maxS = TRAIL_LEN + 0.5, gated = false;
  for (let i = 0; i < cages.length; i++) if (!cages[i].open) { maxS = level.gates[i]; gated = true; break; }
  player.freeAim = aimAngle(inp);
  const steps = player.update(dt, inp, world, level, maxS);
  world.updateObjects(dt, camera.position, player.chest(V2));
  if (steps > 0) {
    world.shake += player.hurrying ? 0.34 : 0.22;
    input.rumble(0.12, player.hurrying ? 0.5 : 0.32, 90); sfx.step(player.hurrying);
  }
  if (gated && player.s > maxS - 0.3 && inp.y > 0.3) prompt = 'Free the family before moving on';
  if (player.bumped && world.topple(player.bumped, player.root.position)) { sfx.punch(); input.rumble(0.5, 0.9, 260); }
  if (player.dashed) { sfx.whoosh(); input.rumble(0.7, 0.4, 140); world.shake += 0.3; }
  if (player.jumped) { sfx.whoosh(); input.rumble(0.5, 0.3, 120); }
  if (player.landed) { if (G.drop) landDrop(); else { sfx.step(true); input.rumble(0.6, 1, 200); world.shake += 0.9; } }
  if (inp.runToggle) hud.toast(player.run ? 'Boost on' : 'Boost off', 1);

  // repair kit
  if (inp.repair) {
    if (G.kits > 0 && player.hull < TUNE.hull) {
      G.kits--; player.hull = Math.min(TUNE.hull, player.hull + TUNE.kitHeal);
      sfx.chime(); input.rumble(0.3, 0.3, 200); hud.toast('Repaired');
    } else hud.toast(G.kits > 0 ? 'Hull is full' : 'No repair kits left', 1.2);
  }
  $('kits').textContent = G.kits;

  // the rifle on the trail: walking up to it arms Unit 07
  rifle.update(dt);
  if (!player.armed && !rifle.taken && !G.drop && !(G.landT > 0) && dist(rifle, player.s, player.d) < 2.9) {
    rifle.take(); player.armed = true; player.armUp = 1;
    sfx.clank(); sfx.chime(); input.rumble(0.5, 0.8, 250); world.shake += 0.4;
    hud.toast('Rifle acquired', 2.4);
  }

  // ammo crates: the only way to refill the rifle
  for (const c of crates) {
    c.update(dt);
    if (!c.taken && player.ammo < TUNE.ammoMax && dist(c, player.s, player.d) < 2.2) {
      c.taken = true; c.mesh.visible = false; player.ammo = TUNE.ammoMax;
      sfx.chime(); input.rumble(0.3, 0.3, 150); hud.toast('Ammo refilled');
    }
  }
  $('reload-warn').classList.toggle('show', player.armed && player.ammo <= 0);

  // punch: hits the nearest bad robot or tree within reach
  if (inp.punch) {
    let near = null, nd = TUNE.punchReach;
    for (const e of enemies) { const dd = dist(e, player.s, player.d); if (e.alive && e.rise >= 1 && dd < nd) { near = e; nd = dd; } }
    if (!near) for (const c of level.covers) { const dd = dist(c, player.s, player.d) - c.r; if (dd < nd - 0.6) { near = c; nd = dd + 0.6; } }
    if (player.startPunch(near)) sfx.whoosh();
  }
  if (player.punchLanded) {
    const t = player.punchTarget;
    const ok = t && (t.isObject ? t.alive : t.alive) && dist(t, player.s, player.d) < TUNE.punchReach + (t.isObject ? t.r : 0.4);
    if (ok) {
      hitEnemy(t, t.isObject ? TUNE.punchTree : TUNE.punchRobot);
      sfx.punch(); world.shake += 0.9; input.rumble(0.9, 1, 220);
    }
  }

  // rifle: rapid fire, every round a visible tracer
  // Each round leaves the muzzle and flies along the barrel, wherever the rifle is pointing right now.
  if (inp.shoot && player.tryFire()) {
    player.pose(0, world);                                     // refresh the arm so the muzzle is where it is drawn
    const mz = player.muzzle(V), br = player.breech(V3);
    const ang = Math.atan2(mz.x - br.x, mz.z - br.z) + (Math.random() - 0.5) * 2 * TUNE.spread;     // world heading of the barrel
    shots.bullet(player.root.position, mz, Math.sin(ang), Math.cos(ang), TUNE.playerShot, enemies, level.covers, hitEnemy);
    sfx.shoot();
    if ((G.shotSnd = (G.shotSnd || 0) + 1) % 4 === 0) fx.wisp(mz.x, mz.y, mz.z);
    input.rumble(0.25, 0.1, 50); world.shake += 0.035;
  }

  // bad robots
  for (let i = 0; i < SECTIONS.length; i++) {
    if (G.ambushT[i] > 0 && (G.ambushT[i] -= dt) <= 0) {
      enemies.forEach((e) => { if (e.section === i && e.kind === 'ambush') e.wake(); });
      hud.toast('Ambush! Hold on');
    }
  }
  for (const e of enemies) {
    const engaged = player.s > e.section * SECTION_LEN + 2 && !e.waiting && player.armed;      // nothing comes for Unit 07 until it is armed
    const fired = e.update(dt, world, player, level.covers, engaged, enemies);
    if (e.meleeHit) { sfx.punch(); hitPlayer(); }
    if (fired) {
      // one round of its burst: from the rifle's muzzle toward Unit 07, with some scatter
      const pp = player.root.position, ex = pp.x - e.base.x, ez = pp.z - e.base.z, el = Math.hypot(ex, ez) || 1, sc = TUNE.enemySpread;
      const mo = e.muzzleOut();
      shots.spawn(e.base.x + ex / el * mo, e.muzzleY(), e.base.z + ez / el * mo,
        pp.x + (Math.random() - 0.5) * 2 * sc, player.aimY - 0.6 + (Math.random() - 0.5) * sc, pp.z + (Math.random() - 0.5) * 2 * sc, TUNE.enemyShot);
      sfx.enemyShoot();
    }
  }
  shots.update(dt, player, level.covers, enemies, hitPlayer, hitEnemy);

  // damaged bad robots smoke; badly damaged ones pour black smoke and flame
  for (const e of enemies) {
    if (!e.alive || e.hp > TUNE.enemyHp * 0.55 || !e.mesh.visible) continue;
    const heavy = e.hp <= TUNE.enemyHp * 0.25;
    if ((e.smokeT -= dt) <= 0) { e.smokeT = heavy ? 0.07 : 0.16; fx.smoke(e.base.x, 2.5 + Math.random() * 0.9, e.base.z, heavy); }
  }

  // Unit 07 smokes when its hull is low, and burns when it is nearly gone
  if (player.hull <= 2 && (G.smokeT = (G.smokeT || 0) - dt) <= 0) {
    const heavy = player.hull <= 1; G.smokeT = heavy ? 0.06 : 0.15;
    fx.smoke(player.root.position.x, 3.4 + Math.random() * 0.8 + player.jumpY, player.root.position.z, heavy);
  }

  // laser sight: a thin beam that stops, with a dot, on the first thing in its path
  {
    const mz = player.muzzle(V), br = player.breech(V3), dx = mz.x - br.x, dz = mz.z - br.z, L = Math.hypot(dx, dz) || 1;
    let len = 26, hit = false;
    for (let t = 0.3; t < 26; t += 0.3) if (shots.touch(mz.x + dx / L * t, mz.z + dz / L * t, enemies, level.covers)) { len = t; hit = true; break; }
    player.setLaser(len, hit);
  }
  if (G.state !== 'play') return;

  // cages
  for (const c of cages) {
    c.update(dt);
    if (c.open || dist(c, player.s, player.d) > 4.8) continue;
    const guards = enemies.filter((e) => e.section === c.section && e.kind === 'guard' && e.alive).length;
    if (guards > 0) { prompt = 'Knock out the bad robots first'; continue; }
    prompt = 'Press E or Triangle to shut off the fence';
    if (inp.free) {
      c.open = true; sfx.chime(); input.rumble(0.3, 0.3, 150);
      monkeys.forEach((m) => { if (m.cage === c && m.state === 'caged') { G.riders.push(m); m.climbOn(); } });
      G.ambushT[c.section] = 1.8;
      hud.toast('They climb on. Get to the clearing');
    }
  }

  // safe zones
  let inSafe = false;
  for (const z of level.safeZones) {
    const dz = dist(z, player.s, player.d);
    if (dz < 5) inSafe = true;
    if (dz < z.r && G.riders.length) {
      G.riders.forEach((m) => m.goSafe(G.safeSlot++, z));
      G.riders = [];
    }
  }

  // monkeys
  let loose = false;
  for (const m of monkeys) {
    if (m.update(dt, player, G.riders.indexOf(m)) === 'arrived') {
      G.safe++; sfx.chime();
      const i = m.section, all = monkeys.filter((o) => o.section === i).every((o) => o.state === 'safe');
      hud.toast(`${G.safe} / ${FAMILY} safe`);
      if (all && !G.sectionDone[i]) {
        G.sectionDone[i] = true;
        if (G.safe >= FAMILY) G.pendingCut = { t: 1.3, id: 'home' };       // only the ending is a full screen cutscene
      }
    }
    if (m.state === 'loose') {
      loose = true;
      if (m.t >= 1 && m.grace <= 0 && Math.hypot(m.ls - player.s, m.ld - player.d) < 2.4) { G.riders.push(m); m.climbOn(); sfx.chime(); }
    }
  }
  if (loose && !prompt) prompt = 'A monkey fell off. Walk back and pick it up';

  if (G.pendingCut && (G.pendingCut.t -= dt) <= 0) {
    const id = G.pendingCut.id; G.pendingCut = null; G.state = 'cutscene'; hideWarn();
    hud.setReticle(0, 0, false);
    cuts.play([id], () => {
      if (id === 'home') { G.state = 'end'; show('end', true); } else G.state = 'play';
    });
  }

  // pilot cam follows the game state
  G.hitT = Math.max(0, G.hitT - dt);
  pilot.set(G.hitT > 0 ? 'hit' : player.armUp > 0.2 ? 'shoot' : player.dashT > 0 ? 'dodge' : player.jumpY > 0 ? 'jump' : player.hull <= 1 ? 'low'
    : inSafe ? 'safe' : G.riders.length ? 'aboard' : player.hurrying ? 'hurry' : player.moving ? 'walk' : 'idle');

  hud.setPrompt(prompt);
  hud.set(player.hull, player.armed ? player.ammo : null, G.riders.length, G.safe);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  G.fps += (1 / Math.max(dt, 0.001) - G.fps) * 0.05;
  const inp = input.poll();

  if (G.state === 'title') { if (inp.confirm || anyPadButton()) start(); }
  else if (G.state === 'cutscene') cuts.update(dt, inp.confirm);
  else if (G.state === 'paused') pauseMenu(inp);
  else if (G.state === 'dead') { if ((G.deadT -= dt) <= 0) respawn(); }
  else if (G.state === 'play') { if (inp.pause) togglePause(true); else play(dt, inp); }

  musicTick(dt);
  hud.update(dt);
  world.updateRadar(dt);
  if (G.state !== 'paused') fx.update(dt);
  world.updateCamera(camera, player.s, player.d, dt, false);
  player.chest(V2);
  G.hiddenTrees = world.updateTrees(camera.position, V2, dt);
  sun.position.set(V2.x + 10, 24, V2.z + 9); sun.target.position.copy(V2);
  post.render(dt);
  requestAnimationFrame(frame);
}

player.pose(0, world);
world.updateCamera(camera, player.s, player.d, 0, true);
hud.set(player.hull, null, 0, 0);
requestAnimationFrame(frame);

// Handy in the console while tuning: __game.warp(40), __game.G, __game.player
window.__game = { G, player, enemies, cages, monkeys, shots, level, world, renderer, FAMILY, fx, sfx,
  warp(s) { cages.forEach((c) => { if (level.gates[c.section] < s) c.open = true; }); player.s = s; world.updateCamera(camera, s, player.d, 0, true); } };
