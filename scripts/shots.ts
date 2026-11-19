import { Game, In } from '../src/game.ts';
import { HZ } from '../src/physics.ts';
// Roll a ball down an inlane onto a flipper, flip at varying delays, report what it hits.
const skip = new Set(['flipperHit', 'spin', 'sling', 'clack', 'inL', 'inR', 'shooter', 'rampIn', 'pop']);
for (const side of [0, 1]) {
  const out: string[] = [];
  for (let d = 0.30; d <= 0.80; d += 0.02) {
    const g = new Game(1, 'practice');
    const w = g.world;
    w.balls.length = 0;
    const b = w.addBall(side ? 472 : 88, 930);
    b.vx = side ? -40 : 40;
    g.phase = 'play';
    let t = 0;
    const flipAt = Math.round(d * HZ);
    const seen: string[] = [];
    for (; t < HZ * 4; t++) {
      if (t === flipAt) g.input(side ? In.RDown : In.LDown);
      if (t === flipAt + HZ * 0.25) g.input(side ? In.RUp : In.LUp);
      g.step();
      for (const e of g.events) if (e.t === 'sw' && !skip.has(e.sw)) seen.push(e.sw);
      g.events.length = 0;
      if (seen.length >= 2) break;
    }
    out.push(`${d.toFixed(2)}:${seen.slice(0, 2).join('+') || '-'}`);
  }
  console.log(side ? 'RIGHT' : 'LEFT', out.join('  '));
}
// Cradle: hold left flipper, drop ball from inlane, check it rests.
{
  const g = new Game(1, 'practice');
  g.world.balls.length = 0;
  const b = g.world.addBall(88, 930);
  g.phase = 'play';
  g.input(In.LDown);
  for (let i = 0; i < HZ * 3; i++) g.step();
  console.log('cradle', b.x.toFixed(1), b.y.toFixed(1), Math.hypot(b.vx, b.vy).toFixed(1), g.world.balls.length);
}
