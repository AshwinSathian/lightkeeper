import { Game, In } from '../src/game.ts';
import { HZ } from '../src/physics.ts';
// Departure direction of the ball after a flip, by timing. Angle from vertical, + = to the right.
for (const side of [0, 1]) {
  const out: string[] = [];
  for (let d = 0.2; d <= 0.62; d += 0.02) {
    const g = new Game(1, 'practice');
    const w = g.world;
    w.balls.length = 0;
    const b = w.addBall(side ? 472 : 88, 930);
    g.phase = 'play';
    const dn = side ? In.RDown : In.LDown;
    g.input(dn);
    for (let i = 0; i < HZ * 2; i++) g.step();
    g.input(side ? In.RUp : In.LUp);
    for (let t = 0; t < d * HZ; t++) g.step();
    g.input(dn);
    let res = 'x';
    for (let t = 0; t < HZ * 0.5; t++) {
      g.step();
      if (b.y < 960) { res = `${Math.round(Math.atan2(b.vx, -b.vy) * 57.3)}°/${Math.round(Math.hypot(b.vx, b.vy))}`; break; }
    }
    out.push(`${(d * 1000) | 0}:${res}`);
  }
  console.log(side ? 'R' : 'L', out.join(' '));
}
