// 128x32 dot-matrix display. Small text uses a hand-set 5x7 font; big text is the display
// face rasterised and thresholded, which keeps it crisp on the dots.
import { FONT } from './bake.ts';

export const DW = 128, DH = 32;

// Each glyph: 7 rows, 5 bits per row, as hex pairs.
const GLYPHS: Record<string, string> = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1e11111111111e', E: '1f10101e10101f',
  F: '1f10101e101010', G: '0e11101711110f', H: '1111111f111111', I: '0e04040404040e', J: '0702020202120c',
  K: '11121418141211', L: '1010101010101f', M: '111b1515111111', N: '11111915131111', O: '0e11111111110e',
  P: '1e11111e101010', Q: '0e11111115120d', R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404',
  U: '1111111111110e', V: '11111111110a04', W: '1111111515150a', X: '11110a040a1111', Y: '1111110a040404',
  Z: '1f01020408101f', '0': '0e11131519110e', '1': '040c040404040e', '2': '0e11010204081f', '3': '1f02040201110e',
  '4': '02060a121f0202', '5': '1f101e0101110e', '6': '0608101e11110e', '7': '1f010204080808', '8': '0e11110e11110e',
  '9': '0e11110f01020c', ' ': '00000000000000', '.': '00000000000c0c', ',': '000000000c0408', '!': '04040404040004',
  '?': '0e110102040004', ':': '000c0c000c0c00', '-': '0000001f000000', "'": '0c040800000000', '/': '00010204081000',
  '+': '0004041f040400', '%': '18190204081303', '<': '02040810080402', '>': '08040201020408', '_': '0000000000001f',
};
const ROWS: Record<string, number[]> = {};
const WIDTH: Record<string, [number, number]> = {}; // first column, width
for (const [ch, hex] of Object.entries(GLYPHS)) {
  const rows = Array.from({ length: 7 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  ROWS[ch] = rows;
  const or = rows.reduce((a, b) => a | b, 0);
  if (!or) { WIDTH[ch] = [0, 3]; continue; }
  let first = 0, last = 4;
  while (!(or & (16 >> first))) first++;
  while (!(or & (16 >> last))) last--;
  WIDTH[ch] = [first, last - first + 1];
}

export class Dmd {
  buf = new Uint8Array(DW * DH);
  private big = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private cache = new Map<string, { w: number; h: number; px: Uint8Array }>();

  constructor() {
    this.big.width = 512; this.big.height = 40;
    this.bctx = this.big.getContext('2d', { willReadFrequently: true })!;
  }

  clear() { this.buf.fill(0); }
  px(x: number, y: number, v = 255) {
    x |= 0; y |= 0;
    if (x >= 0 && x < DW && y >= 0 && y < DH && this.buf[y * DW + x] < v) this.buf[y * DW + x] = v;
  }
  fill(x: number, y: number, w: number, h: number, v = 255) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, v); }
  line(x0: number, y0: number, x1: number, y1: number, v = 255) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, v);
  }

  textWidth(s: string) {
    let w = 0;
    for (const ch of s.toUpperCase()) w += (WIDTH[ch] ?? WIDTH['?'])[1] + 1;
    return Math.max(0, w - 1);
  }
  /** 5x7 text. align: 0 left, 0.5 centre, 1 right. Scrolls if wider than the display. */
  text(s: string, x: number, y: number, v = 255, align = 0, t = 0) {
    s = s.toUpperCase();
    const w = this.textWidth(s);
    let cx = x - w * align;
    if (w > DW - 2) cx = DW - ((t * 0.04) % (w + DW)); // marquee
    for (const ch of s) {
      const rows = ROWS[ch] ?? ROWS['?'];
      const [first, cw] = WIDTH[ch] ?? WIDTH['?'];
      for (let r = 0; r < 7; r++) for (let c = 0; c < cw; c++) if (rows[r] & (16 >> (first + c))) this.px(cx + c, y + r, v);
      cx += cw + 1;
    }
  }

  private raster(s: string, size: number) {
    const key = s + '|' + size;
    let r = this.cache.get(key);
    if (r) return r;
    const g = this.bctx;
    g.clearRect(0, 0, 512, 40);
    g.font = `800 ${size}px ${FONT}`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    const w = Math.ceil(g.measureText(s).width) + 2;
    g.fillText(s, 1, size * 0.86);
    const h = Math.ceil(size * 0.9);
    const img = g.getImageData(0, 0, Math.min(512, w), h).data;
    const px = new Uint8Array(Math.min(512, w) * h);
    for (let i = 0; i < px.length; i++) px[i] = img[i * 4 + 3] > 110 ? 255 : 0;
    r = { w: Math.min(512, w), h, px };
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }
  /** Big text centred at cx, top at y. Shrinks to fit the width. */
  bigText(s: string, cx: number, y: number, size: number, v = 255, maxW = DW - 4) {
    let r = this.raster(s, size);
    while (r.w > maxW && size > 9) r = this.raster(s, --size);
    const x0 = Math.round(cx - r.w / 2);
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) if (r.px[j * r.w + i]) this.px(x0 + i, y + j, v);
    return r.h;
  }

  /** Tiny lighthouse with a turning beam, for the attract loop. */
  lighthouse(x: number, t: number, v = 255) {
    const base = 31, top = 8;
    for (let y = top; y <= base; y++) {
      const half = 2 + Math.floor(((y - top) / (base - top)) * 3);
      const band = Math.floor((y - top) / 4) % 2 === 1;
      for (let i = -half; i <= half; i++) this.px(x + i, y, band ? v * 0.45 : v);
    }
    this.fill(x - 3, top - 4, 7, 4, 160);
    this.px(x, top - 6, v); this.fill(x - 1, top - 5, 3, 1, v);
    const a = t * 0.0016;
    const dx = Math.cos(a), dy = Math.sin(a) * 0.35;
    for (let k = 4; k < 70; k++) {
      const spread = k * 0.18;
      for (let s = -spread; s <= spread; s += 1) this.px(x + dx * k - dy * s, top - 2 + dy * k + dx * s * 0.35, Math.max(0, 120 - k * 1.6));
    }
  }
}
