# RFC: Lightkeeper, a browser pinball table
> Status: ACCEPTED (owner asked for zero intervention; every decision below is made, not proposed)
> Scale: Epic
> Created: 2026-11-20

## Goals

Ship an original pinball table that plays in any modern browser and loads fast on a mid-range phone over 4G.

Done means all of these are true:

- `https://lightkeeper.ashwinsathian.com` serves the game from Cloudflare (personal account `5e8cabf1…`).
- First load makes at most 2 requests before the first frame (HTML with everything inlined, plus a 20 KB font). The HTML is under 60 KB gzipped.
- One game runs at 60 fps in Chrome's 4x CPU throttle at 390x844, measured in Playwright with `performance.now()` frame deltas (p95 under 20 ms).
- It plays on phone portrait, tablet portrait and landscape, and desktop, with layouts made for each (screenshots in `docs/shots/`).
- `npm test` passes: determinism, no tunnelling, rule progression, replay codec.
- Source is pushed to a private GitHub repo `AshwinSathian/lightkeeper`.

## Background

New project. `Personal/coil` exists but the owner said not to copy it unless needed. Only the hosting shape (static assets on Cloudflare Workers, custom domain on the `ashwinsathian.com` zone) is reused, because that zone and account are where the owner's games live.

## Non-goals

- No global leaderboard or backend. High scores stay on the device with three-letter initials, like a real machine.
- No 3D models. The table is drawn top-down in 2D, with an optional tilted "cabinet" camera.
- No multiplayer turns (one player per game).
- No iOS haptics. The `<input switch>` label trick is reported patched in iOS 26.5; Android gets `navigator.vibrate`.
- No music tracks. Sound is synthesised mechanics, chimes and a sea bed.

## Architecture

```
input.ts ──(timestamped events)──► game loop (main.ts)
                                      │ fixed 480 Hz ticks, catch-up per frame
                                      ▼
table.ts (geometry + lamps + switches, one source) ──► sim.ts (physics + rules, deterministic)
        │                                                  │ events: hits, lamps, DMD scenes, sounds
        ▼                                                  ▼
bake.ts (Canvas2D paints playfield + sprite atlas) ──► gl.ts (WebGL2: scene, lamps, chrome ball, bloom, cabinet tilt)
                                                       dmd.ts (128x32 dot matrix)   audio.ts (Web Audio synth)
```

### Key decisions

1. **One table description drives everything.** `src/table.ts` lists walls, posts, bumpers, targets, triggers and lamps with positions. Physics reads colliders, the baker paints from the same coordinates, the rules address switches and lamps by id. Moving a bumper is one edit.
2. **Deterministic fixed-step sim at 480 Hz.** Only `+ - * /` and `Math.sqrt` in the sim; sine and cosine come from a local polynomial, because `Math.sin` differs across engines. Seeded PRNG. Same inputs give the same game on any device, which makes replay links work. Ball max speed is 4000 units/s, so a step moves at most 8.3 units against a 15-unit radius: no tunnelling without swept tests.
3. **Sub-frame input.** Input events keep `event.timeStamp`. Each frame the loop runs ticks up to now and applies each input at the tick it actually happened, so flipper timing isn't rounded to the 16 ms frame.
4. **Kinematic flippers.** A flipper is a capsule driven by angular acceleration with a speed cap. Contact uses the surface velocity `ω × r`, treating the flipper as infinite mass. Rubber uses elasticity falloff (`e = e0 / (1 + k·v)`), the model Visual Pinball uses, so hard hits bounce less than soft ones.
5. **Two collision layers.** The ball has a layer. The right ramp is layer 1: entering it from below switches the ball up; falling back out or reaching the end switches it down. That gives a real ramp in a 2D sim.
6. **WebGL2 renderer, art painted at boot.** No image files. The playfield and a sprite atlas are painted with Canvas2D at the display resolution and uploaded as textures. Per frame: base texture, additive lamp sprites with an incandescent fade model, dynamic sprites, then the ball shaded as a chrome sphere that samples the lit scene behind it, so it reflects the lamps live. Quarter-res bloom, dropped automatically if frames run slow.
7. **Cabinet camera.** The flat scene is drawn into a framebuffer, then onto a quad in perspective. It's a setting, default on for wide screens.
8. **DMD.** 128x32 amber dot matrix rendered on its own canvas: hand-drawn 4x6 bitmap font for small text, the display face rasterised and thresholded for big numbers. It shows score, modes, countdowns and attract scenes.
9. **Single file build.** Vite + TypeScript, `vite-plugin-singlefile`. No runtime dependencies.

## Table: Lightkeeper

Coastal lighthouse theme, painted in deep navy, cream and sodium amber. Playfield 600 x 1200 units, ball radius 15.

| Feature | Where | Rule |
|---|---|---|
| Shooter lane + skill shot | right edge | One of three top lanes is lit; plunge into it for a skill shot |
| Top lanes L-E-E (light, eye, east) | top centre | Light all three for +1 bonus multiplier (max 5x); flippers rotate lit lanes |
| 3 pop bumpers | under lanes | 300 each; every 25 hits raises their value |
| Left orbit + spinner | left edge | Spinner scores per spin; orbit shot 20k |
| Right ramp (layer 1) | right edge | 25k; feeds the right inlane; 3 ramps relight the kickback |
| 3 drop targets | centre | Bank down lights Lock |
| Saucer "the lamp room" | upper left | Lock lit: lock a ball. Third lock starts 3-ball multiball. Otherwise starts the next timed watch |
| Slings, in/outlanes | bottom | Left outlane kickback, lit at start |
| Ball save | | 8 s after each plunge, 15 s at multiball start |
| Tilt | | Nudges fill a meter; two warnings, third tilts the ball |

Watches (timed 30 s modes started at the saucer): Fog (spinner x5), Squall (pops x10), Rescue (lit shot moves between ramp, orbit and saucer). Finish all three to start Long Night: every shot scores 50k for 45 s, ball save on.

Game modes from the menu: Three balls, Three minutes (unlimited balls, clock), Practice (ball save always on, no high score).

## Work breakdown

### Phase 1: sim (~1d)
- [ ] `table.ts`, `sim.ts`, `trig.ts`, `rng.ts` — AC: a headless plunge reaches the top arc and drains within 60 s of game time without leaving the table bounds.
- [ ] Rules in `rules.ts` — AC: test drops three targets and finds Lock lit; three locks start multiball with 3 balls.
- [ ] `replay.ts` codec — AC: round-trip test on a 600-event log; replayed final score equals live score.

### Phase 2: renderer and input (~1.5d)
- [ ] `bake.ts`, `gl.ts`, `dmd.ts` — AC: Playwright screenshot at 390x844 shows the full table, lamps and ball, no console errors.
- [ ] `input.ts` (touch halves, keyboard, gamepad, nudge flick) — AC: keyboard Z and / move flippers in a recorded Playwright run.

### Phase 3: game flow and polish (~1d)
- [ ] Attract mode with a bot, menu, pause, game over, initials entry, high scores, settings — AC: full loop start → 3 drains → initials → table shows the new score, driven by Playwright.
- [ ] `audio.ts` — AC: no AudioContext before first gesture; sounds fire on hits.
- [ ] Layouts for phone, tablet, desktop — AC: screenshots at 390x844, 844x390, 820x1180, 1180x820, 1440x900 with no overflow.
- [ ] Copy through humanizing-writing, UI through loupe — AC: loupe findings rated high are fixed.

### Phase 4: ship (~0.5d)
- [ ] PWA (manifest, icons, service worker), `_headers`, README — AC: second load works offline in Playwright.
- [ ] Deploy and push — AC: production URL returns 200 and the page boots in Playwright.

## Testing strategy

- **Unit** (`node --test`): determinism (two runs, same inputs, identical state hash); 2000 random plunges and flips never leave the table or exceed max speed; flipper lifts a resting ball; rules progression; replay codec.
- **Integration** (Playwright): boot, play with keys, drain, game over, initials, reload keeps the score.
- **Performance**: frame-time sampling with 4x CPU throttle.

## Risks

| Risk | L | I | Score | Mitigation |
|---|---|---|---|---|
| Physics feels floaty or flippers can't reach ramp/orbit | H | H | Critical | Constants in one block; bot test sweeps flip timing and asserts each major shot is reachable |
| WebGL bloom too slow on low-end phones | M | M | Medium | Frame-time monitor drops bloom then lowers resolution scale |
| Ball tunnels through thin walls at high speed | L | H | Medium | Speed cap + step size below radius; fuzz test |
| Touch flippers miss on fast double taps | M | M | Medium | Pointer events with `touch-action: none`, each pointer tracked by id |

## Dependencies

- External: Cloudflare Workers static assets (wrangler), GitHub (`gh`), Vite, TypeScript, vite-plugin-singlefile, Playwright for checks.
- Font: Big Shoulders Display (OFL), subset to 20 KB.

## Open questions

None. Repo visibility stays private until the owner chooses to publish it.
