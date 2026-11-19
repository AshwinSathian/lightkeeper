// Every sound is synthesised: solenoids are filtered noise plus a thump, scoring rings
// three electromechanical-style chime bells, and the ball rolls on a filtered noise bed.
let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let roll: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
let sea: GainNode | null = null;
let volume = 0.8;
const lastChime = [0, 0, 0];

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startBeds();
}

export function setVolume(v: number) {
  volume = v;
  if (ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

function startBeds() {
  if (!ctx) return;
  // Rolling ball.
  const src = ctx.createBufferSource();
  src.buffer = noise; src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 260; filter.Q.value = 0.7;
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  roll = { src, gain, filter };
  // Sea, very low, slowly swelling.
  const s = ctx.createBufferSource();
  s.buffer = noise; s.loop = true; s.playbackRate.value = 0.5;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  sea = ctx.createGain(); sea.gain.value = 0.0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
  const depth = ctx.createGain(); depth.gain.value = 0.012;
  lfo.connect(depth).connect(sea.gain);
  s.connect(lp).connect(sea).connect(master);
  s.start(); lfo.start();
}

export function setSea(on: boolean) {
  if (ctx && sea) sea.gain.setTargetAtTime(on ? 0.022 : 0, ctx.currentTime, 1.2);
}

/** Called each frame with the fastest ball's speed and whether it's on the ramp. */
export function rolling(speed: number, ramp: boolean) {
  if (!ctx || !roll) return;
  const t = ctx.currentTime;
  const g = Math.min(0.12, speed / 30000);
  roll.gain.gain.setTargetAtTime(g, t, 0.05);
  roll.filter.frequency.setTargetAtTime((ramp ? 900 : 180) + speed * (ramp ? 0.25 : 0.08), t, 0.05);
}

function out(pan: number) {
  const p = ctx!.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(master);
  return p;
}

function burst(pan: number, freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', at = 0) {
  const c = ctx!, t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out(pan));
  s.start(t, Math.random() * 1.5, dur + 0.02);
}

function tone(pan: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', at = 0) {
  const c = ctx!, t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out(pan));
  o.start(t); o.stop(t + dur + 0.02);
}

/** Struck bell: three inharmonic partials with their own decays. */
function bell(freq: number, gain: number, at = 0, pan = 0) {
  const parts: [number, number, number][] = [[1, 1, 1.6], [2.76, 0.45, 0.7], [5.4, 0.2, 0.35]];
  for (const [m, g, d] of parts) tone(pan, freq * m, freq * m * 0.998, d, gain * g, 'sine', at);
}

const CHIMES = [1318.5, 987.8, 659.3]; // 10s, 100s, 1000s

export function chime(points: number) {
  if (!ctx) return;
  const i = points >= 10_000 ? 2 : points >= 1_000 ? 1 : 0;
  const now = ctx.currentTime;
  if (now - lastChime[i] < 0.07) return;
  lastChime[i] = now;
  bell(CHIMES[i], 0.16);
}

export type Sfx = 'flipUp' | 'flipDown' | 'pop' | 'sling' | 'lane' | 'spin' | 'target' | 'saucer' | 'eject' | 'plunge'
  | 'drain' | 'kick' | 'clack' | 'tilt' | 'warn' | 'nudge' | 'reset' | 'post' | 'ramp' | 'gate';

export function sfx(name: Sfx, x = 280, power = 1) {
  if (!ctx) return;
  const pan = (x - 280) / 320;
  switch (name) {
    case 'flipUp': burst(pan, 1900, 1.2, 0.05, 0.5); tone(pan, 140, 55, 0.07, 0.5); break;
    case 'flipDown': burst(pan, 1200, 1, 0.035, 0.16); break;
    case 'pop': tone(pan, 210, 60, 0.12, 0.6, 'triangle'); burst(pan, 2600, 2, 0.06, 0.35); break;
    case 'sling': burst(pan, 1500, 1.5, 0.06, 0.45); tone(pan, 120, 50, 0.08, 0.45); break;
    case 'lane': tone(pan, 3100, 2800, 0.02, 0.12); break;
    case 'spin': burst(pan, 4200, 6, 0.012, 0.12); break;
    case 'target': burst(pan, 900, 2, 0.05, 0.5); tone(pan, 300, 110, 0.05, 0.3, 'square'); break;
    case 'saucer': tone(pan, 90, 40, 0.18, 0.6); burst(pan, 500, 1, 0.08, 0.3, 'lowpass'); break;
    case 'eject': burst(pan, 1100, 1, 0.07, 0.55); tone(pan, 160, 60, 0.1, 0.5); break;
    case 'plunge': burst(pan, 700 + power * 1200, 0.8, 0.14, 0.4 + power * 0.3); tone(pan, 90, 40, 0.12, 0.4); break;
    case 'drain': tone(0, 196, 65, 0.7, 0.28, 'triangle'); tone(0, 147, 49, 0.9, 0.18, 'sine', 0.12); break;
    case 'kick': burst(pan, 1400, 1, 0.08, 0.6); tone(pan, 150, 55, 0.1, 0.6); break;
    case 'clack': tone(pan, 2400, 1800, 0.03, Math.min(0.4, power / 3000)); break;
    case 'tilt': tone(0, 70, 66, 0.8, 0.35, 'sawtooth'); break;
    case 'warn': tone(0, 140, 135, 0.18, 0.25, 'square'); tone(0, 140, 135, 0.18, 0.25, 'square', 0.25); break;
    case 'nudge': tone(0, 80, 40, 0.12, 0.5); burst(0, 300, 0.7, 0.1, 0.3, 'lowpass'); break;
    case 'reset': burst(pan, 700, 1.5, 0.05, 0.4); burst(pan, 900, 1.5, 0.05, 0.35, 'bandpass', 0.04); break;
    case 'post': burst(pan, 2200, 3, 0.02, Math.min(0.25, power / 5000)); break;
    case 'ramp': tone(pan, 600, 1200, 0.25, 0.1, 'sine'); break;
    case 'gate': burst(pan, 3000, 4, 0.02, 0.15); break;
  }
}

/** Short tunes made from the same bells. */
export function fanfare(kind: 'multiball' | 'jackpot' | 'skill' | 'complete' | 'extra' | 'save' | 'start' | 'over' | 'night' | 'lock') {
  if (!ctx) return;
  const seq: Record<typeof kind, [number, number][]> = {
    start: [[523.3, 0], [659.3, 0.09], [784, 0.18]],
    skill: [[784, 0], [987.8, 0.07], [1318.5, 0.14], [1568, 0.21]],
    lock: [[659.3, 0], [523.3, 0.12]],
    save: [[880, 0], [880, 0.12]],
    extra: [[523.3, 0], [659.3, 0.1], [784, 0.2], [1046.5, 0.3], [1318.5, 0.45]],
    complete: [[659.3, 0], [784, 0.1], [987.8, 0.2], [1318.5, 0.32]],
    jackpot: [[523.3, 0], [659.3, 0], [784, 0], [1046.5, 0.18], [1318.5, 0.18], [1568, 0.18]],
    multiball: [[392, 0], [523.3, 0.12], [659.3, 0.24], [784, 0.36], [1046.5, 0.5], [784, 0.62], [1046.5, 0.74], [1318.5, 0.9]],
    night: [[220, 0], [277.2, 0.3], [329.6, 0.6], [440, 0.9]],
    over: [[523.3, 0], [392, 0.22], [329.6, 0.44], [261.6, 0.7]],
  };
  for (const [f, at] of seq[kind]) bell(f, kind === 'night' ? 0.2 : 0.13, at);
}
