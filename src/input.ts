// Keyboard, touch/mouse and gamepad, all turned into the sim's input codes with the
// time each happened, so the loop can apply them at the right tick rather than the next frame.
import { In } from './game.ts';

export type Action = In | 'pause' | 'start' | 'any';
export type Sink = (a: Action, time: number) => void;

const KEYS: Record<string, [In, In] | 'pause' | 'start'> = {
  KeyZ: [In.LDown, In.LUp], ShiftLeft: [In.LDown, In.LUp], ArrowLeft: [In.LDown, In.LUp], ControlLeft: [In.LDown, In.LUp],
  Slash: [In.RDown, In.RUp], ShiftRight: [In.RDown, In.RUp], ArrowRight: [In.RDown, In.RUp], ControlRight: [In.RDown, In.RUp],
  Space: [In.PDown, In.PUp], Enter: [In.PDown, In.PUp], ArrowDown: [In.PDown, In.PUp],
  ArrowUp: [In.NudgeU, In.NudgeU], KeyX: [In.NudgeL, In.NudgeL], Period: [In.NudgeR, In.NudgeR],
  Escape: 'pause', KeyP: 'pause',
};

export function bindInput(stage: HTMLElement, sink: Sink, plungerReady: () => boolean, active: () => boolean) {
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || !active()) { sink('any', e.timeStamp); if (KEYS[e.code] === 'pause') sink('pause', e.timeStamp); return; }
    const k = KEYS[e.code];
    sink('any', e.timeStamp);
    if (!k) return;
    if (active()) e.preventDefault();
    if (e.repeat) return;
    if (k === 'pause' || k === 'start') return sink(k, e.timeStamp);
    if (k[0] === In.NudgeU || k[0] === In.NudgeL || k[0] === In.NudgeR) return sink(k[0], e.timeStamp);
    sink(k[0], e.timeStamp);
  });
  addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (!k || k === 'pause' || k === 'start') return;
    if (k[0] === In.NudgeU || k[0] === In.NudgeL || k[0] === In.NudgeR) return;
    sink(k[1], e.timeStamp);
  });

  // Pointers: left half is the left flipper, right half the right one. While a ball sits on the
  // plunger, holding the right half also pulls it. A quick upward flick nudges the table.
  const ptrs = new Map<number, { side: 0 | 1; x: number; y: number; t: number; plunger: boolean; nudged: boolean }>();
  stage.addEventListener('pointerdown', (e) => {
    if (!active()) return;
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    const side = e.clientX < innerWidth / 2 ? 0 : 1;
    const plunger = side === 1 && plungerReady();
    ptrs.set(e.pointerId, { side, x: e.clientX, y: e.clientY, t: e.timeStamp, plunger, nudged: false });
    sink(side ? In.RDown : In.LDown, e.timeStamp);
    if (plunger) sink(In.PDown, e.timeStamp);
  });
  stage.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || p.nudged || p.plunger) return;
    const dy = p.y - e.clientY, dx = e.clientX - p.x;
    if (dy > 46 && e.timeStamp - p.t < 220) {
      p.nudged = true;
      sink(Math.abs(dx) < dy * 0.5 ? In.NudgeU : dx < 0 ? In.NudgeL : In.NudgeR, e.timeStamp);
    }
  });
  const up = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    // Only drop the flipper if no other finger still holds that side.
    if (![...ptrs.values()].some((q) => q.side === p.side)) sink(p.side ? In.RUp : In.LUp, e.timeStamp);
    if (p.plunger) sink(In.PUp, e.timeStamp);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('lostpointercapture', up);

  // Gamepads: polled once per frame.
  const prev: boolean[] = [];
  const MAP: [number[], In, In][] = [
    [[4, 6, 14], In.LDown, In.LUp], [[5, 7, 15], In.RDown, In.RUp], [[0, 13], In.PDown, In.PUp],
    [[2], In.NudgeL, In.NudgeL], [[3, 12], In.NudgeU, In.NudgeU], [[1], In.NudgeR, In.NudgeR],
  ];
  return function pollPads() {
    const pads = navigator.getGamepads?.() ?? [];
    const now = performance.now();
    let i = 0;
    for (const pad of pads) {
      if (!pad) continue;
      for (const [btns, dn, upc] of MAP) {
        const on = btns.some((b) => pad.buttons[b]?.pressed);
        if (on !== !!prev[i]) {
          if (on) sink('any', now);
          if (dn === upc) { if (on) sink(dn, now); }
          else sink(on ? dn : upc, now);
        }
        prev[i++] = on;
      }
      const start = pad.buttons[9]?.pressed;
      if (start && !prev[i]) sink('pause', now);
      prev[i++] = !!start;
    }
  };
}
