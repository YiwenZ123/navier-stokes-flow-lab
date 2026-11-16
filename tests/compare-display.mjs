import assert from 'node:assert/strict';
import { DEFAULT_FIELD_MAX, parseFieldMaximum, fieldPeak, fitFieldMaximum, fieldVector } from '../dist/compare-display.js';
import { runComparison } from '../dist/compare-solver.js';

assert.equal(DEFAULT_FIELD_MAX, 0.5);
assert.equal(parseFieldMaximum(' 0.35 '), 0.35);
assert.equal(parseFieldMaximum(1e308), 1e308);
assert.equal(parseFieldMaximum(1e-308), 1e-308);
for (const value of ['', ' ', null, undefined, false, true, [], {}, NaN, Infinity, -Infinity,
  'NaN', 'Infinity', '0.5 m/s', 0, -1, '0', '-0.1', Number.MIN_VALUE, '1e-400', '1e400']) {
  assert.throws(() => parseFieldMaximum(value), RangeError);
}

const emptyVector = { alpha: 0, x: 0, y: 0, clipped: false };
assert.deepEqual(fieldVector(0, 0), emptyVector);
for (const value of [NaN, Infinity, -Infinity]) {
  assert.deepEqual(fieldVector(value, 0), emptyVector);
  assert.deepEqual(fieldVector(0, value), emptyVector);
}
assert.deepEqual(fieldVector(0.3, 0.4), { alpha: 0.68, x: 0.6, y: 0.8, clipped: false });
assert.deepEqual(fieldVector(3, -4), { alpha: 0.68, x: 0.6, y: -0.8, clipped: true });
assert.deepEqual(fieldVector(0.15, 0.2), { alpha: 0.34, x: 0.3, y: 0.4, clipped: false });
assert.throws(() => fieldVector(1, 0, 0), RangeError);
const extreme = fieldVector(1e308, -1e308, 1e-308);
assert.ok(Number.isFinite(extreme.x) && Number.isFinite(extreme.y));
assert.ok(Math.abs(Math.hypot(extreme.x, extreme.y) - 1) < 1e-15);
assert.equal(extreme.alpha, 0.68);

const settings = { driftX: 0.6, driftY: 0.55 };
const example = {
  explicit: { u: new Float64Array([0.6, 0.9, NaN]), v: new Float64Array([0.55, 0.95, 0]) },
  mac: { u: new Float64Array([0.6, Infinity]), v: new Float64Array([0.65, 0.55]) }
};
assert.equal(fieldPeak(example, settings), 0.5);
assert.equal(fitFieldMaximum(example, settings), 0.5);
assert.equal(fieldPeak({ explicit: null, mac: null }, settings), 0);
assert.equal(fieldPeak(null, settings), 0);
assert.equal(fitFieldMaximum(null, settings), DEFAULT_FIELD_MAX);
assert.equal(fitFieldMaximum({ explicit: { u: [0], v: [0] } }), DEFAULT_FIELD_MAX);
for (const [peak, expected] of [[0.001234, 0.0013], [0.351, 0.36], [0.35, 0.35], [12.34, 13], [1.234e200, 1.3e200]]) {
  const frame = { mac: { u: [peak], v: [0] } };
  assert.equal(fitFieldMaximum(frame), expected);
  assert.ok(fitFieldMaximum(frame) >= peak);
}
assert.equal(fitFieldMaximum({ mac: { u: [Number.MAX_VALUE], v: [0] } }), Number.MAX_VALUE);
assert.equal(fitFieldMaximum({ mac: { u: [Number.MIN_VALUE], v: [0] } }), DEFAULT_FIELD_MAX);

// Real stable and unstable trajectories previously changed their shared color
// range abruptly. Fitting any frame must not modify the active fixed scale or
// either solver's arrays, including after the explicit method stops.
let checkedFrames = 0;
let checkedStoppedFrames = 0;
const sameVector = fieldVector(0.15, -0.2, DEFAULT_FIELD_MAX);
for (const dt of [0.1, 0.6]) {
  const result = runComparison('taylor-green', { dt });
  const snapshot = structuredClone(result);
  const activeMaximum = DEFAULT_FIELD_MAX;
  for (const frame of result.frames) {
    checkedFrames++;
    const peak = fieldPeak(frame, result.settings);
    const fittedMaximum = fitFieldMaximum(frame, result.settings);
    assert.ok(Number.isFinite(peak) && Number.isFinite(fittedMaximum));
    assert.ok(fittedMaximum >= peak);
    assert.equal(activeMaximum, DEFAULT_FIELD_MAX);
    assert.deepEqual(fieldVector(0.15, -0.2, activeMaximum), sameVector);
    for (const method of ['explicit', 'mac']) {
      const field = frame[method];
      if (!field) continue;
      for (let index = 0; index < field.u.length; index++) {
        const vector = fieldVector(field.u[index] - result.settings.driftX, field.v[index] - result.settings.driftY, activeMaximum);
        assert.ok(vector.alpha >= 0 && vector.alpha <= 0.68);
        assert.ok(Math.hypot(vector.x, vector.y) <= 1 + 1e-15);
      }
    }
    if (!frame.explicit && frame.mac) {
      checkedStoppedFrames++;
      assert.equal(fieldPeak(frame, result.settings), fieldPeak({ mac: frame.mac }, result.settings));
      const du = frame.mac.u[0] - result.settings.driftX;
      const dv = frame.mac.v[0] - result.settings.driftY;
      assert.deepEqual(fieldVector(du, dv, activeMaximum), fieldVector(du, dv, DEFAULT_FIELD_MAX));
    }
  }
  assert.deepEqual(result, snapshot, 'Display calculations must not mutate solver results');
}
assert.ok(checkedStoppedFrames > 0, 'Exercise MAC frames after explicit stopping');
console.log(`Comparison display verified: fixed color and arrow mapping, validation, bounded arrows, fitting, and ${checkedFrames} real frames (${checkedStoppedFrames} after explicit stopping) without mutation.`);
