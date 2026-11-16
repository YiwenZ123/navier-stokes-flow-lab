import assert from 'node:assert/strict';
import { DEFAULT_CURVE, normalizeCurve, makeSlopes, interpolate, createCurveProfile } from '../dist/custom-profile.js';
import { SCHEMES, createSimulation } from '../dist/advection-solver.js';

const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
const maxDifference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const norm = a => Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) / a.length);

// Input validation rejects malformed saved state rather than repairing a
// crossing, NaN, missing boundary or out-of-domain initial condition.
for (const invalid of [null, {}, { ...DEFAULT_CURVE, points: [[-1, 0], [1, NaN]] },
  { ...DEFAULT_CURVE, points: [[-1, 0], [0, .5], [-.2, .6], [1, 0]] },
  { ...DEFAULT_CURVE, points: [[-1, 0], [-.99, .5], [1, 0]] },
  { ...DEFAULT_CURVE, points: [[-.9, 0], [1, 0]] },
  { ...DEFAULT_CURVE, points: [[-1, 0], [1.1, 0]] },
  { ...DEFAULT_CURVE, points: [[-1, 0], [0, 1.1], [1, 0]] },
  { ...DEFAULT_CURVE, points: [[-1, 0], [1, '0.1']] },
  { ...DEFAULT_CURVE, mode: 'spline' }, { ...DEFAULT_CURVE, periodic: 'true' },
  { ...DEFAULT_CURVE, points: Array.from({ length: 19 }, (_, i) => [-1 + i / 9, .5]) },
]) assert.throws(() => normalizeCurve(invalid), RangeError);

{
  const input = { points: [[-1, .2], [0, .7], [1, .8]], mode: 'smooth', periodic: true };
  const normalized = normalizeCurve(input);
  assert.deepEqual(input.points[2], [1, .8]);
  assert.deepEqual(normalized.points[2], [1, .2]);
  normalized.points[1][1] = .1;
  assert.equal(input.points[1][1], .7);
  const profile = createCurveProfile(input);
  assert.ok(Object.isFrozen(profile.curve) && Object.isFrozen(profile.curve.points) && Object.isFrozen(profile.curve.points[0]));
  assert.throws(() => { profile.curve.points[0][1] = 0; }, TypeError);
  for (const n of [0, 1, 1.5, NaN, 10001]) assert.throws(() => profile.sample(n), RangeError);
  assert.throws(() => profile.value(Infinity), RangeError);
}

// Unevenly spaced random control points: interpolation passes through every
// point, never overshoots a segment, and produces a finite [0,1] profile.
let seed = 19321;
const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
for (const periodic of [false, true]) for (let trial = 0; trial < 80; trial++) {
  const count = 3 + Math.floor(16 * random());
  const weights = Array.from({ length: count - 1 }, () => .5 + random());
  const total = weights.reduce((sum, value) => sum + value, 0);
  let x = -1;
  const points = [[-1, random()]];
  for (let i = 0; i < weights.length; i++) { x += weights[i] * 2 / total; points.push([i === weights.length - 1 ? 1 : x, random()]); }
  if (periodic) points.at(-1)[1] = points[0][1];
  const curve = normalizeCurve({ points, mode: 'smooth', periodic });
  const slopes = makeSlopes(curve.points, periodic);
  if (periodic) assert.equal(slopes[0], slopes.at(-1));
  for (const mode of ['linear', 'smooth']) {
    for (const [xi, yi] of curve.points) near(interpolate(curve.points, slopes, xi, mode), yi);
    for (let i = 0; i < points.length - 1; i++) for (let k = 0; k <= 40; k++) {
      const xi = points[i][0] + (points[i + 1][0] - points[i][0]) * k / 40;
      const y = interpolate(points, slopes, xi, mode);
      assert.ok(y >= Math.min(points[i][1], points[i + 1][1]) - 1e-12);
      assert.ok(y <= Math.max(points[i][1], points[i + 1][1]) + 1e-12);
    }
    const sampled = createCurveProfile({ ...curve, mode }).sample(200);
    assert.equal(sampled.length, 200);
    assert.ok(sampled.every(y => Number.isFinite(y) && y >= -1e-12 && y <= 1 + 1e-12));
  }
}

// Constants are unchanged; a nonzero derivative joins across the periodic
// seam. In unlinked mode the editor's right endpoint is the left-hand limit,
// while the solver excludes it and wraps to the left endpoint at x=1.
{
  const constant = createCurveProfile({ points: [[-1, .37], [1, .37]], mode: 'smooth', periodic: true });
  for (const x of [-7, -1, -.31, 0, .86, 1, 9]) near(constant.value(x), .37);
  const cyclic = createCurveProfile({ points: [[-1, .5], [-.6, .75], [.2, .2], [1, .5]], mode: 'smooth', periodic: true });
  const e = 1e-6, leftSlope = (cyclic.value(-1) - cyclic.value(-1 - e)) / e;
  const rightSlope = (cyclic.value(-1 + e) - cyclic.value(-1)) / e;
  near(leftSlope, rightSlope, 4e-6);
  assert.ok(leftSlope > 0);
  const unlinked = { points: [[-1, .2], [1, .8]], mode: 'linear', periodic: false };
  const jump = createCurveProfile(unlinked);
  near(interpolate(unlinked.points, makeSlopes(unlinked.points, false), 1, 'linear'), .8);
  near(jump.value(1), .2);
  near(jump.value(1 - e), .8 - .3 * e);
  near(jump.value(.17), .551);
  near(jump.sample(200).at(-1), .797);
  assert.notEqual(jump.sample(200).at(-1), jump.sample(200)[0]);
  for (const x of [-.91, -.24, .31, .97]) { near(jump.value(x), jump.value(x + 2)); near(jump.value(x), jump.value(x - 2)); }
}

// Every scheme receives bit-identical node values from the same frozen curve.
// Changing N re-evaluates the continuous function instead of resampling a
// previously sampled grid. No scheme shares a mutable solution buffer.
for (const N of [40, 80, 100, 200, 400]) for (const mode of ['linear', 'smooth']) {
  const curve = { ...clone(DEFAULT_CURVE), mode };
  const expected = createCurveProfile(curve);
  const sims = SCHEMES.map(({ id }) => createSimulation({ scheme: id, profile: 'custom', customCurve: curve, N }));
  for (const sim of sims) {
    assert.deepEqual(sim.u, sims[0].u);
    near(sim.metrics().l2, 0, 0);
    for (let i = 0; i < N; i++) near(sim.u[i], expected.value(sim.x[i]), 0);
    assert.ok(maxDifference(sim.u, expected.sample(N)) < 1e-14);
  }
  const before = sims[1].u.slice();
  sims[0].step();
  assert.deepEqual(sims[1].u, before);
  assert.notStrictEqual(sims[0].u.buffer, sims[1].u.buffer);
}

// Both exact translation and the numerical initial field are snapshots: later
// editor changes cannot alter a simulation already in progress.
{
  const input = clone(DEFAULT_CURVE);
  const sim = createSimulation({ profile: 'custom', customCurve: input, N: 80 });
  const initial = sim.u.slice(), exact = sim.exact(.123), independent = createCurveProfile(input);
  input.points[1][1] = .01; input.points[0][1] = .9; input.mode = 'linear';
  assert.deepEqual(sim.u, initial); assert.deepEqual(sim.exact(.123), exact);
  for (let i = 0; i < sim.N; i++) near(exact[i], independent.value(sim.x[i] - .123), 0);
  assert.notEqual(sim.initialCurve.points[1][1], input.points[1][1]);
  assert.throws(() => { sim.initialCurve.points[1][1] = 0; }, TypeError);
}

// Integer-CFL transport checks custom data against an independently indexed
// shift for both signs of a, including a discontinuous periodic seam.
for (const periodic of [true, false]) for (const a of [-1, 1]) {
  const curve = { points: [[-1, .25], [-.35, .8], [.4, .1], [1, .65]], mode: 'smooth', periodic };
  const sim = createSimulation({ profile: 'custom', customCurve: curve, N: 80, a, cfl: 1 });
  const initial = sim.u.slice();
  for (let k = 0; k < 13; k++) sim.step();
  const shifted = Float64Array.from(initial, (_, i) => initial[((i - 13 * a) % 80 + 80) % 80]);
  assert.deepEqual(sim.u, shifted); assert.deepEqual(sim.exact(), shifted);
  near(sim.metrics().l2, 0, 0);
}

// Custom profiles run through CN and CIP, including non-grid-aligned exact
// times; CN preserves the discrete norm and CIP remains bounded at CFL=.5.
for (const scheme of ['crank-nicolson', 'cip']) for (const a of [-1, 1]) {
  const sim = createSimulation({ scheme, profile: 'custom', N: 200, a, cfl: scheme === 'cip' ? .5 : 2 });
  const before = norm(sim.u);
  for (let k = 0; k < 400; k++) sim.step();
  assert.ok(!sim.failed && sim.u.every(Number.isFinite));
  assert.ok(Math.max(...sim.u.map(Math.abs)) < 1);
  if (scheme === 'crank-nicolson') near(norm(sim.u), before, 1e-12);
  assert.ok(sim.metrics().massError < 1e-12);
}

console.log('PASS: custom-curve validation, PCHIP shape/periodic slopes, linear seams, shared independent samples, immutable snapshots, both transport signs and CN/CIP runs.');
