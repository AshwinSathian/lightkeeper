// The whole table in one place. Physics, the painter and the rules all read from here,
// so moving a post is one edit. Units: the playfield is 600 x 1200, y grows downward.
import { cos, sin, rad } from './math.ts';

export const W = 600;
export const H = 1230;
export const BALL_R = 15;

export type Mat = 'wall' | 'rubber' | 'sling' | 'bumper' | 'target' | 'plastic';

export interface SegDef {
  a: [number, number];
  b: [number, number];
  w: number; // half thickness
  layer: 0 | 1;
  mat: Mat;
  sw?: string; // switch fired on impact
  oneway?: boolean; // collides only with a ball above it
  drop?: boolean; // drop target: disappears when hit
}
export interface CircDef { x: number; y: number; r: number; layer: 0 | 1; mat: Mat; sw?: string }
export interface SensorDef { id: string; a: [number, number]; b: [number, number]; layer?: 0 | 1 }
export type LampShape = 'dot' | 'arrow' | 'bar' | 'tri' | 'lantern';
export interface LampDef { id: string; x: number; y: number; shape: LampShape; s: number; rot?: number; color: string }
export interface FlipperDef { x: number; y: number; side: 1 | -1 }

type P = [number, number];

const segs: SegDef[] = [];
const circs: CircDef[] = [];

function poly(pts: P[], w: number, mat: Mat = 'wall', layer: 0 | 1 = 0) {
  for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], w, layer, mat });
}
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    pts.push([cx + r * cos(a), cy + r * sin(a)]);
  }
  return pts;
}
const mirror = (p: P): P => [560 - p[0], p[1]];

// Cabinet: left wall, top arch, shooter lane outer wall.
export const OUTER: P[] = [[20, H], [20, 300], ...arc(300, 300, 280, 180, 360, 56), [580, 300], [580, H]];
poly(OUTER, 4);
// Shooter lane inner wall, floor and the one-way gate at its top.
export const LANE_WALL: P[] = [[540, H], [540, 338]];
poly(LANE_WALL, 3);
segs.push({ a: [543, 1170], b: [577, 1170], w: 2, layer: 0, mat: 'wall' });
export const GATE: [P, P] = [[578, 302], [541, 336]];
segs.push({ a: GATE[0], b: GATE[1], w: 2, layer: 0, mat: 'wall', oneway: true });

// Top lane guides.
export const LANE_X = [190, 250, 310, 370];
for (const x of LANE_X) poly([[x, 108], [x, 165]], 4, 'rubber');

// Left orbit inner wall.
export const ORBIT_WALL: P[] = [[82, 652], [82, 300], ...arc(300, 300, 218, 180, 222, 10)];
poly(ORBIT_WALL, 4);

// Right return lane: the orbit and weak plunges come down here to the right inlane.
export const RETURN_L: P[] = [[488, 362], [488, 790], [468, 826]];
export const RETURN_R: P[] = [[540, 790], [498, 862], [498, 960], [388, 1040]];
poly(RETURN_L, 4);
poly(RETURN_R, 4);
// Ramp mouth on the playfield.
export const RAMP_MOUTH: P[] = [[422, 704], [440, 640], [440, 610]];
poly(RAMP_MOUTH, 3);

// Rubber that turns balls dropping out of the orbit away from the outlane.
export const ORBIT_DEFLECT: P[] = [[22, 752], [50, 826]];
poly(ORBIT_DEFLECT, 4, 'rubber');

// Left outlane separator and inlane guide.
export const INLANE_L: P[] = [[62, 870], [62, 960], [172, 1040]];
poly(INLANE_L, 4);

// Slingshots: the inner face kicks.
export const SLING_L: P[] = [[115, 860], [115, 950], [168, 983]];
export const SLING_R: P[] = SLING_L.map(mirror);
for (const t of [SLING_L, SLING_R]) {
  segs.push({ a: t[0], b: t[2], w: 4, layer: 0, mat: 'sling', sw: 'sling' });
  poly([t[0], t[1], t[2]], 4, 'rubber');
}

// Drop targets.
export const TARGETS: [number, number][] = [[225, 562], [280, 562], [335, 562]];
TARGETS.forEach(([x, y], i) => segs.push({ a: [x - 21, y], b: [x + 21, y], w: 5, layer: 0, mat: 'target', sw: 'dt' + i, drop: true }));

// Pop bumpers.
export const POPS: P[] = [[225, 240], [335, 240], [280, 322]];
export const POP_R = 26;
for (const [x, y] of POPS) circs.push({ x, y, r: POP_R, layer: 0, mat: 'bumper', sw: 'pop' });

// Ramp (layer 1). Up the left leg, round the hairpin, down the right leg into the right inlane.
export const RAMP_L: P[] = [[440, 610], [440, 400], ...arc(489, 400, 49, 180, 360, 16), [538, 400], [538, 800], [500, 868]];
export const RAMP_MID: P[] = [[489, 400], [489, 800], [452, 850]];
poly(RAMP_L, 3, 'plastic', 1);
poly(RAMP_MID, 3, 'plastic', 1);
export const RAMP_PATH: P[] = [[464, 640], [464, 400], ...arc(489, 400, 25, 180, 360, 10), [514, 400], [514, 800], [476, 860]];

export const SAUCER = { x: 140, y: 470, r: 18 };
export const PLUNGER = { x: 560, y: 1153 };
export const FLIPPER = { len: 80, r0: 12, r1: 6.5, rest: rad(28), up: rad(-22) };
export const FLIPPERS: FlipperDef[] = [{ x: 180, y: 1050, side: 1 }, { x: 380, y: 1050, side: -1 }];
export const SPINNER: [P, P] = [[24, 560], [78, 560]];
export const DRAIN_Y = 1215;

export const SENSORS: SensorDef[] = [
  { id: 'lane0', a: [194, 150], b: [246, 150] },
  { id: 'lane1', a: [254, 150], b: [306, 150] },
  { id: 'lane2', a: [314, 150], b: [366, 150] },
  { id: 'shooter', a: [543, 360], b: [577, 360] },
  { id: 'orbit', a: [24, 330], b: [78, 330] },
  { id: 'spinner', a: SPINNER[0], b: SPINNER[1] },
  { id: 'rampIn', a: [444, 612], b: [484, 612] },
  { id: 'rampOut', a: [455, 848], b: [498, 866], layer: 1 },
  { id: 'inL', a: [66, 915], b: [111, 915] },
  { id: 'outL', a: [24, 915], b: [58, 915] },
  { id: 'inR', a: [449, 915], b: [494, 915] },
  { id: 'kick', a: [24, 1002], b: [100, 1002] },
];

const AMBER = '#ffb341', RED = '#ff5240', BLUE = '#4fb6ff', GREEN = '#5cf0a0', WHITE = '#fff1d0', VIOLET = '#b98cff';
export const LAMPS: LampDef[] = [
  { id: 'lane0', x: 220, y: 126, shape: 'dot', s: 10, color: AMBER },
  { id: 'lane1', x: 280, y: 126, shape: 'dot', s: 10, color: AMBER },
  { id: 'lane2', x: 340, y: 126, shape: 'dot', s: 10, color: AMBER },
  { id: 'dt0', x: 225, y: 590, shape: 'bar', s: 15, color: RED },
  { id: 'dt1', x: 280, y: 590, shape: 'bar', s: 15, color: RED },
  { id: 'dt2', x: 335, y: 590, shape: 'bar', s: 15, color: RED },
  { id: 'saucer', x: 178, y: 528, shape: 'arrow', s: 17, rot: -135, color: GREEN },
  { id: 'lock1', x: 150, y: 566, shape: 'dot', s: 5, color: GREEN },
  { id: 'lock2', x: 168, y: 574, shape: 'dot', s: 5, color: GREEN },
  { id: 'lock3', x: 186, y: 582, shape: 'dot', s: 5, color: GREEN },
  { id: 'eb', x: 140, y: 424, shape: 'dot', s: 9, color: RED },
  { id: 'ramp', x: 464, y: 728, shape: 'arrow', s: 17, rot: -90, color: BLUE },
  { id: 'ramp1', x: 456, y: 764, shape: 'dot', s: 4.5, color: BLUE },
  { id: 'ramp2', x: 464, y: 776, shape: 'dot', s: 4.5, color: BLUE },
  { id: 'ramp3', x: 472, y: 764, shape: 'dot', s: 4.5, color: BLUE },
  { id: 'orbit', x: 51, y: 700, shape: 'arrow', s: 15, rot: -90, color: BLUE },
  { id: 'kick', x: 41, y: 880, shape: 'dot', s: 8, color: AMBER },
  { id: 'inL', x: 88, y: 888, shape: 'dot', s: 6, color: WHITE },
  { id: 'inR', x: 472, y: 888, shape: 'dot', s: 6, color: WHITE },
  { id: 'fog', x: 196, y: 724, shape: 'tri', s: 13, color: WHITE },
  { id: 'squall', x: 280, y: 648, shape: 'tri', s: 13, color: WHITE },
  { id: 'rescue', x: 364, y: 724, shape: 'tri', s: 13, color: WHITE },
  { id: 'night', x: 280, y: 734, shape: 'lantern', s: 15, color: VIOLET },
  { id: 'x2', x: 226, y: 905, shape: 'bar', s: 12, color: AMBER },
  { id: 'x3', x: 262, y: 905, shape: 'bar', s: 12, color: AMBER },
  { id: 'x4', x: 298, y: 905, shape: 'bar', s: 12, color: AMBER },
  { id: 'x5', x: 334, y: 905, shape: 'bar', s: 12, color: AMBER },
  { id: 'again', x: 280, y: 1000, shape: 'dot', s: 11, color: RED },
];
export const LAMP_INDEX: Record<string, number> = Object.fromEntries(LAMPS.map((l, i) => [l.id, i]));

export const SEGS = segs;
export const CIRCS = circs;
