// The sim must give identical results on every JS engine. IEEE-754 + - * / and sqrt are exact
// everywhere, but Math.sin/cos are "implementation-approximated", so the sim uses these instead.
const PI = 3.141592653589793;
const TAU = 2 * PI;

export function sin(x: number): number {
  x = x % TAU;
  if (x > PI) x -= TAU;
  else if (x < -PI) x += TAU;
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  // Taylor series to x^15; error below 1e-9 on [-pi/2, pi/2].
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

export const cos = (x: number) => sin(x + PI / 2);
export const rad = (deg: number) => (deg * PI) / 180;

/** mulberry32: 32-bit integer PRNG, deterministic everywhere. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
