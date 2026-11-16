import assert from 'node:assert/strict';
import {
  DEFAULT_PRESSURE_RANGE, createPressureRange, pressureColor, pressureExtent, fitPressureRange
} from '../dist/pressure-display.js';
import { createWaveSolver } from '../dist/wave-solver.js';

assert.deepEqual(DEFAULT_PRESSURE_RANGE, { minimum: -5000, maximum: 20000 });
assert.ok(Object.isFrozen(DEFAULT_PRESSURE_RANGE));
const range = createPressureRange(' -5 ', '20');
assert.deepEqual(range, DEFAULT_PRESSURE_RANGE);
assert.notEqual(range, DEFAULT_PRESSURE_RANGE);
assert.ok(Object.isFrozen(range));
assert.deepEqual(createPressureRange(-0.125, 1.375), { minimum: -125, maximum: 1375 });
assert.throws(() => { range.minimum = 0; }, TypeError);

for (const value of ['', '   ', '\n', null, undefined, false, true, [], {}, NaN, Infinity, -Infinity, 'NaN', 'Infinity', '5 kPa']) {
  assert.throws(() => createPressureRange(value, 20), RangeError);
  assert.throws(() => createPressureRange(-5, value), RangeError);
}
for (const pair of [[0, 0], [2, 1], [1e308, Infinity], [-1e308, 1e308], [-1e305, 1e305]]) {
  assert.throws(() => createPressureRange(...pair), RangeError);
}
assert.throws(() => createPressureRange(0, 1e308), RangeError, 'Pa conversion must not overflow');

assert.equal(pressureColor(-5000, range), 'rgb(167, 217, 247)');
assert.equal(pressureColor(20000, range), 'rgb(231, 126, 55)');
assert.equal(pressureColor(7500, range), 'rgb(199, 172, 151)');
assert.equal(pressureColor(0, range), 'rgb(180, 199, 209)');
assert.equal(pressureColor(5000, range), 'rgb(193, 181, 170)');
assert.equal(pressureColor(-1e6, range), pressureColor(range.minimum, range));
assert.equal(pressureColor(1e6, range), pressureColor(range.maximum, range));
assert.equal(pressureColor(5000), pressureColor(5000, range));
assert.equal(pressureColor(5000, createPressureRange(0, 10)), pressureColor(7500, range));
for (const invalid of [null, {}, { minimum: 0, maximum: 0 }, { minimum: 2, maximum: 1 }, { minimum: -1e308, maximum: 1e308 }]) {
  assert.throws(() => pressureColor(0, invalid), RangeError);
}
for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => pressureColor(invalid, range), RangeError);

const pressures = new Float64Array([-12001, 1234, 1000000, NaN, Infinity, -Infinity]);
const liquid = new Uint8Array([1, 1, 0, 1, 1, 1]);
const beforePressure = pressures.slice(), beforeLiquid = liquid.slice();
assert.deepEqual(pressureExtent(pressures, liquid), { minimum: -12001, maximum: 1234 });
const fit = fitPressureRange(pressures, liquid);
assert.deepEqual(fit, { minimum: -13000, maximum: 2000 });
assert.ok(Object.isFrozen(fit));
assert.deepEqual(pressures, beforePressure);
assert.deepEqual(liquid, beforeLiquid);
assert.equal(pressureExtent([1, 2], [0, 0]), null);
assert.equal(pressureExtent([NaN, Infinity], [1, 1]), null);
assert.equal(pressureExtent([], []), null);
assert.throws(() => pressureExtent([1], []), RangeError);
assert.deepEqual(fitPressureRange([500], [1]), { minimum: 0, maximum: 1000 });
assert.deepEqual(fitPressureRange([-500], [1]), { minimum: -1000, maximum: 0 });
assert.deepEqual(fitPressureRange([0, 0], [1, 1]), { minimum: 0, maximum: 1000 });
assert.deepEqual(fitPressureRange([-1000, 2000], [1, 1]), { minimum: -1000, maximum: 2000 });
assert.deepEqual(fitPressureRange([-Number.MIN_VALUE, Number.MIN_VALUE], [1, 1]), { minimum: -1000, maximum: 1000 });
assert.equal(fitPressureRange([], []), DEFAULT_PRESSURE_RANGE);
assert.equal(fitPressureRange([Infinity, 1], [1, 0]), DEFAULT_PRESSURE_RANGE);

// A fixed absolute pressure has the same color even as another cell's extremum
// changes. Fitting is an explicit calculation and cannot alter the active range.
const referenceColor = pressureColor(5000, range);
for (const extremum of [6000, 10000, 65000, -15000]) {
  const field = [5000, extremum], mask = [1, 1];
  const extent = pressureExtent(field, mask);
  assert.ok(extent.minimum <= 5000 && extent.maximum >= 5000);
  fitPressureRange(field, mask);
  assert.equal(pressureColor(field[0], range), referenceColor);
  assert.deepEqual(range, DEFAULT_PRESSURE_RANGE);
}

// Exercise the display helpers against real pressure fields around the impact,
// including the user's finer-grid triangular-obstacle dam-break configuration.
let sampledFrames = 0;
for (const options of [
  { scenario: 'pulse', resolution: 80 },
  { scenario: 'dam-break', amplitude: 0.12, resolution: 120,
    obstacle: { shape: 'triangle', size: 0.7, centerX: 2, bottomY: 0 } }
]) {
  const solver = createWaveSolver(options);
  for (let frame = 0; frame <= 60; frame++) {
    if (frame) solver.step(1 / 60);
    assert.equal(solver.state.failed, false, solver.state.message);
    if (frame % 15 !== 0) continue;
    sampledFrames++;
    const { state } = solver;
    const copies = [state.u.slice(), state.v.slice(), state.pressure.slice(), state.liquid.slice()];
    const time = state.time;
    const extent = pressureExtent(state.pressure, state.liquid);
    assert.ok(extent && Number.isFinite(extent.minimum) && Number.isFinite(extent.maximum));
    const currentFit = fitPressureRange(state.pressure, state.liquid);
    assert.ok(currentFit.minimum <= Math.min(0, extent.minimum));
    assert.ok(currentFit.maximum >= Math.max(0, extent.maximum));
    assert.ok(currentFit.maximum - currentFit.minimum >= 1000);
    assert.equal(Math.abs(currentFit.minimum % 1000), 0);
    assert.equal(Math.abs(currentFit.maximum % 1000), 0);
    for (let cell = 0; cell < state.pressure.length; cell++) {
      if (!state.liquid[cell]) continue;
      const color = pressureColor(state.pressure[cell], range);
      assert.match(color, /^rgb\(\d+, \d+, \d+\)$/);
      if (state.pressure[cell] > range.maximum) assert.equal(color, 'rgb(231, 126, 55)');
      if (state.pressure[cell] < range.minimum) assert.equal(color, 'rgb(167, 217, 247)');
    }
    assert.equal(pressureColor(5000, range), referenceColor);
    assert.equal(state.time, time);
    [state.u, state.v, state.pressure, state.liquid].forEach((field, index) => assert.deepEqual(field, copies[index]));
  }
}
console.log(`Pressure display verified: fixed-color invariance, units, clamping, validation, visible-cell fitting, and ${sampledFrames} real solver frames without state mutation.`);
