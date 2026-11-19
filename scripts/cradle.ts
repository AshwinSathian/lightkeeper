import { Game, In } from '../src/game.ts';
import { HZ } from '../src/physics.ts';
// Cradle a ball, let it roll off the flipper, re-flip after d seconds: what does each timing hit?
for (const side of [0, 1]) {
  const out: string[] = [];
  for (let d = 0.1; d <= 0.62; d += 0.012) {
    const g = new Game(1, 'practice');
    const w = g.world;
    w.balls.length = 0;
    w.addBall(side ? 472 : 88, 930);
    g.phase = 'play';
    const dn = side ? In.RDown : In.LDown, up = side ? In.RUp : In.LUp;
    g.input(dn);
    for (let i = 0; i < HZ * 2; i++) g.step();
    g.input(up);
    const at = Math.round(d * HZ);
    let got = '';
    let flipT = 0;
    for (let t = 0; t < HZ * 3 && !got; t++) {
      if (t === at) { g.input(dn); flipT = t; }
      if (t === at + HZ * 0.3) g.input(up);
      g.step();
      for (const h of w.hits) {
        if (t < flipT + 2) continue;
        if (h.sw === 'rampOut') got = 'RAMP';
        else if (h.sw === 'orbit' && h.dir > 0) got = 'ORBIT';
        else if (h.sw === 'saucer') got = 'SAUCER';
        else if (h.sw.startsWith('dt')) got = h.sw;
        else if (h.sw.startsWith('lane')) got = 'lane';
        else if (h.sw === 'pop') got = 'pop';
        else if (h.sw === 'drain') got = 'drain';
        else if (h.sw === 'sling') got = 'sling';
      }
    }
    const b = w.balls[0];
    out.push(`${(d * 1000) | 0}:${got || (b ? `${b.x | 0},${b.y | 0}` : '')}`);
  }
  console.log(side ? 'RIGHT' : 'LEFT', out.join(' '));
}
