// Paints the table with Canvas2D at the display's resolution: no image files are downloaded.
// Produces three textures: the playfield, the layer above the ball (ramp, plastics, apron),
// and an atlas of sprites (flippers, bumper caps, lit inserts, glows).
import { rng } from './math.ts';
import {
  W, H, SEGS, OUTER, LAMPS, POPS, POP_R, SAUCER, TARGETS, SLING_L, SLING_R, RAMP_L, RAMP_MID, RAMP_PATH,
  FLIPPER, LANE_X, type LampDef,
} from './table.ts';

export interface Sprite { u0: number; v0: number; u1: number; v1: number; w: number; h: number; ax: number; ay: number }
export interface Baked { base: HTMLCanvasElement; over: HTMLCanvasElement; atlas: HTMLCanvasElement; sprites: Record<string, Sprite>; k: number }

export const FONT = '"Big Shoulders", "Arial Narrow", sans-serif';
export const C = {
  navy: '#0d1d36', deep: '#081325', sea: '#123a55', teal: '#1f6f7a', cream: '#f2e4c4', paper: '#efe2c2',
  red: '#d9483b', amber: '#ffb341', ink: '#0a1426', chrome: '#c9d2dc', rubber: '#16181c',
};

type Ctx = CanvasRenderingContext2D;
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const ctx2 = (c: HTMLCanvasElement) => c.getContext('2d')!;
type P = [number, number];

function pathPoly(g: Ctx, pts: P[], close = false) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

function playfieldPath(g: Ctx) {
  pathPoly(g, [...OUTER.slice(1, -1), [580, H], [20, H]], true);
}

function text(g: Ctx, s: string, x: number, y: number, size: number, color = C.cream, weight = 800, rot = 0, spacing = 0.06) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  (g as any).letterSpacing = `${size * spacing}px`;
  g.fillStyle = color;
  g.fillText(s, 0, 0);
  g.restore();
}

// Lamp insert shape, centred on 0,0.
function insertPath(g: Ctx, l: LampDef) {
  const s = l.s;
  g.beginPath();
  switch (l.shape) {
    case 'dot': g.arc(0, 0, s, 0, Math.PI * 2); break;
    case 'bar': g.roundRect(-s, -s * 0.42, s * 2, s * 0.84, s * 0.3); break;
    case 'arrow': g.moveTo(s * 1.15, 0); g.lineTo(-s * 0.7, -s * 0.8); g.lineTo(-s * 0.35, 0); g.lineTo(-s * 0.7, s * 0.8); g.closePath(); break;
    case 'tri': g.moveTo(0, -s); g.lineTo(s * 0.95, s * 0.7); g.lineTo(-s * 0.95, s * 0.7); g.closePath(); break;
    case 'lantern': g.roundRect(-s * 0.8, -s, s * 1.6, s * 2, s * 0.35); break;
  }
}

function withLamp(g: Ctx, l: LampDef, fn: () => void) {
  g.save();
  g.translate(l.x, l.y);
  g.rotate(((l.rot ?? 0) * Math.PI) / 180);
  fn();
  g.restore();
}

function mix(hex: string, to: string, t: number) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (n: number, sh: number) => (n >> sh) & 255;
  const m = (sh: number) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

function paintBase(k: number): HTMLCanvasElement {
  const c = canvas(W * k, H * k);
  const g = ctx2(c);
  g.scale(k, k);
  const r = rng(42);

  // Cabinet wood around the playfield.
  const wood = g.createLinearGradient(0, 0, W, 0);
  wood.addColorStop(0, '#2a160c'); wood.addColorStop(0.5, '#3b2113'); wood.addColorStop(1, '#25140b');
  g.fillStyle = wood;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = r() < 0.5 ? '#160a04' : '#5a341d';
    g.lineWidth = 0.6 + r() * 1.6;
    const y = r() * H;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(W * 0.3, y + (r() - 0.5) * 30, W * 0.7, y + (r() - 0.5) * 30, W, y + (r() - 0.5) * 20);
    g.stroke();
  }
  g.globalAlpha = 1;

  g.save();
  playfieldPath(g);
  g.clip();

  // Night sea: deep navy, warmer toward the lighthouse.
  const bg = g.createRadialGradient(280, 760, 40, 280, 700, 820);
  bg.addColorStop(0, '#1d3557'); bg.addColorStop(0.45, C.navy); bg.addColorStop(1, C.deep);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Beam rays fanning up from the lantern.
  g.save();
  g.translate(280, 734);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.33;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * 760, Math.sin(a) * 760);
    grad.addColorStop(0, 'rgba(255,214,140,0.22)'); grad.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 760, a - 0.07, a + 0.07);
    g.closePath();
    g.fill();
  }
  g.restore();

  // Stars in the upper sky.
  for (let i = 0; i < 90; i++) {
    const x = 30 + r() * 540, y = 40 + r() * 520;
    g.fillStyle = `rgba(242,228,196,${0.15 + r() * 0.35})`;
    g.beginPath(); g.arc(x, y, 0.6 + r() * 1.1, 0, Math.PI * 2); g.fill();
  }

  // Compass rose under the bumpers.
  g.save();
  g.translate(280, 268);
  g.strokeStyle = 'rgba(242,228,196,0.28)';
  g.lineWidth = 1.2;
  for (const rr of [118, 112, 70]) { g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, l = i % 8 === 0 ? 16 : i % 4 === 0 ? 10 : 5;
    g.beginPath(); g.moveTo(Math.cos(a) * 112, Math.sin(a) * 112); g.lineTo(Math.cos(a) * (112 - l), Math.sin(a) * (112 - l)); g.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2, len = i % 2 ? 60 : 104;
    g.fillStyle = i % 2 ? 'rgba(242,228,196,0.10)' : 'rgba(242,228,196,0.2)';
    g.beginPath();
    g.moveTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a + 0.2) * 22, Math.sin(a + 0.2) * 22);
    g.lineTo(0, 0);
    g.lineTo(Math.cos(a - 0.2) * 22, Math.sin(a - 0.2) * 22);
    g.closePath(); g.fill();
  }
  g.restore();
  text(g, 'N', 280, 135, 13, 'rgba(242,228,196,0.5)');

  // Sea: layered swells across the lower playfield.
  for (let band = 0; band < 7; band++) {
    const y0 = 930 + band * 40;
    g.fillStyle = mix(C.sea, C.deep, band / 7);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) g.lineTo(x, y0 + Math.sin(x / 38 + band * 1.7) * 9 + Math.sin(x / 13 + band) * 2.5);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.strokeStyle = `rgba(242,228,196,${0.32 - band * 0.035})`;
    g.lineWidth = 1.4;
    g.beginPath();
    for (let x = 0; x <= W; x += 10) {
      const y = y0 + Math.sin(x / 38 + band * 1.7) * 9 + Math.sin(x / 13 + band) * 2.5;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }

  // The lighthouse.
  paintLighthouse(g);

  // Shooter lane floor.
  g.fillStyle = '#0a1120';
  g.fillRect(540, 300, 40, H);
  g.restore();

  // Insert sockets (unlit lamps): dark tinted plastic with a rim.
  for (const l of LAMPS) withLamp(g, l, () => {
    insertPath(g, l);
    g.fillStyle = mix(l.color, '#05080f', 0.78);
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(242,228,196,0.55)';
    g.stroke();
    // A little sheen so it reads as plastic.
    g.clip();
    const sh = g.createLinearGradient(-l.s, -l.s, l.s, l.s);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = sh;
    g.fillRect(-l.s * 2, -l.s * 2, l.s * 4, l.s * 4);
  });

  labels(g);

  // Saucer: a dark cup with a chrome rim.
  const sg = g.createRadialGradient(SAUCER.x - 3, SAUCER.y - 4, 2, SAUCER.x, SAUCER.y, SAUCER.r + 4);
  sg.addColorStop(0, '#000'); sg.addColorStop(0.75, '#0b0f17'); sg.addColorStop(1, '#3c4656');
  g.fillStyle = sg;
  g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r + 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = C.chrome; g.lineWidth = 2;
  g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r + 4, 0, Math.PI * 2); g.stroke();

  // Drop target slots.
  for (const [x, y] of TARGETS) { g.fillStyle = '#05070c'; g.fillRect(x - 22, y - 4, 44, 8); }

  // Bumper skirts' shadows.
  for (const [x, y] of POPS) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.arc(x + 3, y + 5, POP_R + 4, 0, Math.PI * 2); g.fill();
  }

  // Shadows cast by the ramp and plastics.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 10 * k;
  g.shadowOffsetX = 5 * k; g.shadowOffsetY = 9 * k;
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 50; g.lineJoin = 'round'; g.lineCap = 'round';
  pathPoly(g, RAMP_PATH); g.stroke();
  g.restore();

  // Walls on the playfield level.
  for (const s of SEGS) {
    if (s.layer !== 0 || s.drop) continue;
    g.lineCap = 'round';
    if (s.mat === 'wall') {
      g.strokeStyle = '#4a5462'; g.lineWidth = s.w * 2 + 1;
      g.beginPath(); g.moveTo(s.a[0], s.a[1]); g.lineTo(s.b[0], s.b[1]); g.stroke();
      g.strokeStyle = C.chrome; g.lineWidth = s.w * 1.1;
      g.beginPath(); g.moveTo(s.a[0] - 0.5, s.a[1] - 0.7); g.lineTo(s.b[0] - 0.5, s.b[1] - 0.7); g.stroke();
    } else {
      g.strokeStyle = C.rubber; g.lineWidth = s.w * 2;
      g.beginPath(); g.moveTo(s.a[0], s.a[1]); g.lineTo(s.b[0], s.b[1]); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(s.a[0] - 1, s.a[1] - 1); g.lineTo(s.b[0] - 1, s.b[1] - 1); g.stroke();
    }
  }
  // Sling rubbers stretched round three posts.
  for (const t of [SLING_L, SLING_R]) {
    g.strokeStyle = '#f4efe6'; g.lineWidth = 5; g.lineJoin = 'round';
    pathPoly(g, t, true); g.stroke();
    for (const [x, y] of t) { g.fillStyle = C.chrome; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  }
  for (const x of LANE_X) { g.fillStyle = C.chrome; g.beginPath(); g.arc(x, 108, 5, 0, Math.PI * 2); g.fill(); }

  // Flipper pivots.
  for (const x of [180, 380]) { g.fillStyle = '#2b3240'; g.beginPath(); g.arc(x, 1050, 6, 0, Math.PI * 2); g.fill(); }

  // Glass grime and vignette.
  const vg = g.createRadialGradient(280, 640, 300, 280, 640, 820);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  return c;
}

function paintLighthouse(g: Ctx) {
  g.save();
  // Rocks.
  g.fillStyle = '#0b1424';
  g.beginPath();
  g.moveTo(200, 900); g.quadraticCurveTo(222, 858, 250, 866); g.quadraticCurveTo(280, 846, 312, 864);
  g.quadraticCurveTo(342, 856, 360, 900); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(242,228,196,0.25)'; g.lineWidth = 1.2; g.stroke();
  // Tower, tapering, with red bands.
  const top = 752, base = 870;
  const tw = (y: number) => 15 + ((y - top) / (base - top)) * 15;
  g.beginPath();
  g.moveTo(280 - tw(top), top); g.lineTo(280 + tw(top), top); g.lineTo(280 + tw(base), base); g.lineTo(280 - tw(base), base); g.closePath();
  g.fillStyle = C.cream; g.fill();
  g.save(); g.clip();
  g.fillStyle = C.red;
  for (let y = top + 18; y < base; y += 34) g.fillRect(240, y, 80, 15);
  const shade = g.createLinearGradient(250, 0, 310, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(0.6, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(10,20,40,0.45)');
  g.fillStyle = shade; g.fillRect(240, top, 80, base - top);
  g.restore();
  // Gallery and lantern housing.
  g.fillStyle = '#1b2332'; g.fillRect(258, top - 4, 44, 6);
  g.fillStyle = '#121a28'; g.fillRect(266, 716, 28, 36);
  g.fillStyle = C.red;
  g.beginPath(); g.moveTo(262, 718); g.lineTo(280, 700); g.lineTo(298, 718); g.closePath(); g.fill();
  g.restore();
}

function labels(g: Ctx) {
  const L = (s: string, x: number, y: number, size = 10, rot = 0) => text(g, s, x, y, size, 'rgba(242,228,196,0.85)', 700, rot, 0.12);
  ['S', 'E', 'A'].forEach((ch, i) => text(g, ch, 220 + i * 60, 154, 14, 'rgba(242,228,196,0.75)'));
  L('LOCK', 160, 600, 10);
  L('EXTRA BALL', 140, 406, 9);
  L('KICKBACK', 41, 842, 8, -Math.PI / 2);
  L('RAMP', 464, 802, 10);
  L('ORBIT', 51, 728, 9);
  L('FOG', 196, 746, 10);
  L('SQUALL', 280, 646, 10);
  L('RESCUE', 364, 746, 10);
  L('LONG NIGHT', 280, 682, 9);
  ['2X', '3X', '4X', '5X'].forEach((s, i) => text(g, s, 226 + i * 36, 922, 9, 'rgba(242,228,196,0.8)', 800));
  L('SHOOT AGAIN', 280, 980, 9);
}

function paintOver(k: number): HTMLCanvasElement {
  const c = canvas(W * k, H * k);
  const g = ctx2(c);
  g.scale(k, k);
  g.lineJoin = 'round'; g.lineCap = 'round';

  // Ramp: clear blue-tinted plastic between chrome rails.
  g.strokeStyle = 'rgba(140,200,255,0.16)';
  g.lineWidth = 50;
  pathPoly(g, RAMP_PATH); g.stroke();
  g.strokeStyle = 'rgba(200,230,255,0.10)';
  g.lineWidth = 30;
  pathPoly(g, RAMP_PATH); g.stroke();
  for (const rail of [RAMP_L, RAMP_MID]) {
    g.strokeStyle = 'rgba(20,28,40,0.85)'; g.lineWidth = 7; pathPoly(g, rail); g.stroke();
    g.strokeStyle = C.chrome; g.lineWidth = 3.4; pathPoly(g, rail); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; pathPoly(g, rail.map(([x, y]) => [x - 0.8, y - 0.8] as P)); g.stroke();
  }
  // Ramp flap where it lifts off the playfield.
  g.fillStyle = 'rgba(200,225,255,0.35)';
  g.fillRect(440, 606, 48, 6);

  // Sling plastics.
  for (const [t, dir] of [[SLING_L, 1], [SLING_R, -1]] as const) {
    const [a, b, cc] = t;
    const pts: P[] = [[a[0] - 6 * dir, a[1] - 10], [b[0] - 8 * dir, b[1] + 6], [cc[0] + 4 * dir, cc[1] + 8]];
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 8 * k; g.shadowOffsetY = 5 * k;
    pathPoly(g, pts, true);
    g.fillStyle = 'rgba(242,228,196,0.92)';
    g.fill();
    g.restore();
    pathPoly(g, pts, true);
    g.strokeStyle = C.red; g.lineWidth = 3; g.stroke();
    g.save();
    pathPoly(g, pts, true); g.clip();
    g.strokeStyle = 'rgba(217,72,59,0.5)'; g.lineWidth = 2;
    for (let i = -6; i < 12; i++) { g.beginPath(); g.moveTo(a[0] - 40 + i * 9, a[1] - 20); g.lineTo(a[0] - 40 + i * 9 + 60 * dir, a[1] + 140); g.stroke(); }
    g.restore();
  }

  // Apron.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 14 * k; g.shadowOffsetY = -4 * k;
  g.beginPath();
  g.moveTo(20, 1112); g.lineTo(196, 1112); g.quadraticCurveTo(222, 1112, 234, 1128);
  g.lineTo(326, 1128); g.quadraticCurveTo(338, 1112, 364, 1112); g.lineTo(540, 1112); g.lineTo(540, H); g.lineTo(20, H); g.closePath();
  const ap = g.createLinearGradient(0, 1112, 0, H);
  ap.addColorStop(0, '#1a2a45'); ap.addColorStop(1, '#0c1628');
  g.fillStyle = ap; g.fill();
  g.restore();
  g.strokeStyle = C.chrome; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(20, 1112); g.lineTo(196, 1112); g.quadraticCurveTo(222, 1112, 234, 1128);
  g.lineTo(326, 1128); g.quadraticCurveTo(338, 1112, 364, 1112); g.lineTo(540, 1112); g.stroke();
  text(g, 'LIGHTKEEPER', 280, 1170, 40, C.cream, 900, 0, 0.14);
  // Instruction card slots.
  for (const x of [34, 418]) {
    g.fillStyle = C.paper; g.fillRect(x, 1140, 108, 56);
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.strokeRect(x, 1140, 108, 56);
  }
  const cardL = ['3 LOCKS', 'MULTIBALL'];
  const cardR = ['LAMP ROOM', 'WATCHES'];
  cardL.forEach((s, i) => text(g, s, 88, 1158 + i * 20, 15, C.ink, 800, 0, 0.04));
  cardR.forEach((s, i) => text(g, s, 472, 1158 + i * 20, 15, C.ink, 800, 0, 0.04));
  // Shooter lane housing.
  g.fillStyle = '#121b2c'; g.fillRect(541, 1204, 38, 30);
  return c;
}

/** Simple shelf packer for the sprite atlas. */
function atlas(k: number, items: { id: string; w: number; h: number; ax: number; ay: number; res?: number; draw: (g: Ctx) => void }[]) {
  const pad = 2;
  const width = 1024;
  let x = 0, y = 0, rowH = 0;
  const placed: { id: string; px: number; py: number; pw: number; ph: number; it: (typeof items)[number] }[] = [];
  for (const it of items) {
    const kk = k * (it.res ?? 1);
    const pw = Math.ceil(it.w * kk) + pad * 2, ph = Math.ceil(it.h * kk) + pad * 2;
    if (x + pw > width) { x = 0; y += rowH; rowH = 0; }
    placed.push({ id: it.id, px: x, py: y, pw, ph, it });
    x += pw; rowH = Math.max(rowH, ph);
  }
  const c = canvas(width, y + rowH);
  const g = ctx2(c);
  const sprites: Record<string, Sprite> = {};
  for (const p of placed) {
    g.save();
    g.translate(p.px + pad, p.py + pad);
    g.beginPath(); g.rect(0, 0, p.pw - pad * 2, p.ph - pad * 2); g.clip();
    g.scale(k * (p.it.res ?? 1), k * (p.it.res ?? 1));
    g.translate(p.it.ax, p.it.ay);
    p.it.draw(g);
    g.restore();
    sprites[p.id] = {
      u0: (p.px + pad) / c.width, v0: (p.py + pad) / c.height,
      u1: (p.px + p.pw - pad) / c.width, v1: (p.py + p.ph - pad) / c.height,
      w: p.it.w, h: p.it.h, ax: p.it.ax, ay: p.it.ay,
    };
  }
  return { atlas: c, sprites };
}

function glowDraw(r: number, inner = 'rgba(255,255,255,1)') {
  return (g: Ctx) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, inner); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2);
  };
}

export function bake(k: number): Baked {
  const L = FLIPPER.len, r0 = FLIPPER.r0, r1 = FLIPPER.r1;
  const items: Parameters<typeof atlas>[1] = [
    { id: 'glow', w: 64, h: 64, ax: 32, ay: 32, res: 0.6, draw: glowDraw(32) },
    {
      id: 'shadow', w: 44, h: 44, ax: 22, ay: 22, draw: (g) => {
        const gr = g.createRadialGradient(0, 0, 4, 0, 0, 22);
        gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(-22, -22, 44, 44);
      },
    },
    {
      // Drawn pointing right from the pivot; the renderer rotates and mirrors it.
      id: 'flipper', w: L + r0 + r1 + 4, h: r0 * 2 + 4, ax: r0 + 2, ay: r0 + 2, draw: (g) => {
        const body = () => {
          g.beginPath();
          g.arc(0, 0, r0, Math.PI / 2, -Math.PI / 2);
          g.lineTo(L, -r1);
          g.arc(L, 0, r1, -Math.PI / 2, Math.PI / 2);
          g.closePath();
        };
        body();
        g.fillStyle = C.red; g.fill(); // rubber
        g.save();
        g.scale(0.86, 0.72);
        g.translate(1.5, 0);
        body();
        const gr = g.createLinearGradient(0, -r0, 0, r0);
        gr.addColorStop(0, '#fffaf0'); gr.addColorStop(1, '#cfc4ad');
        g.fillStyle = gr; g.fill();
        g.restore();
        g.fillStyle = '#9aa3ae'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
      },
    },
    {
      id: 'pop', w: 64, h: 64, ax: 32, ay: 32, draw: (g) => {
        // Skirt, body, cap.
        g.fillStyle = '#1c2230'; g.beginPath(); g.arc(0, 0, POP_R + 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.chrome; g.lineWidth = 2; g.stroke();
        const body = g.createRadialGradient(-6, -8, 2, 0, 0, POP_R);
        body.addColorStop(0, '#fff6e2'); body.addColorStop(0.6, C.cream); body.addColorStop(1, '#a89c80');
        g.fillStyle = body; g.beginPath(); g.arc(0, 0, POP_R - 4, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.red; g.beginPath(); g.arc(0, 0, POP_R - 12, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-4, -6, 6, 3.5, -0.5, 0, Math.PI * 2); g.fill();
      },
    },
    { id: 'popGlow', w: 110, h: 110, ax: 55, ay: 55, res: 0.6, draw: glowDraw(55, 'rgba(255,220,150,1)') },
    {
      id: 'target', w: 44, h: 12, ax: 22, ay: 6, draw: (g) => {
        const gr = g.createLinearGradient(0, -6, 0, 6);
        gr.addColorStop(0, '#ff8a6b'); gr.addColorStop(0.5, C.red); gr.addColorStop(1, '#7a2219');
        g.fillStyle = gr; g.beginPath(); g.roundRect(-21, -5, 42, 10, 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-18, -4, 36, 1.5);
      },
    },
    {
      id: 'spinner', w: 58, h: 12, ax: 29, ay: 6, draw: (g) => {
        const gr = g.createLinearGradient(0, -6, 0, 6);
        gr.addColorStop(0, '#f4f7fb'); gr.addColorStop(0.5, '#8d97a5'); gr.addColorStop(1, '#3b4350');
        g.fillStyle = gr; g.fillRect(-27, -5, 54, 10);
        g.fillStyle = C.red; g.fillRect(-27, -1.5, 54, 3);
      },
    },
    {
      id: 'plunger', w: 24, h: 90, ax: 12, ay: 0, draw: (g) => {
        g.fillStyle = '#c3ccd6'; g.fillRect(-3, 8, 6, 82);
        g.strokeStyle = '#8a929c'; g.lineWidth = 1.5;
        for (let y = 20; y < 70; y += 5) { g.beginPath(); g.moveTo(-8, y); g.lineTo(8, y + 2.5); g.stroke(); }
        g.fillStyle = C.red; g.beginPath(); g.roundRect(-10, 0, 20, 10, 3); g.fill();
      },
    },
    {
      id: 'beam', w: 900, h: 300, ax: 0, ay: 150, res: 0.3, draw: (g) => {
        const gr = g.createLinearGradient(0, 0, 900, 0);
        gr.addColorStop(0, 'rgba(255,236,190,0.9)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, -6); g.lineTo(900, -150); g.lineTo(900, 150); g.lineTo(0, 6); g.closePath(); g.fill();
      },
    },
  ];
  for (const l of LAMPS) {
    const ext = l.s * 3.2;
    items.push({
      id: 'lamp:' + l.id, w: ext * 2, h: ext * 2, ax: ext, ay: ext, draw: (g) => {
        // Halo spilling onto the playfield, then the lit insert itself.
        const halo = g.createRadialGradient(0, 0, l.s * 0.5, 0, 0, ext);
        halo.addColorStop(0, l.color); halo.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.55; g.fillStyle = halo; g.fillRect(-ext, -ext, ext * 2, ext * 2);
        g.globalAlpha = 1;
        g.rotate(((l.rot ?? 0) * Math.PI) / 180);
        insertPath(g, l);
        const hot = g.createRadialGradient(0, 0, 0, 0, 0, l.s * 1.2);
        hot.addColorStop(0, '#fffdf4'); hot.addColorStop(0.45, l.color); hot.addColorStop(1, mix(l.color, '#000000', 0.25));
        g.fillStyle = hot; g.fill();
      },
    });
  }
  const { atlas: at, sprites } = atlas(k, items);
  return { base: paintBase(k), over: paintOver(k), atlas: at, sprites, k };
}
