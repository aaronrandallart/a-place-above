// Tuning, level layout and video manifests. Everything a designer would tweak lives here.

export const TUNE = {
  walk: 2.2, hurry: 4.0,                     // hurry = boost speed
  dashSpeed: 16, dashTime: 0.22, dashCd: 0.7,   // quick boost: a short dodge with a moment of invulnerability
  jumpV: 11, gravity: 22,                     // booster jump, about 2.7 m high
  kits: 3, kitHeal: 2,                        // repair kits
  halfWidth: 3,            // the trail itself is 6 m wide
  roam: 21,                // Unit 07 can walk this far off the trail centre, into the jungle
  hull: 5, popTime: 0.6,
  ammoMax: 3000, fireCd: 0.07, spread: 0.035,          // assault rifle: about 14 rounds a second
  punchTime: 0.4, punchCd: 0.65, punchReach: 3.7, punchRobot: 12, punchTree: 20,
  enemySpeed: 1.7, enemyMeleeRange: 2.9, enemyMeleeWindup: 0.55, enemyMeleeCd: 1.4,   // (melee values unused: bad robots only shoot now)
  enemyHp: 24, charge: 0.9, enemyCd: 2.6, enemyShot: 26, enemyRange: 20,       // charge = time spent levelling the rifle before a burst
  enemyHold: 9, enemyBurst: 4, enemyBurstGap: 0.1, enemySpread: 1.0,                          // rounds per burst, seconds between them, metres of scatter
  playerShot: 40, lockRange: 30,
  coverH: 3.2,
};

export const OBJECT_HP = { tree: 40, forest: 24 };      // forest = the ordinary jungle trees off the trail

export const SECTION_LEN = 30;
export const SECTIONS = [
  { guards: 1, ambush: 1, cage: 1 },
  { guards: 2, ambush: 1, cage: 2 },
  { guards: 2, ambush: 2, cage: 2 },
  { guards: 3, ambush: 2, cage: 2 },
  { guards: 4, ambush: 2, cage: 2 },
];
export const TRAIL_LEN = SECTION_LEN * SECTIONS.length;      // 150 m
export const FAMILY = SECTIONS.reduce((n, s) => n + s.cage, 0);

// Offsets inside one 30 m section. s = metres along the trail, side = which trail edge.
const GUARD_SLOTS = [{ ds: 11, side: -1 }, { ds: 15, side: 1 }, { ds: 14.5, side: -1 }, { ds: 10.5, side: 1 }];
const AMBUSH_SLOTS = [{ ds: 22, side: -1 }, { ds: 21.5, side: 1 }];

export function buildLevel() {
  const L = { checkpoints: [], covers: [], ammo: [], cages: [], enemies: [], safeZones: [], gates: [] };
  SECTIONS.forEach((sec, i) => {
    const base = i * SECTION_LEN, side = i % 2 ? -1 : 1;
    L.checkpoints.push({ s: base + 1.5, section: i });
    // No trees stand on the trail itself. The jungle on either side is the cover.
    L.ammo.push({ s: base + 15.5, d: -side * 2, section: i });      // ammo crate: the only way to refill
    L.cages.push({ s: base + 13, d: side * 4.7, section: i, count: sec.cage });
    for (let k = 0; k < sec.guards; k++) {
      const g = GUARD_SLOTS[k];
      L.enemies.push({ s: base + g.ds, d: g.side * side * 4.8, section: i, kind: 'guard' });
    }
    for (let k = 0; k < sec.ambush; k++) {
      const a = AMBUSH_SLOTS[k];
      L.enemies.push({ s: base + a.ds, d: a.side * side * 14, section: i, kind: 'ambush' });   // waits back in the jungle
    }
    L.gates.push(base + 16.5);                 // cannot pass until the cage is open
    L.safeZones.push({ s: base + 27, d: 0, r: 3.2, section: i });
  });
  return L;
}

// ---- Video hooks -----------------------------------------------------------
// Set src to a file under assets/video/ to replace a placeholder card with a real clip.

export const CUTSCENES = [
  { id: 'film',   title: 'A Place Above',    note: 'The short film',                                   src: 'assets/video/cutscenes/00_film_game.mp4' },   // game cut: ends on the leap from the cliff, no end title
  { id: 'taking', title: 'The Taking',       note: 'Bad robots carry off the family.',                 src: null },
  { id: 'seat',   title: 'Back in the Seat', note: 'The small capuchin climbs back into Unit 07.',     src: null },
  { id: 'home',   title: 'Home',             note: 'The whole family is safe.',                        src: null },
];

export const PILOT = {
  // Each state shows a clip of the capuchin in the cockpit (assets/video/pilot). States may share a clip.
  // restart: play from the first frame every time the state begins. src: null shows the coloured label card instead.
  idle:   { label: 'IDLE',           color: '#2e5d63', src: 'assets/video/pilot/calm.mp4' },
  walk:   { label: 'WALK',           color: '#3f7a5a', src: 'assets/video/pilot/calm.mp4' },
  hurry:  { label: 'BOOST',          color: '#b8862e', src: 'assets/video/pilot/thrill.mp4' },
  dodge:  { label: 'QUICK BOOST',    color: '#3b4a7a', src: 'assets/video/pilot/thrill.mp4' },
  jump:   { label: 'JUMP',           color: '#4a6fa8', src: 'assets/video/pilot/thrill.mp4' },
  shoot:  { label: 'SHOOT',          color: '#c96a1e', src: 'assets/video/pilot/firing.mp4' },
  hit:    { label: 'HIT',            color: '#b3302a', src: 'assets/video/pilot/hit.mp4', restart: true },
  aboard: { label: 'MONKEYS ABOARD', color: '#8a5a2b', src: 'assets/video/pilot/calm.mp4' },      // carrying family: steady hands
  safe:   { label: 'SAFE ZONE',      color: '#d9b24a', src: 'assets/video/pilot/cheer.mp4' },
  low:    { label: 'LOW HULL',       color: '#6b1f3a', src: 'assets/video/pilot/scared.mp4' },
};
