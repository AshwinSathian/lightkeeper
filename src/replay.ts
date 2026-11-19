// A game is its seed, its mode and the inputs with the tick each happened on.
// Packed as varints of (tickDelta * 16 + code), then base64url, so a whole game fits in a link.
import type { Mode } from './game.ts';

export interface Replay { v: 1; seed: number; mode: Mode; inputs: number[] } // inputs: [tick, code, tick, code, ...]

const MODES: Mode[] = ['classic', 'timed', 'practice'];

export function encode(r: Replay): string {
  const out: number[] = [];
  const varint = (n: number) => { while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); };
  varint(r.v); varint(MODES.indexOf(r.mode)); varint(r.seed >>> 0);
  let last = 0;
  for (let i = 0; i < r.inputs.length; i += 2) { varint((r.inputs[i] - last) * 16 + r.inputs[i + 1]); last = r.inputs[i]; }
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(text: string): Replay | null {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    let i = 0;
    const varint = () => {
      let n = 0, mul = 1, b: number;
      do { if (i >= bin.length) throw new Error('short'); b = bin.charCodeAt(i++); n += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
      return n;
    };
    if (varint() !== 1) return null;
    const mode = MODES[varint()];
    if (!mode) return null;
    const seed = varint();
    const inputs: number[] = [];
    let t = 0;
    while (i < bin.length) { const n = varint(); t += Math.floor(n / 16); inputs.push(t, n % 16); }
    return { v: 1, seed, mode, inputs };
  } catch { return null; }
}
