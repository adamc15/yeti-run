/* Yeti Run - a free, open-source downhill skiing game. MIT License.
 * All code and art here is original: sprites are drawn procedurally, no image assets.
 * Fork it and tweak the CFG block below to change how the game feels. */
(() => {
'use strict';

// ---------- Tunables ----------
const CFG = {
  W: 480, H: 320,          // internal resolution (scaled up with pixelated CSS)
  cell: 40,                // world grid cell size for obstacle generation
  metersPerPx: 1 / 12,
  topSpeed: 4.6,
  boostSpeed: 6.2,
  accel: 0.06,
  crashFrames: 70,
  boostDrain: 0.35,
  boostRegen: 0.12,
  yetiStartMeters: 1500,
  yetiSpeed: 4.7,
  yetiMaxSpeed: 5.8,
};
const { W, H } = CFG;
const CELL = CFG.cell;
const ANG = [-90, -60, -30, 0, 30, 60, 90].map(d => d * Math.PI / 180);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;
const $ = id => document.getElementById(id);
const el = {
  time: $('time'), dist: $('dist'), speed: $('speed'), style: $('style'),
  boost: $('boostfill'), toast: $('toast'), title: $('title'), over: $('over'),
  pause: $('pause'), result: $('result'),
};

// ---------- Audio (tiny synth, no files) ----------
let ac = null, muted = false;
function tone(f0, f1, dur, type, vol) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) { /* audio unavailable */ }
}
const SFX = {
  start: () => tone(400, 800, 0.15, 'square', 0.04),
  crash: () => tone(220, 40, 0.3, 'sawtooth', 0.08),
  jump: () => tone(300, 700, 0.2, 'square', 0.04),
  land: () => tone(120, 50, 0.12, 'triangle', 0.1),
  trick: () => tone(600, 1200, 0.12, 'square', 0.04),
  bump: () => tone(180, 260, 0.08, 'triangle', 0.06),
  roar: () => tone(90, 40, 0.9, 'sawtooth', 0.12),
  eat: () => tone(200, 30, 0.6, 'sawtooth', 0.12),
};

// ---------- Deterministic world generation ----------
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
const rnd = (x, y, s) => hash(x, y, s) / 4294967296;

const HB = { // half-width, top, bottom of hit rect relative to object base
  tree: { w: 5, t: 5, b: 1, crash: true },
  rock: { w: 7, t: 4, b: 1, crash: true },
  stump: { w: 4, t: 4, b: 1, crash: true },
  bump: { w: 10, t: 3, b: 2 },
  ramp: { w: 11, t: 4, b: 2 },
};

function cellObj(cx, cy) {
  if (cy < 5) return null; // clear start area
  const s = G.seed;
  const dens = Math.min(0.26, 0.10 + cy * 0.00018);
  if (rnd(cx, cy, s) > dens) return null;
  const t = rnd(cx, cy, s + 1);
  let type;
  if (t < .58) type = 'tree';
  else if (t < .68) type = 'rock';
  else if (t < .76) type = 'stump';
  else if (t < .94) type = 'bump';
  else type = 'ramp';
  return {
    type,
    x: cx * CELL + 4 + rnd(cx, cy, s + 2) * (CELL - 8),
    y: cy * CELL + 10 + rnd(cx, cy, s + 3) * (CELL - 14),
    big: hash(cx, cy, s + 4) % 3 === 0,
    key: cx + ',' + cy,
  };
}

// ---------- Game state ----------
let mode = 'title'; // title | play | pause | over
let G = {};
const keys = {};
let holdL = 0, holdR = 0;
let bestScore = 0;
try { bestScore = +localStorage.getItem('yeti-run-best') || 0; } catch (e) {}
document.querySelectorAll('.bestval').forEach(n => n.textContent = bestScore);

function newGame() {
  G = {
    seed: (Math.random() * 1e9) | 0,
    t: 0,
    sk: { x: 0, y: 0, dir: 3, speed: 0, z: 0, vz: 0, crash: 0, inv: 0, spin: 0, spinAnim: 0, trig: 0 },
    trail: [], others: [], yeti: null,
    style: 0, boost: 100, toastT: 0, overT: 0, topSpeed: 0,
  };
}
newGame();

function toast(text, frames) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  G.toastT = frames || 120;
}
const score = () => Math.floor(G.sk.y * CFG.metersPerPx) + G.style;

function setMode(m) {
  mode = m;
  el.title.classList.toggle('hidden', m !== 'title');
  el.over.classList.toggle('hidden', m !== 'over');
  el.pause.classList.toggle('hidden', m !== 'pause');
}
function start() { newGame(); setMode('play'); SFX.start(); }

function turn(d) {
  const sk = G.sk;
  if (mode !== 'play' || sk.crash > 0) return;
  if (sk.z > 2) { // airborne: spin for style
    if (sk.spin < 4) { sk.spin++; SFX.trick(); }
    sk.spinAnim = 22;
    return;
  }
  const nd = sk.dir + d;
  if (nd < 0) { sk.x -= 5; sk.dir = 0; }
  else if (nd > 6) { sk.x += 5; sk.dir = 6; }
  else sk.dir = nd;
}
function goDown() {
  const sk = G.sk;
  if (mode !== 'play' || sk.crash > 0 || sk.z > 2) return;
  sk.dir = 3;
}

function crash(sk) {
  sk.crash = CFG.crashFrames; sk.speed = 0; sk.spin = 0; sk.spinAnim = 0;
  SFX.crash();
}

function gameOver() {
  mode = 'over';
  G.overT = 0;
  SFX.eat();
  const sc = score();
  let nb = '';
  if (sc > bestScore) {
    bestScore = sc; nb = ' NEW BEST!';
    try { localStorage.setItem('yeti-run-best', String(sc)); } catch (e) {}
  }
  document.querySelectorAll('.bestval').forEach(n => n.textContent = bestScore);
  el.result.innerHTML = 'Distance: ' + Math.floor(G.sk.y * CFG.metersPerPx) + 'm &middot; Time: ' + fmtTime() +
    '<br>Style: ' + G.style + ' &middot; <b>Score: ' + sc + '</b>' + nb;
  // overlay shows after the chomp animation
  el.over.classList.add('hidden');
}
const fmtTime = () => { const s = Math.floor(G.t / 60); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ---------- Update ----------
function update() {
  if (mode !== 'play' && mode !== 'over') return;
  G.t++;
  const sk = G.sk;

  if (G.toastT > 0 && --G.toastT === 0) el.toast.classList.remove('show');

  if (mode === 'over') {
    G.overT++;
    if (G.overT === 90) el.over.classList.remove('hidden');
    return;
  }

  // held-key repeat turning
  if (keys.left) { holdL++; if (holdL > 16 && holdL % 8 === 0) turn(-1); } else holdL = 0;
  if (keys.right) { holdR++; if (holdR > 16 && holdR % 8 === 0) turn(1); } else holdR = 0;
  if (keys.down) goDown();

  if (sk.inv > 0) sk.inv--;
  if (sk.trig > 0) sk.trig--;
  if (sk.spinAnim > 0) sk.spinAnim--;

  if (sk.crash > 0) {
    if (--sk.crash === 0) { sk.inv = 50; sk.dir = 3; }
  } else {
    const boosting = keys.boost && G.boost > 0;
    G.boost = boosting ? Math.max(0, G.boost - CFG.boostDrain) : Math.min(100, G.boost + CFG.boostRegen);
    const a = ANG[sk.dir], c = Math.cos(a);
    const top = boosting ? CFG.boostSpeed : CFG.topSpeed;
    const target = (sk.dir === 0 || sk.dir === 6) ? 0 : top * (0.5 + 0.5 * c);
    if (sk.z <= 0) {
      if (sk.speed < target) sk.speed += boosting ? CFG.accel * 1.7 : CFG.accel;
      else sk.speed = Math.max(target, sk.speed - 0.12);
    }
    sk.x += Math.sin(a) * sk.speed;
    sk.y += Math.cos(a) * sk.speed;
    if (sk.z <= 0 && sk.speed > 0.3 && (!G.trail.length || sk.y - G.trail[G.trail.length - 1].y > 1)) {
      G.trail.push({ x: sk.x, y: sk.y });
    }
    G.topSpeed = Math.max(G.topSpeed, sk.speed);
  }

  // air physics
  if (sk.z > 0 || sk.vz > 0) {
    sk.z += sk.vz; sk.vz -= 0.1;
    if (sk.z <= 0) {
      sk.z = 0; sk.vz = 0;
      SFX.land();
      if (sk.crash <= 0) {
        let pts = 25;
        if (sk.spin > 0) { pts += sk.spin * 100; toast(sk.spin + 'x spin!  +' + (sk.spin * 100), 90); }
        G.style += pts;
      }
      sk.spin = 0;
    }
  }

  // collisions
  if (sk.crash <= 0) {
    const ccx = Math.floor(sk.x / CELL), ccy = Math.floor(sk.y / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const o = cellObj(ccx + dx, ccy + dy);
      if (!o) continue;
      const hb = HB[o.type];
      if (Math.abs(sk.x - o.x) >= 3 + hb.w) continue;
      if (!(sk.y + 2 > o.y - hb.t && sk.y - 2 < o.y + hb.b)) continue;
      if (hb.crash) {
        if (sk.z <= 2 && sk.inv <= 0) { crash(sk); sk.y -= 4; }
      } else if (sk.z <= 0.5 && sk.trig <= 0) {
        sk.trig = 20;
        if (o.type === 'ramp') { sk.vz = 1.2 + sk.speed * 0.25; sk.z = 0.01; SFX.jump(); }
        else { sk.vz = 1.0; sk.z = 0.01; sk.speed *= 0.95; SFX.bump(); }
      }
    }
  }

  // other skiers
  if (Math.random() < 0.006 && G.others.length < 5) {
    const cols = ['#2a6fdb', '#d4a017', '#8a2be2', '#1a9c5b', '#e0559c'];
    G.others.push({ x: sk.x + (Math.random() * 2 - 1) * W * 0.6, y: sk.y + H + 40,
      vx: (Math.random() - .5) * 0.6, vy: 1.6 + Math.random() * 1.2, col: cols[(Math.random() * cols.length) | 0] });
  }
  for (let i = G.others.length - 1; i >= 0; i--) {
    const o = G.others[i];
    o.x += o.vx; o.y += o.vy;
    if (o.y < sk.y - H || o.y > sk.y + H * 2) { G.others.splice(i, 1); continue; }
    if (sk.crash <= 0 && sk.inv <= 0 && sk.z <= 2 && Math.abs(o.x - sk.x) < 8 && Math.abs(o.y - sk.y) < 7) {
      crash(sk); G.others.splice(i, 1);
    }
  }

  // yeti
  const meters = sk.y * CFG.metersPerPx;
  if (!G.yeti && meters >= CFG.yetiStartMeters) {
    G.yeti = { x: sk.x, y: sk.y - 380, t: 0 };
    toast('THE YETI IS CHASING YOU!', 180); SFX.roar();
  }
  if (G.yeti) {
    const y = G.yeti;
    y.t++;
    const sp = Math.min(CFG.yetiMaxSpeed, CFG.yetiSpeed + y.t * 0.0004);
    y.y += sp;
    y.x += Math.max(-2.5, Math.min(2.5, (sk.x - y.x) * 0.04));
    if (y.y > sk.y - 4) y.y = sk.y - 4;
    if (Math.abs(sk.x - y.x) < 14 && sk.y - y.y < 12) gameOver();
  }

  // trim trail
  while (G.trail.length && G.trail[0].y < sk.y - H) G.trail.shift();

  // HUD
  if (G.t % 6 === 0) {
    el.time.textContent = fmtTime();
    el.dist.textContent = Math.floor(meters);
    el.speed.textContent = Math.round(sk.speed * 5);
    el.style.textContent = G.style;
  }
  el.boost.style.width = G.boost + '%';
}

// ---------- Drawing helpers (crisp pixel primitives) ----------
function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
function tri(cx, by, hw, h, c, dark) {
  cx = Math.round(cx); by = Math.round(by);
  for (let r = 0; r < h; r++) {
    const w = Math.round((r + 1) / h * hw), ry = by - h + r;
    if (dark) {
      ctx.fillStyle = c; ctx.fillRect(cx - w, ry, w + 1, 1);
      ctx.fillStyle = dark; ctx.fillRect(cx + 1, ry, w, 1);
    } else { ctx.fillStyle = c; ctx.fillRect(cx - w, ry, w * 2 + 1, 1); }
  }
}
function ell(cx, cy, rx, ry, c) {
  ctx.fillStyle = c; cx = Math.round(cx); cy = Math.round(cy);
  for (let r = -ry; r <= ry; r++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (r * r) / (ry * ry + 0.0001))));
    ctx.fillRect(cx - w, cy + r, w * 2 + 1, 1);
  }
}
function line(x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = c;
  for (let i = 0; i < 200; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------- Sprites ----------
function drawTree(x, y, big) {
  const layers = big ? 4 : 3, lh = big ? 11 : 9, hw = big ? 10 : 7, step = big ? 7 : 6;
  R(x - 1, y - 5, 3, 5, '#5a3a1e');
  for (let i = 0; i < layers; i++) {
    const by = y - 4 - i * step, w = hw - i * (big ? 2 : 1.6);
    tri(x, by, w, lh, '#23863f', '#186b30');
    tri(x, by - lh + 4, Math.max(1, Math.round(w * 0.4)), 4, '#ffffff');
  }
}
function drawRock(x, y) {
  ell(x, y - 3, 7, 4, '#6e7480');
  ell(x - 1, y - 4, 5, 3, '#9aa1ad');
  R(x - 3, y - 7, 4, 1, '#fff');
}
function drawStump(x, y) {
  R(x - 3, y - 6, 7, 6, '#6b4423');
  R(x - 3, y - 7, 7, 2, '#fff');
  R(x + 1, y - 5, 2, 5, '#533419');
}
function drawBump(x, y) {
  ell(x, y - 1, 10, 3, '#b9c8de');
  ell(x, y - 3, 9, 3, '#e9f0fa');
}
function drawRamp(x, y) {
  R(x - 12, y - 6, 24, 6, '#8d5a2b');
  R(x - 12, y - 10, 24, 4, '#c58b4f');
  R(x - 12, y - 10, 24, 1, '#e6b074');
  R(x - 9, y - 4, 3, 2, '#e8c44a'); R(x + 6, y - 4, 3, 2, '#e8c44a');
  R(x - 12, y, 24, 1, '#b9c8de');
}
function drawSkier(x, y, dir, o) {
  o = o || {};
  const z = o.z || 0, sy = y - z;
  const jacket = o.col || '#d62828', skin = '#f1c27d', hat = o.hat || '#1d3a8a', ski = '#222';
  if (z > 0) ell(x, y, 5, 2, '#c3cfe3');
  if (o.crash) {
    R(x - 6, sy - 5, 12, 5, jacket);
    R(x + 5, sy - 6, 4, 4, skin); R(x + 5, sy - 7, 4, 2, hat);
    line(x - 8, sy + 1, x + 4, sy - 7, ski);
    line(x - 6, sy - 7, x + 8, sy + 1, ski);
    if (o.crash > 20 && (G.t >> 3) % 2) { R(x - 2, sy - 12, 2, 2, '#f5c400'); R(x + 5, sy - 13, 2, 2, '#f5c400'); }
    return;
  }
  const a = ANG[dir], dx = Math.sin(a), dy = Math.cos(a), px = Math.cos(a), py = -Math.sin(a);
  for (const s of [-2, 2]) {
    line(x + px * s - dx * 5, sy + py * s - dy * 5, x + px * s + dx * 5, sy + py * s + dy * 5, ski);
  }
  const bx = x + dx * 2;
  R(bx - 3, sy - 11, 7, 8, jacket);
  R(bx - 3, sy - 4, 7, 2, '#2b2b2b');
  R(bx - 2, sy - 15, 5, 4, skin);
  R(bx - 2, sy - 17, 5, 3, hat);
  // poles
  line(bx - 4, sy - 8, x - 6 + dx * 2, sy + 1, '#555');
  line(bx + 4, sy - 8, x + 6 + dx * 2, sy + 1, '#555');
}
function drawYeti(x, y, anim, eat) {
  const f = (anim >> 3) & 1, k = f ? 2 : -2;
  R(x - 7, y - 4 + (f ? 0 : -2), 5, 4, '#dfe7f7');
  R(x + 2, y - 4 + (f ? -2 : 0), 5, 4, '#dfe7f7');
  R(x - 8, y - 2 + (f ? 0 : -2), 6, 2, '#333'); R(x + 2, y - 2 + (f ? -2 : 0), 6, 2, '#333');
  ell(x, y - 14, 9, 11, '#c8d3ea');
  ell(x - 1, y - 15, 8, 10, '#f6f9ff');
  R(x - 13, y - 22 + k, 4, 10, '#e6ecf9'); R(x - 13, y - 13 + k, 4, 2, '#333');
  R(x + 10, y - 22 - k, 4, 10, '#e6ecf9'); R(x + 10, y - 13 - k, 4, 2, '#333');
  ell(x, y - 27, 6, 5, '#f6f9ff');
  R(x - 3, y - 29, 2, 2, '#111'); R(x + 2, y - 29, 2, 2, '#111');
  if (eat) { R(x - 3, y - 26, 7, 5, '#7a0f0f'); R(x - 3, y - 26, 2, 2, '#fff'); R(x + 3, y - 26, 2, 2, '#fff'); }
  else { R(x - 2, y - 25, 5, 2, '#8a1c1c'); }
}

// ---------- Render ----------
function render() {
  const sk = G.sk;
  const camX = Math.round(sk.x - W / 2), camY = Math.round(sk.y - 100);
  R(0, 0, W, H, '#ffffff');

  // snow speckles
  const S = 24;
  for (let gy = Math.floor(camY / S); gy <= Math.floor((camY + H) / S); gy++) {
    for (let gx = Math.floor(camX / S); gx <= Math.floor((camX + W) / S); gx++) {
      const h = hash(gx, gy, 7);
      if (h % 5 < 2) {
        R(gx * S + ((h >>> 8) % S) - camX, gy * S + ((h >>> 16) % S) - camY, 2, 1, h % 7 === 0 ? '#c9d6ea' : '#dbe5f4');
      }
    }
  }

  // ski trail
  for (const p of G.trail) {
    const tx = p.x - camX, ty = p.y - camY;
    if (ty < -2 || ty > H) continue;
    R(tx - 3, ty, 1, 1, '#c3cfe3'); R(tx + 2, ty, 1, 1, '#c3cfe3');
  }

  // gather drawables
  const items = [];
  const cx0 = Math.floor(camX / CELL) - 1, cx1 = Math.floor((camX + W) / CELL) + 1;
  const cy0 = Math.floor(camY / CELL) - 1, cy1 = Math.floor((camY + H) / CELL) + 2;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const o = cellObj(cx, cy);
    if (o) items.push({ y: o.y, o });
  }
  for (const o of G.others) items.push({ y: o.y, other: o });
  if (G.yeti) items.push({ y: G.yeti.y, yeti: G.yeti });
  const eaten = mode === 'over';
  if (!eaten) items.push({ y: sk.y, player: true });
  items.sort((a, b) => a.y - b.y);

  for (const it of items) {
    if (it.o) {
      const o = it.o, ox = Math.round(o.x - camX), oy = Math.round(o.y - camY);
      switch (o.type) {
        case 'tree': drawTree(ox, oy, o.big); break;
        case 'rock': drawRock(ox, oy); break;
        case 'stump': drawStump(ox, oy); break;
        case 'bump': drawBump(ox, oy); break;
        case 'ramp': drawRamp(ox, oy); break;
      }
    } else if (it.other) {
      drawSkier(Math.round(it.other.x - camX), Math.round(it.other.y - camY), 3, { col: it.other.col, hat: '#333' });
    } else if (it.yeti) {
      drawYeti(Math.round(it.yeti.x - camX), Math.round(it.yeti.y - camY), G.t, eaten);
    } else if (it.player) {
      if (sk.inv > 0 && (sk.inv >> 2) % 2) continue; // blink after crash
      const dir = sk.spinAnim > 0 ? (G.t >> 1) % 7 : sk.dir;
      drawSkier(Math.round(sk.x - camX), Math.round(sk.y - camY), dir, { z: sk.z, crash: sk.crash });
    }
  }
}

// ---------- Main loop ----------
let last = 0, acc = 0;
function frame(t) {
  acc += Math.min(100, t - last); last = t;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });

// ---------- Input ----------
function primary() {
  if (mode === 'title') start();
  else if (mode === 'over' && G.overT >= 90) start();
}
function togglePause() {
  if (mode === 'play') setMode('pause');
  else if (mode === 'pause') setMode('play');
}
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down', KeyF: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
};
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) primary(); return; }
  const k = KEYMAP[e.code];
  if (!k) return;
  keys[k] = true;
  if (e.repeat) return;
  if (k === 'left') turn(-1);
  else if (k === 'right') turn(1);
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'play') setMode('pause'); });

// overlays are clickable / tappable
el.title.addEventListener('click', primary);
el.over.addEventListener('click', primary);
el.pause.addEventListener('click', togglePause);

// on-screen touch buttons
document.querySelectorAll('#touch button').forEach(b => {
  const act = b.dataset.act;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    keys[act] = true;
    if (act === 'left') turn(-1);
    else if (act === 'right') turn(1);
  });
  const up = () => { keys[act] = false; };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
});
})();
