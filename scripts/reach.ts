import { Game, In } from '../src/game.ts';
import { HZ } from '../src/physics.ts';
// Drop balls from many points, flip at many delays; tally which shots get made by each flipper.
const tally: Record<string, Record<string, number>> = { L: {}, R: {} };
for (let x = 120; x <= 440; x += 16) for (let vy = 0; vy <= 600; vy += 150) for (let d = 0.05; d <= 0.9; d += 0.025) {
  const g = new Game(1, 'practice');
  const w = g.world;
  w.balls.length = 0;
  const b = w.addBall(x, 780);
  b.vy = vy;
  g.phase = 'play';
  const side = x < 280 ? 'L' : 'R';
  const flipAt = Math.round(d * HZ);
  let got = '';
  for (let t = 0; t < HZ * 3 && !got; t++) {
    if (t === flipAt) { g.input(In.LDown); g.input(In.RDown); }
    if (t === flipAt + HZ * 0.2) { g.input(In.LUp); g.input(In.RUp); }
    g.step();
    for (const h of w.hits) {
      const touched = t > flipAt; // only count shots after the flip
      if (!touched) continue;
      if (h.sw === 'rampOut') got = 'ramp';
      else if (h.sw === 'orbit' && h.dir > 0) got = 'orbit';
      else if (h.sw === 'saucer') got = 'saucer';
      else if (h.sw.startsWith('dt')) got = 'targets';
      else if (h.sw.startsWith('lane')) got = 'lanes';
      else if (h.sw === 'pop') got = 'pops';
      else if (h.sw === 'drain') got = 'drain';
    }
  }
  if (got) tally[side][got] = (tally[side][got] ?? 0) + 1;
}
console.log(JSON.stringify(tally));
