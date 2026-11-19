// Screenshots at the sizes we care about, plus console errors. Usage: node scripts/shoot.ts [url] [outdir]
import { chromium, devices } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'docs/shots';
const sizes: [string, number, number, number, boolean][] = [
  ['phone', 390, 844, 3, true], ['phone-land', 844, 390, 3, true], ['tablet', 820, 1180, 2, true], ['tablet-land', 1180, 820, 2, true], ['desktop', 1440, 900, 1, false],
];
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, w, h, dpr, touch] of sizes) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.stack)));
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}-menu.png` });
  if (process.env.PLAY) {
    await page.click('#play');
    await page.waitForTimeout(400);
    await page.keyboard.down('Space'); await page.waitForTimeout(700); await page.keyboard.up('Space');
    await page.waitForTimeout(1600);
    await page.keyboard.down('KeyZ'); await page.keyboard.down('Slash');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-play.png` });
    await page.keyboard.up('KeyZ'); await page.keyboard.up('Slash');
  }
  console.log(name, errs.length ? errs.slice(0, 5).join('\n  ') : 'no errors');
  await ctx.close();
}
await browser.close();
