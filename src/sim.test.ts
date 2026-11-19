import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, In, type Mode } from './game.ts';
import { HZ } from './physics.ts';
import { rng } from './math.ts';
import { encode, decode } from './replay.ts';
import { sin, cos } from './math.ts';

/** A crude player: flips when a ball is near a flipper, plunges hard. Returns the input log. */
function play(seed: number, mode: Mode, maxTicks: number) {
  const g = new Game(seed, mode);
  const r = rng(seed ^ 0x9e3779b9);
  const log: number[] = [];
  const press = (c: In) => { log.push(g.tick, c); g.input(c); };
  let lUp = 0, rUp = 0, plungeAt = 0;
  while (!g.over && g.tick < maxTicks) {
    const lane = g.world.laneBall();
    if (lane && !g.plungerHeld && !plungeAt) { press(In.PDown); plungeAt = g.tick + Math.round(HZ * (0.5 + r() * 0.4)); }
    if (plungeAt && g.tick >= plungeAt) { press(In.PUp); plungeAt = 0; }
    for (const b of g.world.balls) {
      if (b.y > 990 && b.y < 1080 && b.vy > 0) {
        if (b.x < 280 && !lUp && r() < 0.08) { press(In.LDown); lUp = g.tick + 60; }
        if (b.x >= 280 && !rUp && r() < 0.08) { press(In.RDown); rUp = g.tick + 60; }
      }
    }
    if (lUp && g.tick >= lUp) { press(In.LUp); lUp = 0; }
    if (rUp && g.tick >= rUp) { press(In.RUp); rUp = 0; }
    if (r() < 0.0004) press(In.NudgeU);
    g.step();
    g.events.length = 0;
  }
  return { g, log };
}

function rerun(seed: number, mode: Mode, log: number[], maxTicks: number) {
  const g = new Game(seed, mode);
  let i = 0;
  while (!g.over && g.tick < maxTicks) {
    while (i < log.length && log[i] === g.tick) { g.input(log[i + 1] as In); i += 2; }
    g.step();
    g.events.length = 0;
  }
  return g;
}

test('trig matches Math within 1e-9', () => {
  for (let x = -20; x < 20; x += 0.013) {
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-9);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-9);
  }
});

test('same inputs give the same game', () => {
  const { g, log } = play(7, 'classic', HZ * 240);
  const g2 = rerun(7, 'classic', log, HZ * 240);
  assert.equal(g2.score, g.score);
  assert.equal(g2.tick, g.tick);
  assert.equal(g2.over, g.over);
  assert.ok(g.score > 0, 'the bot scored');
});

test('balls never leave the table or exceed max speed', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game(seed, 'practice');
    const r = rng(seed);
    for (let t = 0; t < HZ * 90; t++) {
      if (g.world.laneBall() && r() < 0.01) { g.input(In.PDown); for (let k = 0; k < 200; k++) g.step(); g.input(In.PUp); }
      if (r() < 0.01) g.input(r() < 0.5 ? In.LDown : In.RDown);
      if (r() < 0.01) g.input(r() < 0.5 ? In.LUp : In.RUp);
      g.step();
      g.events.length = 0;
      for (const b of g.world.balls) {
        assert.ok(b.x > 18 && b.x < 582 && b.y > 18, `seed ${seed}: ball escaped at ${b.x},${b.y}`);
        assert.ok(Math.hypot(b.vx, b.vy) <= 4201);
      }
    }
  }
});

test('three drop targets light the lock; three locks start multiball', () => {
  const g = new Game(1, 'classic');
  g.phase = 'play';
  Object.assign(g.world.balls[0], { x: 140, y: 470 });
  for (let k = 0; k < 3; k++) {
    g.world.resetTargets();
    g.targetsReset = 0;
    for (const s of g.world.segs) if (s.drop) s.on = false;
    // Fire the switches the way physics would.
    for (let i = 0; i < 3; i++) (g as any).onHit({ sw: 'dt' + i, ball: g.world.balls[0], speed: 500, dir: 0, x: 0, y: 0 });
    assert.equal(g.lockLit, true);
    (g as any).onHit({ sw: 'saucer', ball: g.world.balls[0], speed: 0, dir: 0, x: 0, y: 0 });
    g.saucerEject = 0;
  }
  assert.equal(g.multiball, true);
  assert.equal(g.pendingBalls, 2);
  for (let t = 0; t < HZ * 4; t++) g.step();
  assert.ok(g.world.balls.length >= 2, 'extra balls were fed');
});

test('a full plunge makes it out of the shooter lane', () => {
  const g = new Game(3, 'classic');
  g.input(In.PDown);
  for (let t = 0; t < HZ; t++) g.step();
  g.input(In.PUp);
  for (let t = 0; t < HZ; t++) g.step();
  assert.equal(g.phase, 'play');
});

test('replay codec round-trips and replays to the same score', () => {
  const { g, log } = play(11, 'classic', HZ * 200);
  const text = encode({ v: 1, seed: 11, mode: 'classic', inputs: log });
  const back = decode(text)!;
  assert.deepEqual(back.inputs, log);
  assert.equal(rerun(back.seed, back.mode, back.inputs, HZ * 200).score, g.score);
  assert.ok(text.length < 8000, `replay is ${text.length} chars`);
  assert.equal(decode('garbage!!'), null);
});
