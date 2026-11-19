// Plays a whole 3-ball game with the keyboard (plunge, never flip), then saves initials.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e.stack)));
await page.goto(url);
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const t0 = Date.now();
let pauses = 0;
while (Date.now() - t0 < 150_000) {
  if (await page.locator('#over[open]').count()) break;
  await page.keyboard.down('Space'); await page.waitForTimeout(900); await page.keyboard.up('Space');
  if (pauses++ === 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log('pause dialog open:', await page.locator('#paused[open]').count() === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log('resumed:', await page.locator('#paused[open]').count() === 0);
  }
  await page.waitForTimeout(3000);
  console.log(Math.round((Date.now() - t0) / 1000), await page.evaluate(() => { const g = (window as any).__lk().game; return JSON.stringify({ ball: g.ball, phase: g.phase, over: g.over, score: g.score, balls: g.world.balls.map((b: any) => [b.x | 0, b.y | 0, b.vx | 0, b.vy | 0, b.held]) }); }));
}
console.log('game over after', Math.round((Date.now() - t0) / 1000), 's');
await page.screenshot({ path: 'docs/shots/flow-over.png' });
const score = await page.locator('#o-score').textContent();
console.log('score', score, 'initials form visible', await page.locator('#initials').isVisible());
await page.fill('#o-init', 'ash');
await page.click('#initials button');
await page.waitForTimeout(300);
console.log('saved', await page.evaluate(() => localStorage.getItem('lk.scores')));
await page.click('[data-act=replay]');
await page.waitForTimeout(3000);
console.log('replay bar', await page.locator('#replaybar').isVisible());
await page.screenshot({ path: 'docs/shots/flow-replay.png' });
console.log('errors', errs);
await browser.close();
