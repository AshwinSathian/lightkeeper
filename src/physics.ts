// Fixed-step ball physics. Deterministic: no clock, no Math.random, no Math.sin.
import { cos, sin } from './math.ts';
import {
  BALL_R, CIRCS, DRAIN_Y, FLIPPER, FLIPPERS, PLUNGER, SAUCER, SEGS, SENSORS, W, H,
  type Mat,
} from './table.ts';

export const HZ = 480;
export const DT = 1 / HZ;

// Tuning. Gravity is the playfield's slope component; real tables sit at about 6.5 degrees.
export const T = {
  g: 1500,
  rampG: 1.55, // multiplier while on the ramp, which climbs
  maxV: 4200,
  drag: 0.12, // per second
  flipAcc: 1700, flipMax: 42, // rad/s^2, rad/s
  dropAcc: 700, dropMax: 26,
  popKick: 980,
  slingKick: 900,
  plungeMin: 1450, plungeMax: 2600,
};

// e: elasticity, k: falloff per unit of impact speed (harder hits bounce proportionally less), f: friction.
const MATS: Record<Mat | 'flipper', { e: number; k: number; f: number }> = {
  wall: { e: 0.45, k: 0.0001, f: 0.04 },
  rubber: { e: 0.78, k: 0.00035, f: 0.1 },
  sling: { e: 0.7, k: 0.0003, f: 0.1 },
  bumper: { e: 0.6, k: 0.0002, f: 0.05 },
  target: { e: 0.35, k: 0.0001, f: 0.1 },
  plastic: { e: 0.35, k: 0.0001, f: 0.04 },
  flipper: { e: 0.62, k: 0.00042, f: 0.02 },
};

export interface Ball {
  x: number; y: number; vx: number; vy: number;
  layer: 0 | 1;
  held: number; // ticks left in the saucer, 0 when free
  id: number;
}

interface Seg {
  ax: number; ay: number; bx: number; by: number; dx: number; dy: number; len2: number;
  w: number; layer: number; mat: Mat; sw: string | undefined;
  oneway: boolean; nx: number; ny: number; on: boolean; drop: boolean;
}
interface Circ { x: number; y: number; r: number; layer: number; mat: Mat; sw?: string }
interface Sensor { id: string; ax: number; ay: number; dx: number; dy: number; layer: number }

export interface Flipper { x: number; y: number; side: number; a: number; w: number; held: boolean; dx: number; dy: number }

export type Hit = { sw: string; ball: Ball; speed: number; dir: number; x: number; y: number };

const CELL = 50;
const COLS = Math.ceil(W / CELL);
const ROWS = Math.ceil(H / CELL);

export class World {
  balls: Ball[] = [];
  flippers: Flipper[];
  segs: Seg[];
  circs: Circ[];
  sensors: Sensor[];
  grid: Int32Array[][]; // [layer][cell] -> collider ids; >= 0 segs, < 0 circles as ~i
  hits: Hit[] = [];
  spinner = { a: 0, w: 0 };
  nextBallId = 1;

  constructor() {
    this.segs = SEGS.map((s) => {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      // One-way normal: whichever perpendicular points up the table.
      let nx = dy / len, ny = -dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      return { ax: s.a[0], ay: s.a[1], bx: s.b[0], by: s.b[1], dx, dy, len2: dx * dx + dy * dy, w: s.w, layer: s.layer, mat: s.mat, sw: s.sw, oneway: !!s.oneway, nx, ny, on: true, drop: !!s.drop };
    });
    this.circs = CIRCS.map((c) => ({ ...c }));
    this.sensors = SENSORS.map((s) => ({ id: s.id, ax: s.a[0], ay: s.a[1], dx: s.b[0] - s.a[0], dy: s.b[1] - s.a[1], layer: s.layer ?? -1 }));
    this.flippers = FLIPPERS.map((f) => ({ x: f.x, y: f.y, side: f.side, a: FLIPPER.rest, w: 0, held: false, dx: 0, dy: 0 }));
    this.grid = [0, 1].map((layer) => this.buildGrid(layer));
  }

  private buildGrid(layer: number): Int32Array[] {
    const cells: number[][] = Array.from({ length: COLS * ROWS }, () => []);
    const add = (id: number, x0: number, y0: number, x1: number, y1: number) => {
      const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.min(COLS - 1, Math.floor(x1 / CELL));
      const r0 = Math.max(0, Math.floor(y0 / CELL)), r1 = Math.min(ROWS - 1, Math.floor(y1 / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * COLS + c].push(id);
    };
    // Expand each box by the reach a ball centre can have, plus a cell, so a ball only reads its own cell.
    this.segs.forEach((s, i) => {
      if (s.layer !== layer) return;
      const m = BALL_R + s.w + CELL;
      add(i, Math.min(s.ax, s.bx) - m, Math.min(s.ay, s.by) - m, Math.max(s.ax, s.bx) + m, Math.max(s.ay, s.by) + m);
    });
    this.circs.forEach((c, i) => {
      if (c.layer !== layer) return;
      const m = BALL_R + c.r + CELL;
      add(~i, c.x - m, c.y - m, c.x + m, c.y + m);
    });
    return cells.map((l) => Int32Array.from(l));
  }

  addBall(x = PLUNGER.x, y = PLUNGER.y): Ball {
    const b: Ball = { x, y, vx: 0, vy: 0, layer: 0, held: 0, id: this.nextBallId++ };
    this.balls.push(b);
    return b;
  }

  /** A ball resting on the plunger, if any. */
  laneBall(): Ball | undefined {
    return this.balls.find((b) => b.x > 543 && b.y > 1100 && b.vy > -50 && b.vy < 50);
  }

  plunge(power: number) {
    const b = this.laneBall();
    if (b) b.vy = -(T.plungeMin + (T.plungeMax - T.plungeMin) * power);
    return b;
  }

  resetTargets() { for (const s of this.segs) if (s.drop) s.on = true; }
  targetUp(i: number) { return this.segs.find((s) => s.sw === 'dt' + i)!.on; }

  step() {
    this.hits.length = 0;
    for (const f of this.flippers) this.moveFlipper(f);
    const sp = this.spinner;
    if (sp.w > 0) {
      const before = Math.floor(sp.a);
      sp.a += sp.w * DT;
      sp.w -= (1.2 + sp.w * 0.9) * DT;
      if (sp.w < 0) sp.w = 0;
      if (Math.floor(sp.a) !== before) this.hits.push({ sw: 'spin', ball: this.balls[0], speed: sp.w, dir: 0, x: 51, y: 560 });
    }
    for (const b of this.balls) this.moveBall(b);
    this.ballPairs();
    // Drain.
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.y > DRAIN_Y) {
        this.balls.splice(i, 1);
        this.hits.push({ sw: 'drain', ball: b, speed: 0, dir: 0, x: b.x, y: b.y });
      }
    }
  }

  private moveFlipper(f: Flipper) {
    if (f.held) { f.w -= T.flipAcc * DT; if (f.w < -T.flipMax) f.w = -T.flipMax; }
    else { f.w += T.dropAcc * DT; if (f.w > T.dropMax) f.w = T.dropMax; }
    f.a += f.w * DT;
    if (f.a < FLIPPER.up) { f.a = FLIPPER.up; f.w = 0; }
    if (f.a > FLIPPER.rest) { f.a = FLIPPER.rest; f.w = 0; }
    f.dx = f.side * cos(f.a);
    f.dy = sin(f.a);
  }

  private moveBall(b: Ball) {
    if (b.held > 0) return;
    const px = b.x, py = b.y;
    b.vy += T.g * (b.layer ? T.rampG : 1) * DT;
    const damp = 1 - T.drag * DT;
    b.vx *= damp; b.vy *= damp;
    const v2 = b.vx * b.vx + b.vy * b.vy;
    if (v2 > T.maxV * T.maxV) { const s = T.maxV / Math.sqrt(v2); b.vx *= s; b.vy *= s; }
    // Saucer: a shallow dip that pulls the ball in, captures it when slow enough.
    if (b.layer === 0) {
      const sx = SAUCER.x - b.x, sy = SAUCER.y - b.y, d2 = sx * sx + sy * sy;
      if (d2 < 28 * 28) {
        const d = Math.sqrt(d2) + 1e-6;
        b.vx += (sx / d) * 2200 * DT; b.vy += (sy / d) * 2200 * DT;
        if (d < 9 && v2 < 650 * 650) {
          b.x = SAUCER.x; b.y = SAUCER.y; b.vx = 0; b.vy = 0; b.held = 1;
          this.hits.push({ sw: 'saucer', ball: b, speed: 0, dir: 0, x: b.x, y: b.y });
          return;
        }
      }
    }
    b.x += b.vx * DT;
    b.y += b.vy * DT;

    // Static colliders in this cell.
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(b.x / CELL)));
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor(b.y / CELL)));
    const list = this.grid[b.layer][r * COLS + c];
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (id >= 0) this.hitSeg(b, this.segs[id]);
      else this.hitCirc(b, this.circs[~id]);
    }
    if (b.layer === 0) for (const f of this.flippers) this.hitFlipper(b, f);
    const v2b = b.vx * b.vx + b.vy * b.vy;
    if (v2b > T.maxV * T.maxV) { const k = T.maxV / Math.sqrt(v2b); b.vx *= k; b.vy *= k; }

    // Sensors: did the centre cross the line this step?
    for (const s of this.sensors) {
      if (s.layer >= 0 && s.layer !== b.layer) continue;
      const s0 = (px - s.ax) * s.dy - (py - s.ay) * s.dx;
      const s1 = (b.x - s.ax) * s.dy - (b.y - s.ay) * s.dx;
      if ((s0 < 0) === (s1 < 0)) continue;
      // Where along the sensor did it cross?
      const t0 = s0 / (s0 - s1);
      const cx = px + (b.x - px) * t0, cy = py + (b.y - py) * t0;
      const u = ((cx - s.ax) * s.dx + (cy - s.ay) * s.dy) / (s.dx * s.dx + s.dy * s.dy);
      if (u < 0 || u > 1) continue;
      // dir +1 when moving up the table (or right-to-left for a vertical sensor).
      const dir = s1 > s0 ? 1 : -1;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (s.id === 'rampIn') {
        if (dir > 0 && b.layer === 0) b.layer = 1;
        else if (dir < 0 && b.layer === 1) b.layer = 0;
      } else if (s.id === 'rampOut') b.layer = 0;
      else if (s.id === 'spinner') this.spinner.w += Math.abs(b.vy) * 0.011;
      this.hits.push({ sw: s.id, ball: b, speed, dir, x: cx, y: cy });
    }
  }

  private hitSeg(b: Ball, s: Seg) {
    if (!s.on) return;
    let t = ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.ax + s.dx * t, cy = s.ay + s.dy * t;
    const ddx = b.x - cx, ddy = b.y - cy;
    const reach = BALL_R + s.w;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 >= reach * reach || d2 < 1e-12) return;
    if (s.oneway && (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny < 0) return;
    const d = Math.sqrt(d2);
    const nx = ddx / d, ny = ddy / d;
    const speed = this.resolve(b, nx, ny, reach - d, MATS[s.mat], 0, 0);
    if (s.mat === 'sling' && speed > 90) {
      b.vx += nx * T.slingKick; b.vy += ny * T.slingKick;
    }
    if (s.sw && speed > (s.drop ? 40 : 30)) {
      if (s.drop) s.on = false;
      this.hits.push({ sw: s.sw, ball: b, speed, dir: 0, x: cx, y: cy });
    }
  }

  private hitCirc(b: Ball, c: Circ) {
    const ddx = b.x - c.x, ddy = b.y - c.y;
    const reach = BALL_R + c.r;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 >= reach * reach || d2 < 1e-12) return;
    const d = Math.sqrt(d2);
    const nx = ddx / d, ny = ddy / d;
    const speed = this.resolve(b, nx, ny, reach - d, MATS[c.mat], 0, 0);
    if (c.mat === 'bumper' && speed > 15) {
      b.vx += nx * T.popKick; b.vy += ny * T.popKick;
    }
    if (c.sw && speed > 15) this.hits.push({ sw: c.sw, ball: b, speed, dir: 0, x: c.x, y: c.y });
  }

  private hitFlipper(b: Ball, f: Flipper) {
    const L = FLIPPER.len;
    const ex = f.dx * L, ey = f.dy * L;
    let t = ((b.x - f.x) * ex + (b.y - f.y) * ey) / (L * L);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = f.x + ex * t, cy = f.y + ey * t;
    const rad = FLIPPER.r0 + (FLIPPER.r1 - FLIPPER.r0) * t;
    const reach = BALL_R + rad;
    const ddx = b.x - cx, ddy = b.y - cy;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 >= reach * reach) return;
    let nx: number, ny: number, d: number;
    if (d2 < 1e-9) { nx = f.dy * f.side; ny = -f.dx * f.side; d = 0; }
    else { d = Math.sqrt(d2); nx = ddx / d; ny = ddy / d; }
    // Surface velocity at the contact point: omega x r, with omega in world terms.
    const om = f.w * f.side;
    const rx = cx + nx * rad - f.x, ry = cy + ny * rad - f.y;
    const speed = this.resolve(b, nx, ny, reach - d, MATS.flipper, -om * ry, om * rx);
    if (speed > 300) this.hits.push({ sw: 'flipperHit', ball: b, speed, dir: f.side, x: b.x, y: b.y });
  }

  /** Push the ball out along n and bounce it off a surface moving at (svx, svy). Returns impact speed. */
  private resolve(b: Ball, nx: number, ny: number, pen: number, m: { e: number; k: number; f: number }, svx: number, svy: number) {
    b.x += nx * pen; b.y += ny * pen;
    const rvx = b.vx - svx, rvy = b.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const e = m.e / (1 + m.k * -vn);
    let tx = rvx - vn * nx, ty = rvy - vn * ny;
    // Coulomb friction: tangential change capped by the normal impulse.
    const tl = Math.sqrt(tx * tx + ty * ty);
    if (tl > 1e-9) {
      const cut = Math.min(tl, m.f * (1 + e) * -vn);
      tx -= (tx / tl) * cut; ty -= (ty / tl) * cut;
    }
    b.vx = tx - e * vn * nx + svx;
    b.vy = ty - e * vn * ny + svy;
    return -vn;
  }

  private ballPairs() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.layer !== b.layer || a.held || b.held) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= 4 * BALL_R * BALL_R || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = (2 * BALL_R - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn >= 0) continue;
      const j2 = -vn * 0.95;
      a.vx -= nx * j2; a.vy -= ny * j2; b.vx += nx * j2; b.vy += ny * j2;
      this.hits.push({ sw: 'clack', ball: a, speed: -vn, dir: 0, x: a.x, y: a.y });
    }
  }

  eject(b: Ball, vx: number, vy: number) {
    b.held = 0; b.vx = vx; b.vy = vy;
    b.x += vx * 0.012; b.y += vy * 0.012; // clear the capture radius
  }
}
