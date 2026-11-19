# Lightkeeper

A pinball table for the browser, live at **https://lightkeeper.ashwinsathian.com**. A lighthouse on a night sea, with a ramp, an orbit, three pop bumpers, a bank of drop targets and three-ball multiball. It plays on phones, tablets and desktops, installs as an app, and works offline after the first visit.

## Playing

- **Touch:** the left and right halves of the screen are the flippers. With the ball on the plunger, hold the right half and let go to launch. Flick up to nudge.
- **Keys:** Z and / (or either Shift) flip, hold Space to pull the plunger, Up arrow, X and full stop nudge, Esc pauses.
- **Gamepad:** bumpers or triggers flip, A launches.

Modes: 3 balls, 3 minutes (unlimited balls against the clock) and Practice (every drain saved). The rules are under "How to play" in the game and on the apron cards.

## How it's built

TypeScript and Vite with no runtime dependencies. The build inlines everything into one 35 KB (gzipped) HTML file; the only other request is a 20 KB subset of Big Shoulders Display.

**One table description.** `src/table.ts` lists every wall, post, bumper, sensor and lamp. Physics, the painter and the rules all read it.

**Deterministic physics at 480 Hz.** `src/physics.ts` steps a fixed 1/480 s and uses only `+ - * /` and `Math.sqrt`, which IEEE 754 makes identical on every engine. Sine and cosine come from a Taylor series in `src/math.ts` because `Math.sin` is allowed to differ between browsers. Randomness is a seeded mulberry32. So a game is fully described by its seed and its inputs, which is what replays and replay links are: varint-packed input ticks in a URL fragment (`src/replay.ts`). A ball moves at most 8.75 units per step against a 15-unit radius, so it can't tunnel through a wall without swept tests.

**Flippers.** Each flipper is a tapered capsule driven by angular acceleration with a speed cap. Contacts use the flipper's surface velocity at the contact point, and rubber loses bounce at higher impact speeds (`e = e0 / (1 + k·v)`), the falloff model Visual Pinball uses. Hit the ball near the tip and it crosses the table; near the base, it goes up the middle.

**The ramp is a second collision layer.** Crossing the ramp mouth going up moves the ball to layer 1, where only the ramp's walls exist; it drops back to layer 0 at the exit or if it rolls back down.

**Inputs land on the tick they happened.** Events keep their `timeStamp`, and each frame applies them at the matching tick inside the frame's span, so flipper timing isn't rounded to the 16 ms frame.

**Rendering.** No image files. `src/bake.ts` paints the playfield, the layer above the ball and a sprite atlas with Canvas 2D at the screen's resolution, and `src/gl.ts` composites them in WebGL 2. Lamps fade like incandescent bulbs (faster on than off). The ball is shaded as a chrome sphere that samples the lit playfield around it, so it reflects the lamps as they change. Bloom runs at quarter resolution and switches itself off if frames run long. Wide screens get a tilted cabinet view by drawing the finished frame onto a trapezoid with perspective-correct texturing.

**Dot-matrix display.** 128x32, drawn by a fragment shader. Small text uses a hand-set 5x7 font (`src/dmd.ts`); big numbers are the display face rasterised and thresholded.

**Sound** is synthesised with Web Audio (`src/audio.ts`): solenoids are filtered noise plus a low thump, scores ring three electromechanical-style chime bells, and the ball's roll is filtered noise that follows its speed.

## Development

```sh
npm install
npm test          # determinism, no-escape fuzz, rules, replay codec
npm run dev       # http://localhost:5173
npm run deploy    # build + wrangler deploy (static assets on Cloudflare Workers)
```

`scripts/` holds the tools used while tuning and checking: `reach.ts` and `angle.ts` map which shots each flipper can make, `shoot.ts` takes screenshots at five screen sizes, `flow.ts` plays a full game in a browser, and `perf.ts` measures frame times with the CPU throttled 4x.

## Credits

Type: [Big Shoulders Display](https://github.com/xotypeco/big_shoulders), SIL Open Font License (`public/fonts/OFL.txt`).
