// Keyboard + PS5 controller (Gamepad API, standard mapping) with rumble.
const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, dup: 12, l2: 6, r2: 7, options: 9, l3: 10, r3: 11 };
const AIM_DEAD = 0.4;
const DEAD = 0.18;

export class Input {
  constructor() {
    this.keys = new Set();
    this.just = new Set();
    this.prevPad = {};
    this.padConnected = false;
    this.state = { x: 0, y: 0, ax: 0, ay: 0, aiming: false, aimClear: false, punch: false, runToggle: false, jump: false, dash: false, repair: false, shoot: false, free: false, pause: false, confirm: false };
    addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.just.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    // Mouse: aim at the cursor, hold the left button to fire (keyboard players).
    this.mouseAim = false; this.mouseDown = false; this.mx = 0; this.my = 0;
    addEventListener('mousemove', (e) => { this.mx = e.clientX; this.my = e.clientY; if (e.isTrusted) this.mouseAim = true; });
    addEventListener('mousedown', (e) => { if (e.button === 0 && e.target.tagName === 'CANVAS') this.mouseDown = true; });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') { e.preventDefault(); this.rightClick = true; } });
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  poll() {
    const k = this.keys, j = this.just, st = this.state;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    // Keyboard and mouse
    st.shoot = this.mouseDown || k.has('KeyJ');                         // right hand weapon
    st.punch = j.has('KeyF') || this.rightClick;                        // left hand melee
    st.jump = j.has('Space');
    st.dash = j.has('ShiftLeft') || j.has('ShiftRight');                // quick boost
    st.runToggle = j.has('ControlLeft') || j.has('KeyC');               // boost on / off
    st.free = j.has('KeyE');                                            // access
    st.repair = j.has('KeyR');
    st.pause = j.has('Escape');
    st.confirm = j.has('Enter');
    st.aimClear = j.has('KeyT');
    st.mouseAim = this.mouseAim; st.mx = this.mx; st.my = this.my;
    st.ax = 0; st.ay = 0; st.aiming = false;
    this.rightClick = false;

    const p = this.pad();
    this.padConnected = !!p;
    if (p) {
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > DEAD) { x += ax; y -= ay; }
      const down = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.35));
      const edge = (i) => { const d = down(i), was = this.prevPad[i]; this.prevPad[i] = d; return d && !was; };
      // Controller, laid out like Armored Core:
      //   R2 right hand weapon (rifle)   L2 left hand melee (punch; R1 also punches)
      //   Cross jump   Square quick boost   Circle boost on / off (L3 too)
      //   Triangle access (free a cage)   D-pad up repair kit   Options pause
      st.shoot = st.shoot || down(BTN.r2);
      st.punch = edge(BTN.l2) || edge(BTN.r1) || st.punch;
      st.jump = edge(BTN.cross) || st.jump;
      st.dash = edge(BTN.square) || st.dash;
      st.runToggle = edge(BTN.circle) || edge(BTN.l3) || st.runToggle;
      st.free = edge(BTN.triangle) || st.free;
      st.repair = edge(BTN.dup) || st.repair;
      st.pause = edge(BTN.options) || st.pause;
      st.confirm = down(BTN.cross) && !this.prevConfirm || st.confirm; this.prevConfirm = down(BTN.cross);
      // Right stick: free aim, the rifle points where the stick points. R3 lets the aim follow movement again.
      const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      if (Math.hypot(rx, ry) > AIM_DEAD) { st.ax = rx; st.ay = -ry; st.aiming = true; this.mouseAim = false; }
      st.aimClear = edge(BTN.r3) || st.aimClear;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    st.x = x; st.y = y;
    j.clear();
    return st;
  }

  rumble(weak, strong, ms) {
    const p = this.pad();
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: weak, strongMagnitude: strong }).catch(() => {});
  }
}
