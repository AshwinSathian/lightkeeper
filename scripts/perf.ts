// Frame times during play at phone size with the CPU throttled 4x. Usage: node scripts/perf.ts [url]
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const t = Date.now();
await page.goto(process.argv[2] ?? 'http://localhost:4173/');
await page.waitForFunction(() => document.querySelector('#gl')?.getAttribute('width'));
console.log('boot to canvas sized', Date.now() - t, 'ms (throttled)');
await page.waitForTimeout(800);
await page.click('#play');
await page.keyboard.down('Space'); await page.waitForTimeout(800); await page.keyboard.up('Space');
const ft = await page.evaluate(() => new Promise<number[]>((res) => {
  const out: number[] = []; let last = performance.now();
  const f = (now: number) => { out.push(now - last); last = now; if (out.length < 300) requestAnimationFrame(f); else res(out); };
  requestAnimationFrame(f);
}));
ft.sort((a, b) => a - b);
console.log('frames', ft.length, 'median', ft[150].toFixed(1), 'p95', ft[285].toFixed(1), 'ms');
await browser.close();
