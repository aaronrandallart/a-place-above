// HUD, pilot cam, full screen cutscene player and tiny synth sounds.
import { TUNE, FAMILY, CUTSCENES, PILOT } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.hull = $('hull'); this.ammo = $('ammo'); this.back = $('back'); this.safe = $('safe');
    this.prompt = $('prompt'); this.toastEl = $('toast'); this.reticle = $('reticle');
    this.hull.innerHTML = '<i></i>'.repeat(TUNE.hull);
    this.toastT = 0; this.last = '';
  }
  set(hull, ammo, back, safe) {
    const key = `${hull}|${ammo}|${back}|${safe}`;
    if (key === this.last) return; this.last = key;
    [...this.hull.children].forEach((e, i) => e.classList.toggle('on', i < hull));
    this.ammo.textContent = ammo === null ? '----' : ammo;                  // null: no rifle yet
    this.ammo.parentElement.classList.toggle('dry', ammo !== null && ammo <= 0);
    this.ammo.parentElement.classList.toggle('lowammo', ammo !== null && ammo > 0 && ammo <= 300);
    this.back.textContent = back;
    this.safe.textContent = `${safe} / ${FAMILY}`;
    this.hull.parentElement.classList.toggle('low', hull <= 1);
  }
  setPrompt(text) { if (this.prompt.textContent !== text) this.prompt.textContent = text; this.prompt.classList.toggle('show', !!text); }
  toast(text, secs = 2.2) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); this.toastT = secs; }
  setReticle(x, y, show, isObject = false, manual = false) {
    this.reticle.style.display = show ? 'block' : 'none';
    this.reticle.classList.toggle('obj', isObject);
    this.reticle.classList.toggle('manual', manual);
    if (show) this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }
  update(dt) { if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.toastEl.classList.remove('show'); }
}

// Cockpit window: one looping clip (or colored placeholder card) per game state. Several states can share
// a clip. Every clip was generated from the same first frame, so that shared opening is trimmed out of each
// file and the clips simply loop. Each clip has its own preloaded <video>, so switching is instant, and the
// monitor flickers with static whenever the reaction changes.
export class PilotCam {
  constructor() {
    this.root = $('pilot'); this.card = $('pilot-card'); this.label = $('pilot-label');
    const first = $('pilot-video'); this.clips = new Map(); this.shown = null; this.state = null;
    for (const def of Object.values(PILOT)) {
      if (!def.src || this.clips.has(def.src)) continue;
      const v = this.clips.size ? first.cloneNode() : first;        // reuse the element already in the page for the first clip
      v.removeAttribute('id'); v.className = 'pilot-clip'; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = def.src;
      v.addEventListener('error', () => { v.dataset.bad = '1'; v.style.display = 'none'; });       // a missing clip falls back to its card
      if (v !== first) first.after(v);
      this.clips.set(def.src, v);
    }
    if (!this.clips.size) first.style.display = 'none';
    this.set('idle');
  }
  set(state) {
    if (state === this.state) return;
    this.state = state;
    const def = PILOT[state], next = def.src ? this.clips.get(def.src) : null;
    this.card.style.background = def.color; this.label.textContent = def.label;
    if (next === this.shown) return;                            // same clip as the state before: keep it running
    if (this.shown) { this.shown.pause(); this.shown.style.display = 'none'; }
    this.shown = next && !next.dataset.bad ? next : null;
    if (this.shown) {
      if (def.restart) this.shown.currentTime = 0;              // one-off reactions (a hit) play from their first frame each time
      this.shown.style.display = 'block'; this.shown.play().catch(() => {});
    }
    this.root.classList.remove('switch'); void this.root.offsetWidth; this.root.classList.add('switch');     // static flicker
  }
}

// Full screen player. Plays a clip if the cutscene has one, otherwise a placeholder card.
export class Cutscenes {
  constructor() {
    this.root = $('cutscene'); this.video = $('cs-video'); this.cardEl = $('cs-card');
    this.title = $('cs-title'); this.note = $('cs-note'); this.tag = $('cs-tag'); this.bar = $('cs-bar');
    this.queue = []; this.active = false; this.t = 0; this.dur = 0; this.guard = 0; this.done = null; this.current = null;
    $('cs-skip').addEventListener('click', () => this.skip());
    this.video.addEventListener('ended', () => this.next());
    this.video.addEventListener('error', () => { if (this.active && this.usingVideo) this.showCard(this.current); });
  }
  play(ids, done) {
    this.queue = ids.map((id) => CUTSCENES.find((c) => c.id === id)).filter(Boolean);
    this.done = done; this.active = true; this.root.classList.add('show');
    this.next();
  }
  next() {
    const c = this.queue.shift();
    if (!c) return this.finish();
    this.current = c; this.guard = 0.5;
    if (c.src) {
      this.usingVideo = true; this.cardEl.style.display = 'none'; this.video.style.display = 'block';
      this.video.src = c.src; this.video.currentTime = 0;
      this.video.play().catch(() => this.showCard(c));
    } else this.showCard(c);
  }
  showCard(c) {
    this.usingVideo = false; this.video.pause(); this.video.style.display = 'none'; this.cardEl.style.display = 'flex';
    this.tag.textContent = `CUTSCENE ${CUTSCENES.indexOf(c)} · PLACEHOLDER`;
    this.title.textContent = c.title; this.note.textContent = c.note;
    this.t = 0; this.dur = 4;
  }
  skip() { if (this.active && this.guard <= 0) { this.video.pause(); this.next(); } }
  finish() {
    this.active = false; this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.root.classList.remove('show');
    const d = this.done; this.done = null; if (d) d();
  }
  update(dt, confirm) {
    if (!this.active) return;
    this.guard = Math.max(0, this.guard - dt);
    if (confirm) return this.skip();
    if (!this.usingVideo) {
      this.t += dt; this.bar.style.width = `${Math.min(100, this.t / this.dur * 100)}%`;
      if (this.t >= this.dur) this.next();
    }
  }
}

// Synth stand-ins until real audio lands in assets/audio.
export class Sfx {
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } } }
  tone(freq, to, dur, gain, type = 'sine') {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
  }
  // Filtered noise burst: the body of gunshots, impacts and explosions.
  noise(dur, gain, type, freq, q = 0.8, delay = 0) {
    const c = this.ctx; if (!c) return;
    if (!this.noiseBuf) {
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + delay;
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t, Math.random() * 1.5, dur + 0.05);
  }
  step(heavy) { this.tone(70, 30, 0.22, heavy ? 0.5 : 0.35); }
  // Rifle round: a sharp crack, a chest thump underneath, the action cycling, and a short tail rolling off into the trees.
  shoot() {
    const v = 0.9 + Math.random() * 0.2;
    this.noise(0.07, 0.34, 'bandpass', 2300 * v, 0.7);
    this.noise(0.11, 0.22, 'lowpass', 900 * v, 0.5);
    this.tone(170 * v, 48, 0.08, 0.3);
    this.noise(0.02, 0.07, 'highpass', 5200, 0.9, 0.035);
    this.noise(0.3, 0.05, 'lowpass', 520, 0.4, 0.03);
  }
  // A round striking a bad robot's armour.
  ping() { this.clang(1); }
  // A bad robot going up.
  explosion() {
    this.noise(0.9, 0.85, 'lowpass', 420, 0.5); this.noise(0.28, 0.5, 'bandpass', 1500, 0.6);
    this.tone(95, 24, 0.75, 0.9); this.noise(1.6, 0.14, 'lowpass', 240, 0.3, 0.12);
  }
  // Unit 07 powering up from the start screen: a relay clunk, a reactor hum that climbs and swells,
  // a turbine whine rising over it, servo chatter, and a heavy lock-in thump at the end. About two seconds.
  powerUp() {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, out = c.destination;
    const voice = (type, f0, f1, dur, peak, attack, cutoff) => {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff * 0.4, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.setValueAtTime(peak, t + dur - 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
      o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.3);
    };
    this.noise(0.09, 0.55, 'lowpass', 320, 0.7); this.tone(70, 38, 0.16, 0.5);                 // relay clunk
    voice('sawtooth', 34, 118, 1.7, 0.3, 1.3, 900);                                             // reactor hum
    voice('sawtooth', 51, 177, 1.7, 0.16, 1.4, 1400);                                           // its fifth, for body
    voice('sine', 240, 1750, 1.6, 0.07, 1.2, 6000);                                             // turbine whine
    for (let i = 0; i < 5; i++) this.noise(0.035, 0.12, 'bandpass', 2400 + i * 300, 3, 0.35 + i * 0.16);      // servos stepping
    this.noise(0.5, 0.22, 'bandpass', 900, 0.4, 1.1);                                           // air rushing as it comes up
    setTimeout(() => { this.tone(96, 34, 0.45, 0.8); this.noise(0.14, 0.5, 'lowpass', 420, 0.6); this.noise(0.05, 0.2, 'highpass', 3200, 0.8); }, 1700);   // lock-in
  }
  punch() { this.tone(90, 28, 0.3, 0.6, 'triangle'); }
  whoosh() { this.tone(300, 90, 0.18, 0.08, 'sawtooth'); }
  // A bad robot's rifle: the same shot, further away and a little duller.
  enemyShoot() {
    const v = 0.8 + Math.random() * 0.15;
    this.noise(0.08, 0.22, 'bandpass', 1700 * v, 0.7); this.noise(0.12, 0.16, 'lowpass', 700 * v, 0.5); this.tone(140 * v, 45, 0.09, 0.2);
  }
  // A round hitting armour plate: no ringing tones, just a hard dry smack with a knock under it, like a
  // bullet slapping thick steel. Loud enough, and pitched between the rifle's crack and its thump, to be
  // heard through the gunfire it always plays alongside.
  clang(gain = 1) {
    const v = 0.85 + Math.random() * 0.3;
    this.noise(0.06, 0.5 * gain, 'bandpass', 950 * v, 2.2);          // the smack
    this.noise(0.025, 0.3 * gain, 'highpass', 4200, 0.8);            // hard tick on the front
    this.tone(260 * v, 110, 0.09, 0.4 * gain, 'triangle');           // the plate knocking
  }
  // Unit 07 taking a round: the same smack, heavier, with the hull booming.
  hit() { this.clang(1.5); this.tone(95, 30, 0.35, 0.45); }
  clank() { this.tone(300, 80, 0.2, 0.25, 'triangle'); }
  chime() { this.tone(660, 990, 0.35, 0.2); }
}
