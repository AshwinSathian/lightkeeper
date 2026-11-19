import { Game, In } from '../src/game.ts';
import { HZ } from '../src/physics.ts';
const rows: string[] = [];
for (let p = 0.5; p <= 1.0001; p += 0.02) {
  const g = new Game(1, 'classic');
  for (let i = 0; i < HZ * 0.3; i++) g.step();
  g.input(In.PDown);
  for (let i = 0; i < Math.round(HZ * 0.85 * p); i++) g.step();
  g.input(In.PUp);
  const seen: string[] = [];
  for (let i = 0; i < HZ * 8; i++) {
    g.step();
    for (const e of g.events) if (e.t === 'sw' && !['flipperHit', 'spin', 'pop', 'sling', 'plunge', 'shooter', 'clack'].includes(e.sw)) seen.push(e.sw);
    g.events.length = 0;
  }
  rows.push(`${p.toFixed(2)} ${[...new Set(seen)].slice(0, 8).join(',')}`);
}
console.log(rows.join('\n'));
