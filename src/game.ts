// Rules and game flow on top of the physics. Everything here is deterministic too:
// time is counted in ticks, randomness comes from the seeded rng.
import { rng } from './math.ts';
import { HZ, World, type Ball, type Hit } from './physics.ts';
import { LAMPS, LAMP_INDEX, SAUCER } from './table.ts';

export const In = { LDown: 0, LUp: 1, RDown: 2, RUp: 3, PDown: 4, PUp: 5, NudgeL: 6, NudgeU: 7, NudgeR: 8 } as const;
export type In = (typeof In)[keyof typeof In];
export type Mode = 'classic' | 'timed' | 'practice';

/** Lamp states. */
export const OFF = 0, ON = 1, SLOW = 2, FAST = 3;

export type Watch = 'fog' | 'squall' | 'rescue';
const WATCHES: Watch[] = ['fog', 'squall', 'rescue'];
const RESCUE_SHOTS = ['ramp', 'orbit', 'saucer'] as const;

/** Things the presentation layer reacts to: sounds, DMD scenes, lamp shows. */
export type Ev =
  | { t: 'sw'; sw: string; x: number; y: number; speed: number }
  | { t: 'show'; title: string; sub?: string; value?: number; big?: boolean; ms?: number }
  | { t: 'fx'; kind: 'multiball' | 'jackpot' | 'drain' | 'tilt' | 'warn' | 'save' | 'skill' | 'complete' | 'extra' | 'night' | 'lock' | 'start' | 'over' };

const s = (sec: number) => Math.round(sec * HZ);

export class Game {
  world = new World();
  tick = 0;
  rand: () => number;
  events: Ev[] = [];
  lamps = new Uint8Array(LAMPS.length);

  score = 0;
  ball = 1;
  balls: number; // balls per game; Infinity for timed and practice
  extraBalls = 0;
  over = false;
  clock: number; // ticks left in timed mode

  // Per-ball state
  phase: 'lane' | 'play' | 'bonus' = 'lane';
  bonus = 0;
  mult = 1;
  saveUntil = 0;
  skillLane = 0;
  skillUntil = 0;
  tilted = false;
  tiltMeter = 0;
  warnings = 0;
  bonusUntil = 0;

  // Persistent through the game
  lanes = [false, false, false];
  popHits = 0;
  popLevel = 0;
  locks = 0;
  lockLit = false;
  ebLit = false;
  kickback = true;
  ramps = 0;
  watchIdx = 0;
  watchDone = new Set<Watch>();
  watch: Watch | 'night' | null = null;
  watchUntil = 0;
  watchCount = 0;
  rescueShot = 0;
  multiball = false;
  jackpot = 100_000;
  jackpots = 0;
  superLit = false;
  lastShot = { t: -1e9, id: '' };
  combo = 0;
  autoPlunge = 0; // tick to auto-launch a ball in the lane
  pendingBalls = 0; // balls still to be fed to the lane for multiball
  plungerHeld = 0; // tick the plunger was pulled, 0 when released
  saucerEject = 0;
  targetsReset = 0;

  seed: number;
  mode: Mode;

  constructor(seed: number, mode: Mode) {
    this.seed = seed;
    this.mode = mode;
    this.rand = rng(seed);
    this.balls = mode === 'classic' ? 3 : Infinity;
    this.clock = mode === 'timed' ? s(180) : 0;
    this.newBall();
    this.emit({ t: 'fx', kind: 'start' });
  }

  private emit(e: Ev) { this.events.push(e); }
  private show(title: string, sub?: string, value?: number, big = false, ms = 1800) { this.emit({ t: 'show', title, sub, value, big, ms }); }
  private add(points: number, bonus = 0) {
    if (this.tilted) return;
    this.score += points;
    this.bonus += bonus;
  }

  plungerPower(): number {
    if (!this.plungerHeld) return 0;
    return Math.min(1, (this.tick - this.plungerHeld) / s(0.85));
  }

  /** Apply one input at the current tick. */
  input(code: In) {
    if (this.over) return;
    const w = this.world;
    const dead = this.tilted || this.phase === 'bonus';
    switch (code) {
      case In.LDown: if (!dead) { w.flippers[0].held = true; this.laneChange(-1); } break;
      case In.LUp: w.flippers[0].held = false; break;
      case In.RDown: if (!dead) { w.flippers[1].held = true; this.laneChange(1); } break;
      case In.RUp: w.flippers[1].held = false; break;
      case In.PDown: if (w.laneBall() && !this.plungerHeld) this.plungerHeld = this.tick || 1; break;
      case In.PUp:
        if (this.plungerHeld) {
          const p = this.plungerPower();
          this.plungerHeld = 0;
          if (w.plunge(p)) this.emit({ t: 'sw', sw: 'plunge', x: 560, y: 1150, speed: p });
        }
        break;
      case In.NudgeL: case In.NudgeU: case In.NudgeR: this.nudge(code === In.NudgeL ? -1 : code === In.NudgeR ? 1 : 0); break;
    }
  }

  private laneChange(dir: number) {
    if (this.phase !== 'play') return;
    const l = this.lanes;
    this.lanes = dir < 0 ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]];
  }

  private nudge(dir: number) {
    if (this.tilted) return;
    for (const b of this.world.balls) if (!b.held) { b.vx += dir * 150; b.vy -= 210; }
    this.emit({ t: 'sw', sw: 'nudge', x: 280, y: 1100, speed: dir });
    this.tiltMeter += 1;
    if (this.tiltMeter > 2.4) {
      this.tiltMeter = 0;
      this.warnings++;
      if (this.warnings >= 3) {
        this.tilted = true;
        for (const f of this.world.flippers) f.held = false;
        this.show('TILT', undefined, undefined, true, 3000);
        this.emit({ t: 'fx', kind: 'tilt' });
      } else {
        this.show('WARNING', this.warnings === 1 ? 'EASY ON THE GLASS' : 'ONE MORE AND IT TILTS', undefined, false, 1400);
        this.emit({ t: 'fx', kind: 'warn' });
      }
    }
  }

  private newBall() {
    this.world.addBall();
    this.phase = 'lane';
    this.bonus = 0;
    this.mult = 1;
    this.tilted = false;
    this.warnings = 0;
    this.tiltMeter = 0;
    this.skillLane = Math.floor(this.rand() * 3);
    this.combo = 0;
  }

  step() {
    if (this.over) return;
    const w = this.world;
    this.tick++;
    this.tiltMeter = Math.max(0, this.tiltMeter - 0.6 / HZ);

    if (this.mode === 'timed' && this.phase !== 'bonus') {
      this.clock--;
      if (this.clock === s(10)) this.show('10 SECONDS', 'MAKE THEM COUNT');
      if (this.clock <= 0) return this.endGame();
    }

    // Feed the lane: auto-launch for ball saves and multiball.
    if (this.pendingBalls > 0 && !w.balls.some((b) => b.x > 540 && b.y > 900)) {
      w.addBall();
      this.pendingBalls--;
      this.autoPlunge = this.tick + s(0.6);
    }
    if (this.autoPlunge && this.tick >= this.autoPlunge) {
      if (w.plunge(0.94 + this.rand() * 0.04)) this.emit({ t: 'sw', sw: 'plunge', x: 560, y: 1150, speed: 1 });
      this.autoPlunge = 0;
    }

    if (this.saucerEject && this.tick >= this.saucerEject) {
      const b = w.balls.find((b) => b.held);
      if (b) {
        w.eject(b, 620 + this.rand() * 120, 420 + this.rand() * 80);
        this.emit({ t: 'sw', sw: 'eject', x: SAUCER.x, y: SAUCER.y, speed: 1 });
      }
      this.saucerEject = 0;
    }
    if (this.targetsReset && this.tick >= this.targetsReset) {
      w.resetTargets();
      this.targetsReset = 0;
      this.emit({ t: 'sw', sw: 'reset', x: 280, y: 562, speed: 1 });
    }
    if (this.watch && this.tick >= this.watchUntil) this.endWatch(false);

    w.step();
    for (const h of w.hits) this.onHit(h);

    if (this.phase === 'bonus' && this.tick >= this.bonusUntil) this.afterBonus();
    this.updateLamps();
  }

  private onHit(h: Hit) {
    this.emit({ t: 'sw', sw: h.sw, x: h.x, y: h.y, speed: h.speed });
    const night = this.watch === 'night';
    switch (h.sw) {
      case 'drain': return this.drained();
      case 'shooter':
        if (h.dir > 0 && this.phase === 'lane') {
          this.phase = 'play';
          if (this.mode === 'practice' || this.saveUntil < this.tick) this.saveUntil = this.tick + s(this.mode === 'practice' ? 1e6 : 8);
          if (!this.multiball) this.skillUntil = this.tick + s(4);
        }
        return;
      case 'lane0': case 'lane1': case 'lane2': {
        const i = +h.sw[4];
        if (this.skillUntil > this.tick) {
          this.skillUntil = 0;
          if (i === this.skillLane) {
            this.add(50_000, 5_000);
            this.show('SKILL SHOT', undefined, 50_000, true);
            this.emit({ t: 'fx', kind: 'skill' });
          }
        }
        this.add(1_000, 1_000);
        if (!this.lanes[i]) {
          this.lanes[i] = true;
          if (this.lanes.every(Boolean)) {
            this.lanes = [false, false, false];
            if (this.mult < 5) {
              this.mult++;
              this.show(`BONUS ${this.mult}X`, 'LANES COMPLETE');
            } else { this.add(25_000); this.show('LANES COMPLETE', undefined, 25_000); }
          }
        }
        return;
      }
      case 'pop': {
        this.popHits++;
        const base = 300 + this.popLevel * 200;
        this.add(this.watch === 'squall' ? base * 10 : night ? 2_000 : base, 100);
        if (this.popHits % 25 === 0 && this.popLevel < 4) { this.popLevel++; this.show('BUMPERS UP', `${300 + this.popLevel * 200} A HIT`); }
        if (this.watch === 'squall' && ++this.watchCount >= 30) this.endWatch(true);
        return;
      }
      case 'sling': this.add(50, 50); return;
      case 'spin':
        this.add(this.watch === 'fog' ? 500 : 100, 10);
        if (this.watch === 'fog' && ++this.watchCount >= 40) this.endWatch(true);
        return;
      case 'dt0': case 'dt1': case 'dt2': {
        this.add(2_500, 1_000);
        const w = this.world;
        if (!w.targetUp(0) && !w.targetUp(1) && !w.targetUp(2) && !this.targetsReset) {
          this.targetsReset = this.tick + s(1.2);
          this.add(10_000);
          if (this.multiball) { this.add(25_000); this.show('TARGETS', undefined, 35_000); }
          else if (!this.lockLit) { this.lockLit = true; this.show('LOCK IS LIT', 'SHOOT THE LAMP ROOM'); this.emit({ t: 'fx', kind: 'lock' }); }
          else this.show('TARGETS', 'LOCK ALREADY LIT', 10_000);
        }
        return;
      }
      case 'rampIn': return;
      case 'rampOut': return this.majorShot('ramp', 25_000);
      case 'orbit': if (h.dir > 0) this.majorShot('orbit', 20_000); return;
      case 'saucer': return this.saucer(h.ball);
      case 'inL': case 'inR': this.add(1_000, 1_000); return;
      case 'outL':
        if (h.dir < 0 && !this.kickback) this.add(5_000, 0);
        return;
      case 'kick':
        if (h.dir < 0 && this.kickback && !this.tilted) {
          this.kickback = false;
          h.ball.vx = 0; h.ball.vy = -2350;
          this.emit({ t: 'sw', sw: 'kickback', x: h.x, y: h.y, speed: 1 });
          this.show('KICKBACK', '3 RAMPS RELIGHT IT', undefined, false, 1200);
        }
        return;
    }
  }

  private majorShot(id: 'ramp' | 'orbit', base: number) {
    if (this.tilted) return;
    const night = this.watch === 'night';
    // Combos: two major shots within three seconds.
    if (this.tick - this.lastShot.t < s(3)) {
      this.combo++;
      this.add(this.combo * 15_000);
      this.show(`COMBO ${this.combo + 1}`, undefined, this.combo * 15_000, false, 1200);
    } else this.combo = 0;
    this.lastShot = { t: this.tick, id };

    if (id === 'ramp') {
      this.ramps++;
      this.add(night ? 50_000 : base, 5_000);
      if (this.ramps % 3 === 0 && !this.kickback) { this.kickback = true; this.show('KICKBACK LIT'); }
    } else this.add(night ? 50_000 : base, 4_000);

    if (this.multiball) {
      this.add(this.jackpot);
      this.show('JACKPOT', undefined, this.jackpot, true, 2200);
      this.emit({ t: 'fx', kind: 'jackpot' });
      this.jackpot += 25_000;
      if (++this.jackpots % 3 === 0) { this.superLit = true; this.show('SUPER JACKPOT LIT', 'SHOOT THE LAMP ROOM'); }
    }
    if (this.watch === 'rescue' && RESCUE_SHOTS[this.rescueShot] === id) this.rescueHit();
  }

  private rescueHit() {
    this.add(50_000);
    this.watchCount++;
    this.show('RESCUE', `${this.watchCount} OF 3`, 50_000);
    if (this.watchCount >= 3) this.endWatch(true);
    else this.rescueShot = (this.rescueShot + 1 + Math.floor(this.rand() * 2)) % 3;
  }

  private saucer(b: Ball) {
    const hold = (sec: number) => { b.held = 1; this.saucerEject = this.tick + s(sec); };
    if (this.tilted) return hold(0.4);
    this.add(5_000, 2_000);
    if (this.watch === 'rescue' && RESCUE_SHOTS[this.rescueShot] === 'saucer') this.rescueHit();
    if (this.multiball) {
      if (this.superLit) {
        this.superLit = false;
        const v = this.jackpot * 4;
        this.add(v);
        this.show('SUPER JACKPOT', undefined, v, true, 2600);
        this.emit({ t: 'fx', kind: 'jackpot' });
        return hold(2);
      }
      return hold(0.5);
    }
    if (this.lockLit) {
      this.lockLit = false;
      this.locks++;
      if (this.locks === 3) {
        this.locks = 0;
        this.multiball = true;
        this.jackpots = 0;
        this.pendingBalls = 2;
        this.saveUntil = this.tick + s(15);
        this.show('MULTIBALL', 'EVERY SHOT IS A JACKPOT', undefined, true, 2800);
        this.emit({ t: 'fx', kind: 'multiball' });
        return hold(2.4);
      }
      this.show(`BALL ${this.locks} LOCKED`, `${3 - this.locks} MORE FOR MULTIBALL`);
      this.emit({ t: 'fx', kind: 'lock' });
      return hold(1.4);
    }
    if (this.ebLit) {
      this.ebLit = false;
      this.extraBalls++;
      this.show('EXTRA BALL', undefined, undefined, true, 2400);
      this.emit({ t: 'fx', kind: 'extra' });
      return hold(1.8);
    }
    if (!this.watch) {
      if (this.watchDone.size === 3) {
        this.watch = 'night';
        this.watchUntil = this.tick + s(45);
        this.saveUntil = this.tick + s(45);
        this.watchDone.clear();
        this.show('LONG NIGHT', 'EVERY SHOT 50,000', undefined, true, 3000);
        this.emit({ t: 'fx', kind: 'night' });
        return hold(2.6);
      }
      // Next unfinished watch.
      let w = WATCHES[this.watchIdx % 3];
      while (this.watchDone.has(w)) w = WATCHES[++this.watchIdx % 3];
      this.watchIdx++;
      this.watch = w;
      this.watchCount = 0;
      this.watchUntil = this.tick + s(30);
      if (w === 'rescue') this.rescueShot = 0;
      const sub = { fog: 'SPINNER 5X  40 SPINS', squall: 'BUMPERS 10X  30 HITS', rescue: 'FOLLOW THE LIT SHOT' }[w];
      this.show(w.toUpperCase(), sub, undefined, true, 2400);
      return hold(2);
    }
    hold(0.6);
  }

  private endWatch(won: boolean) {
    const w = this.watch;
    this.watch = null;
    if (!w) return;
    if (w === 'night') { this.show('DAWN', 'LONG NIGHT OVER', undefined, true); return; }
    if (won) {
      this.watchDone.add(w);
      this.add(150_000, 10_000);
      this.show(`${w.toUpperCase()} DONE`, undefined, 150_000, true);
      this.emit({ t: 'fx', kind: 'complete' });
      if (this.watchDone.size === 2) { this.ebLit = true; this.show('EXTRA BALL LIT', 'AT THE LAMP ROOM'); }
      if (this.watchDone.size === 3) this.show('LONG NIGHT IS LIT', 'SHOOT THE LAMP ROOM');
    } else this.show(`${w.toUpperCase()} OVER`, 'TRY AGAIN AT THE LAMP ROOM');
  }

  private drained() {
    const w = this.world;
    if (this.phase === 'bonus') return;
    if (!this.tilted && this.tick < this.saveUntil) {
      this.pendingBalls++;
      if (!this.multiball) this.saveUntil = 0;
      this.show('BALL SAVED', undefined, undefined, true, 1500);
      this.emit({ t: 'fx', kind: 'save' });
      return;
    }
    const left = w.balls.length + this.pendingBalls;
    if (left > 1) return;
    if (left === 1) {
      if (this.multiball) { this.multiball = false; this.superLit = false; this.show('MULTIBALL OVER', `JACKPOT NOW ${this.jackpot.toLocaleString('en-US')}`); }
      return;
    }
    // Last ball gone.
    if (this.watch && this.watch !== 'night') this.endWatch(false);
    this.watch = null;
    this.multiball = false;
    for (const f of w.flippers) f.held = false;
    this.phase = 'bonus';
    this.bonusUntil = this.tick + s(this.tilted ? 1.5 : 2.6);
    if (!this.tilted) {
      const total = this.bonus * this.mult;
      this.add(total);
      this.show('BONUS', this.mult > 1 ? `${this.bonus.toLocaleString('en-US')} X ${this.mult}` : undefined, total, false, 2400);
    }
    this.emit({ t: 'fx', kind: 'drain' });
  }

  private afterBonus() {
    if (this.extraBalls > 0) {
      this.extraBalls--;
      this.show('SHOOT AGAIN', 'SAME PLAYER');
    } else if (this.ball >= this.balls) return this.endGame();
    else this.ball++;
    this.newBall();
  }

  private endGame() {
    this.over = true;
    for (const f of this.world.flippers) f.held = false;
    this.emit({ t: 'fx', kind: 'over' });
  }

  private setLamp(id: string, v: number) { this.lamps[LAMP_INDEX[id]] = v; }

  private updateLamps() {
    if (this.tilted) { this.lamps.fill(0); return; }
    const skill = this.skillUntil > this.tick || this.phase === 'lane';
    for (let i = 0; i < 3; i++) {
      this.setLamp('lane' + i, skill && i === this.skillLane ? FAST : this.lanes[i] ? ON : OFF);
      this.setLamp('dt' + i, this.world.targetUp(i) ? SLOW : OFF);
      this.setLamp('lock' + (i + 1), this.locks > i ? ON : this.lockLit && this.locks === i ? FAST : OFF);
      this.setLamp('ramp' + (i + 1), this.ramps % 3 > i ? ON : OFF);
    }
    const rescue = this.watch === 'rescue' ? RESCUE_SHOTS[this.rescueShot] : '';
    const night = this.watch === 'night';
    this.setLamp('saucer', this.superLit || rescue === 'saucer' ? FAST : this.lockLit || this.ebLit || (!this.watch && !this.multiball) ? SLOW : night ? ON : OFF);
    this.setLamp('eb', this.ebLit ? SLOW : OFF);
    this.setLamp('ramp', this.multiball || rescue === 'ramp' ? FAST : night ? ON : OFF);
    this.setLamp('orbit', this.multiball || rescue === 'orbit' ? FAST : night ? ON : OFF);
    this.setLamp('kick', this.kickback ? ON : OFF);
    this.setLamp('inL', this.tick - this.lastShot.t < s(3) ? SLOW : OFF);
    this.setLamp('inR', this.tick - this.lastShot.t < s(3) ? SLOW : OFF);
    for (const w of WATCHES) this.setLamp(w, this.watch === w ? FAST : this.watchDone.has(w) ? ON : OFF);
    this.setLamp('night', night ? FAST : this.watchDone.size === 3 ? SLOW : OFF);
    for (let m = 2; m <= 5; m++) this.setLamp('x' + m, this.mult >= m ? ON : OFF);
    this.setLamp('again', this.extraBalls > 0 ? ON : this.saveUntil > this.tick && this.mode !== 'practice' ? (this.saveUntil - this.tick < s(2) ? FAST : SLOW) : this.mode === 'practice' ? ON : OFF);
  }

  /** Watch countdown in seconds, for the display. */
  watchLeft() { return this.watch ? Math.ceil((this.watchUntil - this.tick) / HZ) : 0; }
}
