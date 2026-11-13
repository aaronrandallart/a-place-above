// Start-screen intro: amber schematic HUD panels, read-outs and connector lines drift in sideways on
// three layers, blinking on one by one, before the title streaks in and the hero art fades up.
// Self-contained: it draws on #title-fx for as long as the #title screen is showing, then stops.
const canvas = document.getElementById('title-fx'), screen = document.getElementById('title');
if (canvas && screen) {
  const ctx = canvas.getContext('2d');
  const rnd = (a, b) => a + Math.random() * (b - a), pick = (list) => list[Math.floor(Math.random() * list.length)];
  const WORDS = ['UNIT 07', 'HULL 5/5', 'AMMO 3000', 'FAMILY 0/9', 'SECTOR 01', 'TRAIL LOCK', 'PILOT: CAPUCHIN', 'RIFLE READY', 'SAFE ZONE',
    'FENCE LIVE', 'BAD ROBOT x20', 'RESCUE OP', 'N 04.21 W 73.50', 'SYS CHECK OK', 'REPAIR x3', 'BOOST STANDBY'];
  // drift speed (px/s at 1000 px wide), brightness and colour of each layer, back to front
  const LAYERS = [{ v: -11, a: 0.22, c: '#b4521c' }, { v: 8, a: 0.34, c: '#ee8632' }, { v: -22, a: 0.48, c: '#ffc07a' }];
  let W = 0, H = 0, span = 0, items = [], t0 = 0;

  function build() {
    const dpr = 0.5;                                                          // drawn at half size and scaled up with hard pixels: a slightly lo-res look
    W = canvas.clientWidth; H = canvas.clientHeight; span = W * 1.5;         // each layer is wider than the screen and wraps
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    items = [];
    const u = Math.max(0.7, W / 1000);                                        // sizes follow the window
    LAYERS.forEach((L, li) => {
      const n = Math.round(38 + li * 10);
      for (let i = 0; i < n; i++) {
        const kind = pick(['box', 'box', 'rows', 'rows', 'rows', 'fill', 'bracket', 'word', 'word', 'link']);
        const it = { li, kind, x: rnd(0, span), y: rnd(0.04, 0.96) * H, w: rnd(50, 240) * u, h: rnd(18, 130) * u,
          on: rnd(0.4, 3.6), seed: Math.random() * 100, blink: Math.random() < 0.25 };
        if (kind === 'rows') { it.rows = Array.from({ length: Math.round(rnd(3, 9)) }, () => Array.from({ length: Math.round(rnd(2, 6)) }, () => rnd(0.06, 0.3))); it.h = it.rows.length * 7 * u; }
        if (kind === 'word') it.text = pick(WORDS);
        if (kind === 'link') { it.dx = rnd(40, 160) * u * (Math.random() < 0.5 ? -1 : 1); it.dy = rnd(-70, 70) * u; }
        items.push(it);
      }
    });
  }

  function drawItem(it, x, u) {
    const { y, w, h } = it;
    switch (it.kind) {
      case 'box': ctx.strokeRect(x, y, w, h); if (it.seed > 60) ctx.fillRect(x, y, w * 0.3, 3 * u); break;
      case 'bracket': ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w * 0.4, y); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w * 0.6, y + h); ctx.stroke(); break;
      case 'fill': for (let yy = 0; yy < h * 0.5; yy += 3 * u) ctx.fillRect(x, y + yy, w * 0.45, 1.4 * u); break;      // block of scan lines
      case 'rows': it.rows.forEach((row, r) => { let xx = x; for (const seg of row) { ctx.fillRect(xx, y + r * 7 * u, seg * w, 2 * u); xx += seg * w + 5 * u; } }); break;
      case 'word': ctx.fillText(it.text, x, y); ctx.fillRect(x, y + 5 * u, ctx.measureText(it.text).width, 1); break;
      case 'link': ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + it.dx * 0.4, y); ctx.lineTo(x + it.dx, y + it.dy); ctx.stroke(); ctx.fillRect(x + it.dx - 2 * u, y + it.dy - 2 * u, 4 * u, 4 * u); break;
    }
  }

  function frame(now) {
    if (!screen.classList.contains('show')) return;                          // the game has started: stop drawing
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) build();
    const t = (now - t0) / 1000, u = Math.max(0.7, W / 1000);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.5, 1.8 * u); ctx.font = `${Math.round(11 * u)}px ui-monospace, Menlo, Consolas, monospace`; ctx.textBaseline = 'middle';
    const settle = 1 - 0.45 * Math.min(1, Math.max(0, (t - 4) / 3));        // fades back further once the hero is up         // dims a little once the hero is up
    for (const it of items) {
      const L = LAYERS[it.li], age = t - it.on; if (age < 0) continue;
      // each piece blinks on: a couple of hard flickers, then steady with a slow shimmer
      let a = age < 0.35 ? (Math.floor(age * 22 + it.seed) % 2 ? 1 : 0.15) : 0.8 + 0.2 * Math.sin(t * 2.3 + it.seed);
      if (it.blink && Math.sin(t * 6 + it.seed) > 0.75) a *= 0.3;
      ctx.globalAlpha = L.a * a * settle; ctx.strokeStyle = ctx.fillStyle = L.c;
      let x = ((it.x + L.v * u * t) % span + span) % span - span * 0.17;
      drawItem(it, x, u);
      if (it.li === 2 && age < 1.2) { ctx.globalAlpha *= 0.35; ctx.fillRect(x - 120 * u * (1.2 - age), it.y, 120 * u * (1.2 - age), 1.5 * u); }     // streak as it slides in
    }
    // stray horizontal scan streaks
    ctx.fillStyle = '#ff9a4a';
    for (let i = 0; i < 5; i++) {
      const yy = (Math.sin(t * (0.7 + i * 0.31) + i * 9.1) * 0.5 + 0.5) * H;
      ctx.globalAlpha = 0.04 + 0.03 * Math.sin(t * 9 + i); ctx.fillRect(0, yy, W, i % 2 ? 1 : 2);
    }
    // clear a soft hole in the middle so the hero art reads cleanly through the HUD
    const hole = Math.min(1, Math.max(0, (t - 3) / 2.5));
    if (hole > 0) {
      ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 0.7 * hole;
      const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.min(W, H * 1.5) * 0.36);
      g.addColorStop(0, '#000'); g.addColorStop(0.45, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }
  // Begin only when the page (and the game's heavy assets) has finished loading, so the intro plays smoothly
  // from its first frame. The CSS animations of the title, hero art and menu key off the same moment.
  const begin = () => { build(); t0 = performance.now(); screen.classList.add('intro'); requestAnimationFrame(frame); };

  // Start-screen music ("Aluminum", looping). Browsers only allow sound after the player has touched the page,
  // so the screen first tries to play it straight away; if the browser refuses, it waits on a black
  // "press any button" gate and begins the intro and the music together on that first press.
  const music = new Audio('assets/audio/title_music.mp3');
  music.loop = true; music.preload = 'auto'; music.volume = 0.55;
  try { music.muted = localStorage.getItem('apa-music') === 'off'; } catch { /* storage unavailable */ }
  addEventListener('music-set', (e) => { music.muted = !e.detail; });      // M, or the pause menu, switches music on and off
  const open = () => { screen.classList.remove('gate'); begin(); };
  const arrive = () => {
    music.play().then(open).catch(() => {
      screen.classList.add('gate');                                       // main.js ignores start presses while the gate is up
      const go = (e) => {
        if (e && e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || e.code === 'KeyM')) return;
        removeEventListener('keydown', go); removeEventListener('pointerdown', go); clearInterval(poll);
        music.play().catch(() => {});                                     // a controller press may not unlock sound; the intro still runs
        setTimeout(open, 0);                                              // after this press has finished, so it cannot also start the game
      };
      addEventListener('keydown', go); addEventListener('pointerdown', go);
      let armed = false;
      const poll = setInterval(() => {                                    // any controller button, once all are released first
        let down = false;
        for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.buttons.some((b) => b.pressed)) down = true;
        if (!down) armed = true; else if (armed) go();
      }, 50);
    });
  };
  // The music fades out as Unit 07 powers up (main.js announces the start).
  addEventListener('title-start', () => {
    const v0 = music.volume, t1 = performance.now();
    const fade = () => { const k = (performance.now() - t1) / 1800; if (k >= 1) { music.pause(); return; } music.volume = v0 * (1 - k); requestAnimationFrame(fade); };
    fade();
  });
  if (document.readyState === 'complete') setTimeout(arrive, 300); else addEventListener('load', () => setTimeout(arrive, 300));
}
