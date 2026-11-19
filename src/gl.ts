// WebGL2 renderer. Per frame:
//   A: playfield + lamps + moving parts           (table resolution)
//   B: A + chrome balls that reflect A + the layer above the ball + beam
//   bloom: bright parts of B, quarter resolution, blurred
//   screen: B + bloom on a flat or tilted quad, then the dot-matrix display.
import type { Baked, Sprite } from './bake.ts';
import { W, H, BALL_R, POPS, TARGETS, LAMPS, PLUNGER, SPINNER } from './table.ts';

export interface Flash { x: number; y: number; size: number; r: number; g: number; b: number; a: number }
export interface Scene {
  balls: { x: number; y: number; layer: number }[];
  flippers: { x: number; y: number; side: number; a: number }[];
  lamps: Float32Array; // 0..1 per lamp
  targets: number[]; // 0 = up, 1 = fully down
  spinner: number; // revolutions
  plunger: number; // 0..1 pull
  pops: number[]; // flash 0..1
  flashes: Flash[];
  beam: { a: number; alpha: number };
  gi: number; // general illumination 0..1
  shake: [number, number];
}
export interface View {
  // Where the table goes on screen, in device pixels. ty can be negative when the camera follows the ball.
  tx: number; ty: number; tw: number; th: number;
  tilt: number; // 0 flat, up to ~0.2
  clip: [number, number, number, number]; // scissor rect x, y, w, h (top-left origin)
  dmd: [number, number, number, number] | null;
}

const VS_SPRITE = `#version 300 es
layout(location=0) in vec2 p; layout(location=1) in vec2 uv; layout(location=2) in vec4 col;
out vec2 vUv; out vec4 vCol;
void main(){ vUv = uv; vCol = col; gl_Position = vec4(p.x / ${W.toFixed(1)} * 2.0 - 1.0, 1.0 - p.y / ${H.toFixed(1)} * 2.0, 0, 1); }`;
const FS_SPRITE = `#version 300 es
precision mediump float; uniform sampler2D t; in vec2 vUv; in vec4 vCol; out vec4 o;
void main(){ o = texture(t, vUv) * vCol; }`;

const VS_BALL = `#version 300 es
layout(location=0) in vec2 p; layout(location=1) in vec2 uv; layout(location=2) in vec4 col;
out vec2 vL; out vec2 vW;
void main(){ vL = uv; vW = p; gl_Position = vec4(p.x / ${W.toFixed(1)} * 2.0 - 1.0, 1.0 - p.y / ${H.toFixed(1)} * 2.0, 0, 1); }`;
// Chrome ball: the rim mirrors the lit playfield around it, the crown mirrors a dim cabinet with one soft light.
const FS_BALL = `#version 300 es
precision highp float; uniform sampler2D scene; uniform vec3 ball; uniform float lift;
in vec2 vL; in vec2 vW; out vec4 o;
void main(){
  float r = length(vL);
  float edge = fwidth(r);
  float a = 1.0 - smoothstep(1.0 - edge, 1.0, r);
  if (a <= 0.0) discard;
  float rr = min(r, 0.999);
  vec3 n = vec3(vL.x, -vL.y, sqrt(1.0 - rr * rr));
  vec3 rf = reflect(vec3(0.0, 0.0, -1.0), n);
  vec2 w = ball.xy + vec2(rf.x, -rf.y) * ball.z * (1.4 + 2.2 * (1.0 - rf.z));
  vec3 env = texture(scene, vec2(w.x / ${W.toFixed(1)}, 1.0 - w.y / ${H.toFixed(1)})).rgb;
  vec3 key = normalize(vec3(-0.35, 0.55, 0.76));
  float sky = smoothstep(0.86, 0.985, dot(rf, key));
  // Above the ball: the underside of the glass and the cabinet lights, fairly bright.
  vec3 ceiling = mix(vec3(0.42, 0.44, 0.5), vec3(0.86, 0.85, 0.82), smoothstep(0.35, 1.0, rf.z));
  vec3 c = mix(env * 1.5 + 0.16, ceiling, smoothstep(0.3, 0.75, rf.z));
  c *= 1.0 - 0.45 * exp(-pow((rf.z - 0.32) * 7.0, 2.0)); // dark horizon band, the chrome look
  c += vec3(1.0, 0.97, 0.9) * sky * 1.6;
  c += vec3(1.0) * pow(max(dot(n, normalize(vec3(0.5, 0.2, 0.84))), 0.0), 50.0) * 0.6;
  c *= mix(0.55, 1.0, smoothstep(0.0, 0.5, n.z)) * lift;
  o = vec4(c * a, a);
}`;

const VS_QUAD = `#version 300 es
layout(location=0) in vec4 p; layout(location=1) in vec2 uv; out vec2 vUv;
void main(){ vUv = uv; gl_Position = p; }`;
const FS_COPY = `#version 300 es
precision mediump float; uniform sampler2D t; in vec2 vUv; out vec4 o; void main(){ o = texture(t, vUv); }`;
const FS_BRIGHT = `#version 300 es
precision mediump float; uniform sampler2D t; uniform vec2 px; in vec2 vUv; out vec4 o;
void main(){
  vec3 c = (texture(t, vUv + px * vec2(-1,-1)).rgb + texture(t, vUv + px * vec2(1,-1)).rgb + texture(t, vUv + px * vec2(-1,1)).rgb + texture(t, vUv + px * vec2(1,1)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.55, 1.0, l), 1.0);
}`;
const FS_BLUR = `#version 300 es
precision mediump float; uniform sampler2D t; uniform vec2 dir; in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(t, vUv).rgb * 0.227;
  c += (texture(t, vUv + dir * 1.385).rgb + texture(t, vUv - dir * 1.385).rgb) * 0.316;
  c += (texture(t, vUv + dir * 3.231).rgb + texture(t, vUv - dir * 3.231).rgb) * 0.07;
  o = vec4(c, 1.0);
}`;
const FS_FINAL = `#version 300 es
precision mediump float; uniform sampler2D t; uniform sampler2D bloom; uniform float bloomOn; in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(t, vUv).rgb + texture(bloom, vUv).rgb * 0.85 * bloomOn;
  o = vec4(c, 1.0);
}`;
// Dot-matrix display: one round amber dot per pixel of a 128x32 buffer, with a little bleed.
const FS_DMD = `#version 300 es
precision mediump float; uniform sampler2D t; in vec2 vUv; out vec4 o;
void main(){
  vec2 cell = vUv * vec2(128.0, 32.0);
  ivec2 ci = ivec2(cell);
  float v = texelFetch(t, ci, 0).r;
  float halo = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) halo += texelFetch(t, clamp(ci + ivec2(x, y), ivec2(0), ivec2(127, 31)), 0).r;
  vec2 f = fract(cell) - 0.5;
  float dotm = smoothstep(0.48, 0.3, length(f));
  vec3 amber = vec3(1.0, 0.56, 0.16);
  vec3 c = amber * (v * dotm * 1.1 + 0.07 * dotm + halo * 0.025);
  c += vec3(1.0, 0.9, 0.7) * pow(v, 3.0) * dotm * 0.25;
  o = vec4(c + vec3(0.012, 0.008, 0.006), 1.0);
}`;

type GL = WebGL2RenderingContext;

function program(gl: GL, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const u: Record<string, WebGLUniformLocation | null> = {};
  return { p, u: (name: string) => (name in u ? u[name] : (u[name] = gl.getUniformLocation(p, name))) };
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const MAXQ = 400;

export class Renderer {
  gl: GL;
  private sprite; private ballP; private copy; private bright; private blur; private final; private dmdP;
  private vbo: WebGLBuffer; private qbo: WebGLBuffer; private vao: WebGLVertexArrayObject; private qvao: WebGLVertexArrayObject;
  private verts = new Float32Array(MAXQ * 4 * 8);
  private n = 0;
  private tex: WebGLTexture | null = null;
  private baked: Baked | null = null;
  private texBase!: WebGLTexture; private texOver!: WebGLTexture; private texAtlas!: WebGLTexture; private texDmd: WebGLTexture;
  private A!: Target; private B!: Target; private C!: Target; private D!: Target;
  bloom = true;

  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.sprite = program(gl, VS_SPRITE, FS_SPRITE);
    this.ballP = program(gl, VS_BALL, FS_BALL);
    this.copy = program(gl, VS_QUAD, FS_COPY);
    this.bright = program(gl, VS_QUAD, FS_BRIGHT);
    this.blur = program(gl, VS_QUAD, FS_BLUR);
    this.final = program(gl, VS_QUAD, FS_FINAL);
    this.dmdP = program(gl, VS_QUAD, FS_DMD);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    const idx = new Uint16Array(MAXQ * 6);
    for (let i = 0; i < MAXQ; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // Full-screen and placed quads: vec4 position (for perspective) + uv.
    this.qvao = gl.createVertexArray()!;
    gl.bindVertexArray(this.qvao);
    this.qbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qbo);
    gl.bufferData(gl.ARRAY_BUFFER, 36 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.bindVertexArray(null);

    this.texDmd = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texDmd);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 32, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    this.filter(gl.NEAREST);
  }

  private filter(f: number) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private upload(c: HTMLCanvasElement, old?: WebGLTexture) {
    const gl = this.gl;
    if (old) gl.deleteTexture(old);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.filter(gl.LINEAR);
    return t;
  }

  private target(w: number, h: number, old?: Target): Target {
    const gl = this.gl;
    if (old) { gl.deleteFramebuffer(old.fb); gl.deleteTexture(old.tex); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.filter(gl.LINEAR);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  setBaked(b: Baked) {
    this.baked = b;
    this.texBase = this.upload(b.base, this.texBase);
    this.texOver = this.upload(b.over, this.texOver);
    this.texAtlas = this.upload(b.atlas, this.texAtlas);
    const w = b.base.width, h = b.base.height;
    this.A = this.target(w, h, this.A);
    this.B = this.target(w, h, this.B);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.C = this.target(bw, bh, this.C);
    this.D = this.target(bw, bh, this.D);
  }

  // ---- sprite batching ----
  private use(tex: WebGLTexture) {
    if (this.tex !== tex) { this.flush(); this.tex = tex; }
  }
  private flush() {
    if (!this.n || !this.tex) { this.n = 0; return; }
    const gl = this.gl;
    gl.useProgram(this.sprite.p);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts, 0, this.n * 32);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.sprite.u('t'), 0);
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_SHORT, 0);
    this.n = 0;
  }
  private quad(x: number[], y: number[], u: number[], v: number[], c: [number, number, number, number]) {
    if (this.n >= MAXQ) this.flush();
    const o = this.n * 32;
    for (let i = 0; i < 4; i++) this.verts.set([x[i], y[i], u[i], v[i], c[0], c[1], c[2], c[3]], o + i * 8);
    this.n++;
  }
  private rect(x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number] = [1, 1, 1, 1]) {
    this.quad([x0, x1, x1, x0], [y0, y0, y1, y1], [0, 1, 1, 0], [0, 0, 1, 1], c);
  }
  private spr(s: Sprite, x: number, y: number, rot = 0, sx = 1, sy = 1, c: [number, number, number, number] = [1, 1, 1, 1]) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const lx = [-s.ax, s.w - s.ax, s.w - s.ax, -s.ax], ly = [-s.ay, -s.ay, s.h - s.ay, s.h - s.ay];
    const X: number[] = [], Y: number[] = [];
    for (let i = 0; i < 4; i++) { const px = lx[i] * sx, py = ly[i] * sy; X.push(x + px * cs - py * sn); Y.push(y + px * sn + py * cs); }
    this.quad(X, Y, [s.u0, s.u1, s.u1, s.u0], [s.v0, s.v0, s.v1, s.v1], c);
  }
  private blend(add: boolean) {
    this.flush();
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  }
  private bindTarget(t: Target | null, w?: number, h?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : w!, t ? t.h : h!);
  }

  private fsQuad(prog: { p: WebGLProgram }, pos?: number[][], uv?: number[][]) {
    const gl = this.gl;
    const P = pos ?? [[-1, -1, 0, 1], [1, -1, 0, 1], [1, 1, 0, 1], [-1, 1, 0, 1]];
    const U = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const d = new Float32Array(36);
    [0, 1, 2, 0, 2, 3].forEach((i, k) => { d.set(P[i], k * 6); d.set(U[i], k * 6 + 4); });
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.qvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private bindTex(unit: number, t: WebGLTexture, prog: { u: (n: string) => WebGLUniformLocation | null }, name: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.u(name), unit);
  }

  private drawBall(b: { x: number; y: number; layer: number }) {
    this.flush();
    const gl = this.gl;
    const r = BALL_R * (b.layer ? 1.08 : 1);
    gl.useProgram(this.ballP.p);
    this.bindTex(1, this.A.tex, this.ballP, 'scene');
    gl.uniform3f(this.ballP.u('ball'), b.x, b.y, r);
    gl.uniform1f(this.ballP.u('lift'), b.layer ? 1.08 : 1);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const x0 = b.x - r, x1 = b.x + r, y0 = b.y - r, y1 = b.y + r;
    this.verts.set([x0, y0, -1, -1, 1, 1, 1, 1, x1, y0, 1, -1, 1, 1, 1, 1, x1, y1, 1, 1, 1, 1, 1, 1, x0, y1, -1, 1, 1, 1, 1, 1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts, 0, 32);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  render(s: Scene, v: View, dmd: Uint8Array | null) {
    const gl = this.gl, b = this.baked;
    if (!b) return;
    const S = b.sprites;
    const [shx, shy] = s.shake;

    // ---- A: playfield ----
    this.bindTarget(this.A);
    gl.disable(gl.BLEND);
    this.use(this.texBase);
    this.rect(0, 0, W, H, [s.gi, s.gi, s.gi, 1]);
    this.flush();
    this.blend(true);
    this.use(this.texAtlas);
    for (let i = 0; i < LAMPS.length; i++) {
      const k = s.lamps[i];
      if (k > 0.01) this.spr(S['lamp:' + LAMPS[i].id], LAMPS[i].x, LAMPS[i].y, 0, 1, 1, [k, k, k, 0]);
    }
    for (const f of s.flashes) this.spr(S.glow, f.x, f.y, 0, f.size / 32, f.size / 32, [f.r * f.a, f.g * f.a, f.b * f.a, 0]);
    this.blend(false);
    // Ball shadows (key light up and slightly left, so shadows fall down-right).
    for (const ball of s.balls) if (!ball.layer) this.spr(S.shadow, ball.x + 4, ball.y + 6, 0, 0.85, 0.85, [0.8, 0.8, 0.8, 0.8]);
    TARGETS.forEach(([x, y], i) => {
      const d = s.targets[i];
      if (d < 1) this.spr(S.target, x, y, 0, 1, 1 - d * 0.7, [1 - d * 0.5, 1 - d * 0.5, 1 - d * 0.5, 1 - d]);
    });
    POPS.forEach(([x, y]) => this.spr(S.pop, x, y));
    // Spinner seen edge-on as it turns.
    const sc = Math.abs(Math.cos(s.spinner * Math.PI * 2));
    this.spr(S.spinner, (SPINNER[0][0] + SPINNER[1][0]) / 2, SPINNER[0][1], 0, 1, 0.25 + sc * 0.75);
    this.spr(S.plunger, PLUNGER.x, PLUNGER.y + BALL_R + 2 + s.plunger * 34);
    for (const f of s.flippers) this.spr(S.flipper, f.x, f.y, f.side > 0 ? f.a : Math.PI - f.a, 1, f.side > 0 ? 1 : -1);
    this.blend(true);
    POPS.forEach(([x, y], i) => { const k = s.pops[i]; if (k > 0.01) this.spr(S.popGlow, x, y, 0, 1, 1, [k, k * 0.85, k * 0.6, 0]); });
    this.flush();

    // ---- B: balls reflect A; the upper layer sits over them ----
    this.bindTarget(this.B);
    gl.disable(gl.BLEND);
    gl.useProgram(this.copy.p);
    this.bindTex(0, this.A.tex, this.copy, 't');
    this.fsQuad(this.copy);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const ball of s.balls) if (!ball.layer) this.drawBall(ball);
    this.use(this.texOver);
    this.rect(0, 0, W, H, [s.gi, s.gi, s.gi, 1]);
    this.use(this.texAtlas);
    for (const ball of s.balls) if (ball.layer) this.spr(S.shadow, ball.x + 9, ball.y + 13, 0, 0.9, 0.9, [0.7, 0.7, 0.7, 0.7]);
    this.flush();
    for (const ball of s.balls) if (ball.layer) this.drawBall(ball);
    if (s.beam.alpha > 0.01) {
      this.blend(true);
      this.use(this.texAtlas);
      const k = s.beam.alpha * 0.32;
      this.spr(S.beam, 280, 734, s.beam.a, 1, 1, [k, k * 0.92, k * 0.75, 0]);
      this.spr(S.beam, 280, 734, s.beam.a + Math.PI, 1, 1, [k, k * 0.92, k * 0.75, 0]);
      this.flush();
    }

    // ---- bloom ----
    if (this.bloom) {
      gl.disable(gl.BLEND);
      this.bindTarget(this.C);
      gl.useProgram(this.bright.p);
      gl.uniform2f(this.bright.u('px'), 1 / this.B.w, 1 / this.B.h);
      this.bindTex(0, this.B.tex, this.bright, 't');
      this.fsQuad(this.bright);
      for (let pass = 0; pass < 2; pass++) {
        this.bindTarget(this.D);
        gl.useProgram(this.blur.p);
        gl.uniform2f(this.blur.u('dir'), (1 + pass) / this.C.w, 0);
        this.bindTex(0, this.C.tex, this.blur, 't');
        this.fsQuad(this.blur);
        this.bindTarget(this.C);
        gl.uniform2f(this.blur.u('dir'), 0, (1 + pass) / this.C.h);
        this.bindTex(0, this.D.tex, this.blur, 't');
        this.fsQuad(this.blur);
      }
    }

    // ---- screen ----
    const cw = this.canvas.width, ch = this.canvas.height;
    this.bindTarget(null, cw, ch);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(v.clip[0], ch - v.clip[1] - v.clip[3], v.clip[2], v.clip[3]);
    const toX = (x: number) => ((x + shx) / cw) * 2 - 1, toY = (y: number) => 1 - ((y + shy) / ch) * 2;
    // Tilted cabinet: the far (top) edge is narrower and pushed down; w makes the texture foreshorten correctly.
    const t = v.tilt, top = 1 - t, cx = v.tx + v.tw / 2;
    const yTop = v.ty + v.th * t * 0.55;
    const wT = 1 / top;
    const pos = [
      [toX(cx - (v.tw / 2)), toY(v.ty + v.th), 0, 1],
      [toX(cx + (v.tw / 2)), toY(v.ty + v.th), 0, 1],
      [toX(cx + (v.tw / 2) * top) * wT, toY(yTop) * wT, 0, wT],
      [toX(cx - (v.tw / 2) * top) * wT, toY(yTop) * wT, 0, wT],
    ];
    gl.useProgram(this.final.p);
    this.bindTex(0, this.B.tex, this.final, 't');
    this.bindTex(1, this.C.tex, this.final, 'bloom');
    gl.uniform1f(this.final.u('bloomOn'), this.bloom ? 1 : 0);
    this.fsQuad(this.final, pos);
    gl.activeTexture(gl.TEXTURE0);

    if (v.dmd && dmd) {
      const [x, y, w, h] = v.dmd;
      gl.scissor(x, ch - y - h, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.texDmd);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 32, gl.RED, gl.UNSIGNED_BYTE, dmd);
      gl.useProgram(this.dmdP.p);
      gl.uniform1i(this.dmdP.u('t'), 0);
      const X0 = (x / cw) * 2 - 1, X1 = ((x + w) / cw) * 2 - 1, Y0 = 1 - (y / ch) * 2, Y1 = 1 - ((y + h) / ch) * 2;
      this.fsQuad(this.dmdP, [[X0, Y1, 0, 1], [X1, Y1, 0, 1], [X1, Y0, 0, 1], [X0, Y0, 0, 1]], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
}

