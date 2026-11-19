import { bake } from './bake.ts';
import { Renderer, type Flash, type Scene, type View } from './gl.ts';
import { Dmd, DW } from './dmd.ts';
import { Game, In, type Mode, type Ev, ON, SLOW, FAST } from './game.ts';
import { HZ } from './physics.ts';
import { W, H, LAMPS, POPS, SLING_L, SLING_R, FLIPPER } from './table.ts';
import { bindInput, type Action } from './input.ts';
import { encode, decode } from './replay.ts';
import * as audio from './audio.ts';

// ---------- storage ----------
type Entry = { i: string; s: number; d: string; r?: string };
type Settings = { vol: number; vib: boolean; camera: 'auto' | 'flat' | 'tilt'; fx: 'auto' | 'full' | 'light'; mode: Mode; hinted: boolean };
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: settings just won't persist */ } };
const settings: Settings = load('lk.settings', { vol: 0.8, vib: true, camera: 'auto', fx: 'auto', mode: 'classic', hinted: false } as Settings);
let scores: Record<string, Entry[]> = load('lk.scores', { classic: [], timed: [] } as Record<string, Entry[]>);
const saveSettings = () => save('lk.settings', settings);

// ---------- elements ----------
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const canvas = $<HTMLCanvasElement>('#gl');
const stage = $('#stage');
const body = document.body;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

let renderer: Renderer;
try { renderer = new Renderer(canvas); } catch { $('#nogl').hidden = false; throw new Error('no webgl2'); }
const dmd = new Dmd();

// ---------- layout ----------
let view: View = { tx: 0, ty: 0, tw: 1, th: 1, tilt: 0, clip: [0, 0, 1, 1], dmd: null };
let layout: 'tall' | 'wide' | 'short' = 'tall';
let dpr = 1, quality = 1, follow = false, camY = 0;
let bakedK = 0;

function insets() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  body.appendChild(p);
  const cs = getComputedStyle(p);
  const r = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v) || 0);
  p.remove();
  return r;
}

function doLayout() {
  const vw = innerWidth, vh = innerHeight;
  const [st, , sb] = insets();
  const ratio = W / H;
  const panel = $('#panel'), frame = $('#dmdframe'), pause = $('#pause'), bar = $('#replaybar');
  let tx: number, ty: number, tw: number, th: number, dx: number, dy: number, dw: number, dh: number;
  const pad = vw > 700 ? 24 : 12;
  if (vw / vh >= 1.05 && vh >= 520) {
    layout = 'wide';
    th = vh - pad * 2; tw = th * ratio;
    const gap = Math.min(56, vw * 0.04);
    const side = Math.max(260, Math.min(440, vw - tw - gap - pad * 2));
    const x0 = Math.max(pad, (vw - (side + gap + tw)) / 2);
    tx = x0 + side + gap; ty = pad;
    dw = side; dh = side / 4; dx = x0; dy = Math.max(pad, (vh - dh - 28 - panel.scrollHeight) / 2);
    Object.assign(panel.style, { left: dx + 'px', top: dy + dh + 28 + 'px', width: side + 'px', bottom: pad + 'px', right: '', padding: '' });
    Object.assign(pause.style, { left: tx + tw - 56 + 'px', top: ty + 12 + 'px' });
  } else if (vw > vh) {
    layout = 'short';
    const side = Math.min(300, vw * 0.38);
    tw = Math.min(vw - side - pad * 3, vh * 1.05); th = tw / ratio;
    const x0 = (vw - (side + pad + tw)) / 2;
    tx = x0 + side + pad; ty = 0;
    dw = side; dh = side / 4; dx = x0; dy = Math.max(pad, st);
    Object.assign(panel.style, { left: dx + 'px', top: dy + dh + 14 + 'px', width: side + 'px', bottom: pad + 'px', right: '', padding: '' });
    Object.assign(pause.style, { left: tx + tw - 52 + 'px', top: Math.max(8, st) + 'px' });
  } else {
    layout = 'tall';
    dh = Math.max(52, Math.min(130, vh * 0.085)); dw = dh * 4;
    if (dw > vw - pad * 2 - 112) { dw = vw - pad * 2 - 112; dh = dw / 4; }
    dy = st + 8; dx = (vw - dw) / 2;
    const top = dy + dh + 10;
    const avail = vh - top - Math.max(sb, 6);
    th = Math.min(avail, (vw - 8) / ratio); tw = th * ratio;
    tx = (vw - tw) / 2; ty = top;
    Object.assign(panel.style, { left: '', top: '', width: '', bottom: '', right: '', padding: '' });
    Object.assign(pause.style, { left: dx + dw + 12 + 'px', top: dy + (dh - 44) / 2 + 'px' });
  }
  follow = th > vh + 2;
  body.classList.remove('tall', 'wide', 'short');
  body.classList.add(layout);
  Object.assign(frame.style, { left: dx - 4 + 'px', top: dy - 4 + 'px', width: dw + 8 + 'px', height: dh + 8 + 'px' });
  Object.assign(bar.style, { left: tx + tw / 2 + 'px', top: ty + (follow ? 10 : 12) + 'px', transform: 'translateX(-50%)' });
  body.style.setProperty('--glow-x', ((tx + tw / 2) / vw) * 100 + '%');

  dpr = Math.min(devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  const tilt = settings.camera === 'tilt' || (settings.camera === 'auto' && layout === 'wide') ? 0.11 : 0;
  view = {
    tx: tx * dpr, ty: ty * dpr, tw: tw * dpr, th: th * dpr, tilt,
    clip: [Math.max(0, tx * dpr - 20), 0, tw * dpr + 40, canvas.height],
    dmd: [dx * dpr, dy * dpr, dw * dpr, dh * dpr],
  };
  baseTy = ty * dpr;
  const k = Math.min((th * dpr) / H, 2048 / H);
  if (Math.abs(k - bakedK) / k > 0.04) { bakedK = k; renderer.setBaked(bake(k)); }
}
let baseTy = 0;
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(doLayout, 120) as unknown as number; });

// ---------- sessions ----------
type Kind = 'demo' | 'play' | 'replay';
interface Session { game: Game; kind: Kind; log: number[]; acc: number; speed: number; feed?: number[]; fi: number; lastScore: number }
let sess: Session;
let paused = false;
let queue: { a: In; t: number }[] = [];
let lastFrame = performance.now();

function newSession(kind: Kind, mode: Mode, seed = (Math.random() * 2 ** 32) >>> 0, feed?: number[]): Session {
  const game = new Game(seed, mode);
  return { game, kind, log: [], acc: 0, speed: 1, feed, fi: 0, lastScore: 0 };
}

function startDemo() {
  queueMicrotask(doLayout);
  sess = newSession('demo', 'practice', 12345);
  body.classList.remove('playing', 'replay', 'over');
  $('#pause').hidden = true;
  $('#replaybar').hidden = true;
  audio.setSea(true);
  shows.length = 0;
  refreshBest();
  wake(false);
}

function startGame(mode: Mode = settings.mode) {
  queueMicrotask(doLayout);
  closeDialogs();
  sess = newSession('play', mode);
  paused = false;
  queue = [];
  shows.length = 0;
  body.classList.add('playing');
  body.classList.remove('replay', 'over');
  $('#pause').hidden = false;
  $('#replaybar').hidden = true;
  $('#info').hidden = false;
  if (!settings.hinted && matchMedia('(pointer: coarse)').matches) { $('#hint').hidden = false; }
  audio.setSea(false);
  wake(true);
}

function startReplay(code: string) {
  const r = decode(code);
  if (!r) { toast('That replay link is broken'); return false; }
  closeDialogs();
  sess = newSession('replay', r.mode, r.seed, r.inputs);
  paused = false;
  shows.length = 0;
  body.classList.remove('playing', 'over');
  body.classList.add('replay');
  $('#pause').hidden = true;
  $('#replaybar').hidden = false;
  $('#rspeed').textContent = '1×';
  return true;
}

let lock: WakeLockSentinel | null = null;
async function wake(on: boolean) {
  try {
    if (on && !lock && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}

// ---------- input ----------
const pollPads = bindInput(stage, onAction, () => !!sess?.game.world.laneBall() && sess.kind === 'play', () => sess?.kind === 'play' && !paused && !sess.game.over && !anyDialog());

function onAction(a: Action, t: number) {
  if (layout === 'short' && matchMedia('(pointer: coarse)').matches && sess.kind === 'play') return;
  audio.unlock();
  if (a === 'any') return;
  if (a === 'pause') {
    if (sess.kind === 'play' && !sess.game.over) { if (paused) resume(); else pause(); }
    else if (sess.kind === 'replay') startDemo();
    return;
  }
  if (a === 'start') return;
  if (sess.kind !== 'play' || paused) return;
  if (!$('#hint').hidden) { $('#hint').hidden = true; settings.hinted = true; saveSettings(); }
  queue.push({ a, t });
  if (a === In.LDown || a === In.RDown) { vibrate(8); audio.sfx('flipUp', a === In.LDown ? 180 : 380); }
  if (a === In.LUp || a === In.RUp) audio.sfx('flipDown', a === In.LUp ? 180 : 380);
}

addEventListener('keydown', (e) => {
  audio.unlock();
  if (anyDialog() || e.repeat) return;
  if (sess.kind !== 'play' && (e.code === 'Enter' || e.code === 'Space') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); startGame(); }
});

function vibrate(ms: number) { if (settings.vib) navigator.vibrate?.(ms); }

function pause() {
  if (paused) return;
  paused = true;
  releaseAll();
  ($('#paused') as HTMLDialogElement).showModal();
}
function resume() {
  paused = false;
  ($('#paused') as HTMLDialogElement).close();
  lastFrame = performance.now();
}
function releaseAll() {
  const g = sess.game;
  for (const c of [In.LUp, In.RUp, In.PUp]) { g.input(c); sess.log.push(g.tick, c); }
  queue = [];
}
document.addEventListener('visibilitychange', () => { if (document.hidden && sess.kind === 'play' && !sess.game.over) pause(); });

// ---------- bot for the attract loop ----------
const bot = { l: 0, r: 0, pull: 0, cool: [0, 0] };
function botInputs(g: Game) {
  const w = g.world;
  if (w.laneBall() && !g.plungerHeld && !bot.pull) { g.input(In.PDown); bot.pull = g.tick + Math.round(HZ * (0.4 + Math.random() * 0.45)); }
  if (bot.pull && g.tick >= bot.pull) { g.input(In.PUp); bot.pull = 0; }
  for (let side = 0; side < 2; side++) {
    const f = w.flippers[side];
    const held = side ? bot.r : bot.l;
    if (held && g.tick >= held) { g.input(side ? In.RUp : In.LUp); if (side) bot.r = 0; else bot.l = 0; bot.cool[side] = g.tick + 90; }
    if (held || g.tick < bot.cool[side]) continue;
    for (const b of w.balls) {
      if (b.layer || b.held) continue;
      const dx = (b.x - f.x) * f.side, dy = b.y - f.y;
      if (dx > -10 && dx < FLIPPER.len + 14 && dy > -45 && dy < 30 && b.vy > -60) {
        if (Math.random() < 0.35) {
          g.input(side ? In.RDown : In.LDown);
          const until = g.tick + Math.round(HZ * 0.18);
          if (side) bot.r = until; else bot.l = until;
        }
        break;
      }
    }
  }
}

// ---------- fx state ----------
const lampI = new Float32Array(LAMPS.length);
const pops = [0, 0, 0];
const targets = [0, 0, 0];
let flashes: (Flash & { decay: number })[] = [];
let beam = { a: 0, alpha: 0 };
let gi = 1, giFlicker = 0;
let shake: [number, number] = [0, 0], shakeAmt = 0;

function flash(x: number, y: number, size: number, color: [number, number, number], a = 1, decay = 6) {
  flashes.push({ x, y, size, r: color[0], g: color[1], b: color[2], a, decay });
}
function kick(px: number) { if (!reduceMotion) shakeAmt = Math.max(shakeAmt, px); }

// ---------- DMD ----------
const noop = () => {};
const quiet = { sfx: noop, fanfare: noop } as unknown as typeof audio;
type Show = { title: string; sub?: string; value?: number; big?: boolean; ms: number; at: number };
const shows: Show[] = [];

function onEvent(e: Ev, live: boolean) {
  // The attract loop shows its lights but stays quiet.
  const snd = live ? audio : quiet;
  if (e.t === 'show') {
    if (!live) return;
    shows.push({ title: e.title, sub: e.sub, value: e.value, big: e.big, ms: e.ms ?? 1800, at: 0 });
    if (shows.length > 3) shows.splice(1, shows.length - 3);
    return;
  }
  if (e.t === 'fx') {
    if (!live) return;
    switch (e.kind) {
      case 'multiball': snd.fanfare('multiball'); giFlicker = 0.9; kick(8); (live ? vibrate : noop)(60); break;
      case 'jackpot': snd.fanfare('jackpot'); flash(280, 640, 520, [1, 0.85, 0.55], 1.2, 2.5); kick(6); (live ? vibrate : noop)(40); break;
      case 'drain': snd.sfx('drain'); break;
      case 'tilt': snd.sfx('tilt'); (live ? vibrate : noop)(200); break;
      case 'warn': snd.sfx('warn'); (live ? vibrate : noop)(60); break;
      case 'night': snd.fanfare('night'); giFlicker = 1.2; break;
      case 'skill': case 'complete': case 'extra': case 'save': case 'lock': case 'start':
        snd.fanfare(e.kind); if (e.kind !== 'start') flash(280, 700, 360, [1, 0.8, 0.5], 0.7, 3); break;
      case 'over': snd.fanfare('over'); break;
    }
    return;
  }
  const x = e.x;
  switch (e.sw) {
    case 'pop': {
      snd.sfx('pop', x);
      let best = 0, bd = 1e9;
      POPS.forEach(([px, py], i) => { const d = (px - e.x) ** 2 + (py - e.y) ** 2; if (d < bd) { bd = d; best = i; } });
      pops[best] = 1; kick(1.5); (live ? vibrate : noop)(10);
      break;
    }
    case 'sling': {
      snd.sfx('sling', x);
      const t = x < 280 ? SLING_L : SLING_R;
      flash((t[0][0] + t[2][0]) / 2, (t[0][1] + t[2][1]) / 2, 110, [1, 0.6, 0.45], 0.9, 8); (live ? vibrate : noop)(8);
      break;
    }
    case 'lane0': case 'lane1': case 'lane2': case 'inL': case 'inR': case 'outL': snd.sfx('lane', x); break;
    case 'spin': snd.sfx('spin', 51); break;
    case 'dt0': case 'dt1': case 'dt2': snd.sfx('target', x); flash(x, 560, 80, [1, 0.4, 0.3], 0.8, 7); break;
    case 'reset': snd.sfx('reset', 280); break;
    case 'saucer': snd.sfx('saucer', x); flash(140, 470, 120, [0.4, 1, 0.6], 0.8, 4); break;
    case 'eject': snd.sfx('eject', x); kick(2); break;
    case 'plunge': snd.sfx('plunge', 560, e.speed); break;
    case 'kickback': snd.sfx('kick', 41); flash(41, 1000, 140, [1, 0.7, 0.3], 1, 4); kick(3); break;
    case 'rampOut': snd.sfx('ramp', 480); flash(464, 728, 160, [0.4, 0.7, 1], 1, 4); break;
    case 'orbit': flash(51, 700, 140, [0.4, 0.7, 1], 0.8, 4); break;
    case 'shooter': snd.sfx('gate', 560); break;
    case 'clack': snd.sfx('clack', x, e.speed); break;
    case 'flipperHit': snd.sfx('post', x, e.speed); break;
    case 'nudge': snd.sfx('nudge'); kick(5); break;
  }
}

function drawDmd(now: number) {
  dmd.clear();
  const g = sess.game;
  // Shows run in sequence; each starts when it reaches the front.
  while (shows.length && shows[0].at && now - shows[0].at > shows[0].ms) shows.shift();
  const sh = shows[0];
  if (sh && sess.kind !== 'demo') {
    if (!sh.at) sh.at = now;
    const t = now - sh.at;
    const reveal = Math.min(1, t / 180);
    if (sh.big) {
      const blink = sh.title.includes('JACKPOT') || sh.title === 'MULTIBALL' || sh.title === 'TILT';
      if (!blink || Math.floor(t / 160) % 2 === 0 || t > 1200) dmd.bigText(sh.title, 64, sh.value != null || sh.sub ? 1 : 6, sh.value != null || sh.sub ? 22 : 26);
      if (sh.value != null) dmd.text(fmt(sh.value), 64, 24, 200, 0.5);
      else if (sh.sub) dmd.text(sh.sub, 64, 24, 170, 0.5, t);
    } else {
      dmd.text(sh.title, 64, 2, 255, 0.5, t);
      if (sh.value != null) dmd.bigText(fmt(sh.value), 64, 11, 21);
      else if (sh.sub) dmd.text(sh.sub, 64, 17, 170, 0.5, t);
    }
    if (reveal < 1) for (let y = 0; y < 32; y++) for (let x = Math.floor(reveal * DW); x < DW; x++) dmd.buf[y * DW + x] = 0;
    return;
  }
  if (sess.kind === 'demo') return attract(now);
  if (g.over) {
    dmd.text('GAME OVER', 64, 2, 255, 0.5);
    dmd.bigText(fmt(g.score), 64, 11, 21);
    return;
  }
  // Score, plus the line of status under it.
  dmd.bigText(fmt(g.score), 64, 0, 22);
  const left = g.mode === 'timed' ? `TIME ${Math.floor(g.clock / HZ / 60)}:${String(Math.floor((g.clock / HZ) % 60)).padStart(2, '0')}` : g.mode === 'practice' ? 'PRACTICE' : `BALL ${g.ball}`;
  dmd.text(left, 2, 24, 150);
  let right = '';
  if (g.watch) right = `${g.watch === 'night' ? 'NIGHT' : g.watch.toUpperCase()} ${g.watchLeft()}`;
  else if (g.multiball) right = 'MULTIBALL';
  else if (g.phase === 'lane') right = Math.floor(now / 400) % 2 ? 'SHOOT' : '';
  else if (g.lockLit) right = 'LOCK LIT';
  else if (g.mult > 1) right = `${g.mult}X`;
  dmd.text(right, 126, 24, 150, 1);
  if (sess.kind === 'replay' && Math.floor(now / 600) % 2) dmd.fill(124, 1, 3, 3, 255);
}

const TIPS = ['3 LOCKS START MULTIBALL', 'THE LAMP ROOM STARTS A WATCH', 'S E A LANES RAISE THE BONUS', '3 RAMPS RELIGHT THE KICKBACK', 'PLUNGE INTO THE LIT LANE'];
function attract(now: number) {
  const page = Math.floor(now / 5000) % 4;
  const t = now % 5000;
  if (page === 0) {
    dmd.lighthouse(12, now);
    dmd.bigText('LIGHTKEEPER', 72, 2, 22, 255, 104);
    if (Math.floor(now / 600) % 2) dmd.text('PRESS PLAY', 72, 24, 190, 0.5);
  } else if (page === 1) {
    const list = scores[settings.mode === 'timed' ? 'timed' : 'classic'] ?? [];
    dmd.text(settings.mode === 'timed' ? 'BEST 3 MINUTES' : 'HIGH SCORES', 64, 1, 255, 0.5);
    if (!list.length) dmd.text('NONE YET', 64, 16, 170, 0.5);
    list.slice(0, 3).forEach((e, i) => {
      dmd.text(`${i + 1} ${e.i}`, 8, 10 + i * 8, i ? 170 : 255);
      dmd.text(fmt(e.s), 120, 10 + i * 8, i ? 170 : 255, 1);
    });
  } else if (page === 2) {
    dmd.text('TIP', 64, 3, 170, 0.5);
    dmd.text(TIPS[Math.floor(now / 20000) % TIPS.length], 64, 15, 255, 0.5, t);
  } else {
    dmd.lighthouse(116, now + 2000);
    dmd.bigText('A NIGHT SEA', 56, 2, 20, 255, 100);
    dmd.text('PINBALL', 56, 24, 170, 0.5);
  }
}

// ---------- the frame ----------
let fpsWin: number[] = [];
function frame(now: number) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastFrame);
  const prev = lastFrame;
  lastFrame = now;
  pollPads();
  const g = sess.game;
  const live = sess.kind !== 'demo';

  if (!paused && !(sess.kind === 'play' && g.over)) {
    sess.acc += (dtMs / 1000) * HZ * sess.speed;
    let n = Math.min(Math.floor(sess.acc), HZ / 4);
    sess.acc -= Math.floor(sess.acc);
    const t0 = g.tick, span = now - prev || 1;
    // Apply each input at the tick it happened on, inside this frame's span.
    queue.sort((a, b) => a.t - b.t);
    while (n > 0 || queue.length) {
      const q = queue[0];
      const at = q ? t0 + Math.max(0, Math.min(n, Math.floor(((q.t - prev) / span) * n))) : Infinity;
      if (q && g.tick >= at) {
        queue.shift();
        g.input(q.a);
        sess.log.push(g.tick, q.a);
        continue;
      }
      if (g.tick >= t0 + n) break;
      if (sess.kind === 'demo' && g.tick % 4 === 0) botInputs(g);
      if (sess.kind === 'replay' && sess.feed) {
        while (sess.fi < sess.feed.length && sess.feed[sess.fi] <= g.tick) { g.input(sess.feed[sess.fi + 1] as In); sess.fi += 2; }
      }
      g.step();
      if (g.over) break;
    }
    for (const e of g.events) onEvent(e, live);
    g.events.length = 0;
    if (g.score !== sess.lastScore) { if (live) audio.chime(g.score - sess.lastScore); sess.lastScore = g.score; }
    if (g.over && sess.kind === 'play') gameOver();
    if (g.over && sess.kind === 'replay') { toast('Replay finished'); setTimeout(startDemo, 1600); sess.kind = 'demo'; }
  }

  // Lamps fade like incandescent bulbs: quick to light, slower to die.
  const dt = dtMs / 1000;
  for (let i = 0; i < LAMPS.length; i++) {
    const st = g.lamps[i];
    let target = st === ON ? 1 : st === SLOW ? (now % 520 < 260 ? 1 : 0) : st === FAST ? (now % 180 < 90 ? 1 : 0) : 0;
    if (sess.kind === 'demo') target = Math.max(target * 0.6, Math.max(0, Math.sin(now / 260 - LAMPS[i].y / 90)) ** 6);
    const tau = target > lampI[i] ? 0.03 : 0.09;
    lampI[i] += (target - lampI[i]) * (1 - Math.exp(-dt / tau));
  }
  for (let i = 0; i < 3; i++) {
    pops[i] *= Math.exp(-dt * 9);
    const down = g.world.targetUp(i) ? 0 : 1;
    targets[i] += (down - targets[i]) * Math.min(1, dt * 22);
  }
  for (const f of flashes) f.a *= Math.exp(-dt * f.decay);
  flashes = flashes.filter((f) => f.a > 0.02);
  const beamOn = g.multiball || g.watch === 'night' || sess.kind === 'demo';
  beam.alpha += ((beamOn ? (sess.kind === 'demo' ? 0.5 : 1) : 0) - beam.alpha) * Math.min(1, dt * 2);
  beam.a += dt * 0.9;
  let giT = g.tilted ? 0.3 : g.phase === 'bonus' ? 0.75 : 1;
  if (giFlicker > 0) { giFlicker -= dt; giT = Math.floor(giFlicker * 14) % 2 ? 0.4 : 1.15; }
  gi += (giT - gi) * Math.min(1, dt * 12);
  shakeAmt *= Math.exp(-dt * 10);
  shake = shakeAmt > 0.2 ? [(Math.random() - 0.5) * shakeAmt * dpr, (Math.random() - 0.5) * shakeAmt * dpr] : [0, 0];

  // Rolling sound follows the fastest ball.
  let fast = 0, ramp = false;
  for (const b of g.world.balls) { const v = Math.hypot(b.vx, b.vy); if (v > fast && !b.held) { fast = v; ramp = b.layer === 1; } }
  audio.rolling(live && !paused ? fast : 0, ramp);

  // Camera for short landscape screens: follow the lowest ball, smoothly.
  if (follow) {
    const lowest = g.world.balls.reduce((m, b) => Math.max(m, b.y), 0) || 1100;
    const want = Math.min(0, Math.max(canvas.height - view.th, canvas.height * 0.55 - (lowest / H) * view.th));
    camY += (want - camY) * Math.min(1, dt * 5);
    view.ty = baseTy + camY;
  }

  const scene: Scene = {
    balls: g.world.balls,
    flippers: g.world.flippers,
    lamps: lampI,
    targets,
    spinner: g.world.spinner.a,
    plunger: g.plungerPower(),
    pops,
    flashes,
    beam,
    gi,
    shake,
  };
  drawDmd(now);
  renderer.render(scene, view, dmd.buf);
  updateInfo();

  // Effects quality: if frames run long for two seconds, drop bloom, then resolution.
  if (settings.fx === 'auto' && sess.kind !== 'demo') {
    fpsWin.push(dtMs);
    if (fpsWin.length >= 120) {
      const avg = fpsWin.reduce((a, b) => a + b, 0) / fpsWin.length;
      fpsWin = [];
      if (avg > 21 && renderer.bloom) renderer.bloom = false;
      else if (avg > 24 && quality > 0.7) { quality = 0.7; doLayout(); }
    }
  }
}

let infoKey = '';
function updateInfo() {
  if (sess.kind !== 'play' || layout === 'tall') return;
  const g = sess.game;
  const key = [g.ball, g.mult, g.locks, g.lockLit, g.ramps, g.watch, [...g.watchDone].join(), g.mode, g.extraBalls].join('|');
  if (key === infoKey) return;
  infoKey = key;
  $('#i-mult').textContent = `${g.mult}×`;
  $('#i-locks').textContent = g.lockLit ? 'Lit' : `${g.locks} of 3`;
  $('#i-ramps').textContent = String(g.ramps);
  document.querySelectorAll<HTMLElement>('.watches li').forEach((li) => {
    const w = li.dataset.w!;
    li.classList.toggle('on', g.watch === w);
    li.classList.toggle('done', g.watchDone.has(w as never));
  });
}

// ---------- game over and scores ----------
let lastReplay = '';
let pendingEntry: { mode: Mode; s: number; r: string } | null = null;

function gameOver() {
  const g = sess.game;
  lastReplay = encode({ v: 1, seed: g.seed, mode: g.mode, inputs: sess.log });
  save('lk.last', lastReplay);
  wake(false);
  body.classList.remove('playing');
  body.classList.add('over');
  $('#pause').hidden = true;
  $('#hint').hidden = true;
  $('#o-score').textContent = fmt(g.score);
  const form = $('#initials');
  const note = $('#o-note');
  form.hidden = true;
  pendingEntry = null;
  $('[data-act=again]').classList.add('primary');
  if (g.mode === 'practice') note.textContent = 'Practice games stay off the high score table.';
  else {
    const list = scores[g.mode] ?? [];
    const rank = list.filter((e) => e.s >= g.score).length;
    if (rank < 5 && g.score > 0) {
      pendingEntry = { mode: g.mode, s: g.score, r: lastReplay };
      note.textContent = rank === 0 ? (list.length ? `New best. The old one was ${fmt(list[0].s)}.` : 'First score on this device.') : `Number ${rank + 1} on this device.`;
      form.hidden = false;
      $('[data-act=again]').classList.remove('primary');
      const inp = $<HTMLInputElement>('#o-init');
      inp.value = load('lk.initials', { v: '' }).v ?? '';
    } else note.textContent = list.length ? `Best on this device: ${fmt(list[0].s)}` : '';
  }
  setTimeout(() => {
    const d = $('#over') as HTMLDialogElement;
    d.showModal();
    if (!form.hidden && matchMedia('(pointer: fine)').matches) $<HTMLInputElement>('#o-init').focus();
  }, 1400);
}

$('#initials').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $<HTMLInputElement>('#o-init').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!v || !pendingEntry) return;
  save('lk.initials', { v });
  const list = (scores[pendingEntry.mode] ??= []);
  list.push({ i: v, s: pendingEntry.s, d: new Date().toISOString().slice(0, 10), r: pendingEntry.r });
  list.sort((a, b) => b.s - a.s);
  list.length = Math.min(list.length, 5);
  save('lk.scores', scores);
  pendingEntry = null;
  $('#initials').hidden = true;
  $('[data-act=again]').classList.add('primary');
  toast(`Saved as ${v}`);
  refreshBest();
});

function refreshBest() {
  document.querySelectorAll<HTMLElement>('[data-best]').forEach((el) => {
    const top = scores[el.dataset.best!]?.[0];
    el.textContent = top ? fmt(top.s) : '';
  });
}

function renderBoard(mode: string) {
  const ol = $('#s-list');
  const list = scores[mode] ?? [];
  ol.replaceChildren();
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scores yet. Finish a game to set one.'; ol.append(li); return; }
  list.forEach((e, i) => {
    const li = document.createElement('li');
    if (!i) li.className = 'first';
    const a = document.createElement('span'); a.textContent = e.i;
    const b = document.createElement('span'); b.textContent = fmt(e.s);
    li.append(a, b);
    if (e.r) { li.title = 'Watch this game'; li.style.cursor = 'pointer'; li.onclick = () => startReplay(e.r!); }
    ol.append(li);
  });
}

// ---------- UI wiring ----------
function anyDialog() { return !!document.querySelector('dialog[open]'); }
function closeDialogs() { document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close()); }
let toastT = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200) as unknown as number;
}

document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => {
  b.onclick = () => {
    settings.mode = b.dataset.mode as Mode;
    saveSettings();
    document.querySelectorAll('.modes button').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    $('#modedesc').textContent = b.querySelector('span')!.textContent;
  };
  if (b.dataset.mode === settings.mode) $('#modedesc').textContent = b.querySelector('span')!.textContent;
  b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
});
$('#play').onclick = () => { audio.unlock(); startGame(); };
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open],[data-close],[data-act]');
  if (!el) return;
  audio.unlock();
  if (el.dataset.open) {
    const d = $('#' + el.dataset.open) as HTMLDialogElement;
    if (el.dataset.open === 'scores') renderBoard(document.querySelector('.tabs [aria-selected=true]')?.getAttribute('data-tab') ?? 'classic');
    if (el.dataset.open === 'settings') syncSettings();
    if (!d.open) d.showModal();
    return;
  }
  if (el.hasAttribute('data-close')) { el.closest('dialog')?.close(); return; }
  switch (el.dataset.act) {
    case 'resume': resume(); break;
    case 'restart': closeDialogs(); startGame(sess.game.mode); break;
    case 'quit': closeDialogs(); paused = false; startDemo(); break;
    case 'again': startGame(sess.game.mode); break;
    case 'replay': if (lastReplay) startReplay(lastReplay); break;
    case 'share': {
      const url = `${location.origin}/#r=${lastReplay}`;
      navigator.clipboard?.writeText(url).then(() => toast('Replay link copied'), () => toast('Copy failed. Your browser blocked the clipboard'));
      break;
    }
  }
});
($('#paused') as HTMLDialogElement).addEventListener('cancel', (e) => { e.preventDefault(); resume(); });
$('#over').addEventListener('cancel', (e) => e.preventDefault());
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
  renderBoard(b.dataset.tab!);
});
$('#rspeed').onclick = () => { sess.speed = sess.speed >= 4 ? 1 : sess.speed * 2; $('#rspeed').textContent = `${sess.speed}×`; };
$('#rexit').onclick = () => { history.replaceState(null, '', location.pathname); startDemo(); };
$('#pause').onclick = () => pause();

function syncSettings() {
  $<HTMLInputElement>('#s-vol').value = String(settings.vol);
  $<HTMLInputElement>('#s-vib').checked = settings.vib;
  $('#s-vib-row').hidden = !('vibrate' in navigator);
  document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const key = seg.dataset.setting as 'camera' | 'fx';
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === settings[key])));
  });
}
$<HTMLInputElement>('#s-vol').oninput = (e) => { settings.vol = +(e.target as HTMLInputElement).value; audio.setVolume(settings.vol); saveSettings(); };
$<HTMLInputElement>('#s-vib').onchange = (e) => { settings.vib = (e.target as HTMLInputElement).checked; saveSettings(); };
document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const key = seg.dataset.setting as 'camera' | 'fx';
  (settings as any)[key] = b.dataset.v;
  saveSettings();
  syncSettings();
  if (key === 'fx') { renderer.bloom = settings.fx !== 'light'; quality = 1; }
  doLayout();
}));
$('#s-clear').onclick = () => {
  if (!confirm('Clear every high score on this device?')) return;
  scores = { classic: [], timed: [] };
  save('lk.scores', scores);
  refreshBest();
  toast('High scores cleared');
};

// ---------- boot ----------
audio.setVolume(settings.vol);
renderer.bloom = settings.fx !== 'light';
async function boot() {
  // The table's lettering is painted with the display face, so wait for it (briefly).
  try {
    const face = new FontFace('Big Shoulders', 'url(/fonts/bigshoulders.woff2)', { weight: '100 900' });
    document.fonts.add(face);
    await Promise.race([face.load(), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* falls back to a system face */ }
  doLayout();
  startDemo();
  const m = location.hash.match(/^#r=([\w-]+)/);
  if (m) startReplay(m[1]);
  try { lastReplay = JSON.parse(localStorage.getItem('lk.last') ?? '""') || ''; } catch { lastReplay = ''; }
  requestAnimationFrame((t) => { lastFrame = t; frame(t); });
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
if (import.meta.env.DEV) (window as any).__lk = () => sess;
