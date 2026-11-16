import assert from 'node:assert/strict';
import { MAX_CURVE_FILE_BYTES, CurveFileError, serializeCurve, parseCurveFile } from '../dist/curve-file.js';
import { DEFAULT_CURVE } from '../dist/custom-profile.js';
import { SCHEMES, createSimulation } from '../dist/advection-solver.js';

const clone = value => structuredClone(value);
const envelope = curve => ({
  format: 'navier-stokes-flow-lab.initial-condition', version: 1,
  domain: [-1, 1], range: [0, 1], curve,
});
const reject = (input, code) => assert.throws(() => parseCurveFile(input), error => error instanceof CurveFileError && error.code === code);
const base = clone(DEFAULT_CURVE);
const valid = serializeCurve(base);
assert.equal(MAX_CURVE_FILE_BYTES, 65536);
assert.ok(valid.endsWith('\n') && valid.includes('\n  "curve": {'));
assert.deepEqual(JSON.parse(valid), envelope(base));

// All interpolation/boundary variants and a maximum-sized control polygon.
const cases = [];
for (const mode of ['smooth', 'linear']) for (const periodic of [false, true]) {
  const curve = { points: [[-1, .125], [-.5333333333333333, .8765432109876543], [-.031415926535897934, .207], [.625, .742], [1, periodic ? .125 : .915]], mode, periodic };
  cases.push(curve);
  assert.deepEqual(parseCurveFile(serializeCurve(curve)), curve);
}
const maximum = {
  points: Array.from({ length: 18 }, (_, i) => [-1 + 2 * i / 17, .1 + .8 * Math.sin(Math.PI * i / 17) ** 2]),
  mode: 'smooth', periodic: true,
};
maximum.points.at(-1)[1] = maximum.points[0][1];
cases.push(maximum, base);
assert.deepEqual(parseCurveFile(serializeCurve(maximum)), maximum);

// Preserve IEEE double coordinates, including signed zero, and never alias
// the supplied curve or a previous parse result.
const signedZero = { points: [[-1, -0], [-0, .543210987654321], [1, -0]], mode: 'smooth', periodic: true };
const restoredZero = parseCurveFile(serializeCurve(signedZero));
assert.ok(Object.is(restoredZero.points[0][1], -0) && Object.is(restoredZero.points[1][0], -0));
assert.deepEqual(restoredZero, signedZero);
{
  const input = clone(base), text = serializeCurve(input), parsed = parseCurveFile(text);
  input.points[1][1] = .1;
  assert.equal(parsed.points[1][1], base.points[1][1]);
  parsed.points[0][1] = .9;
  assert.deepEqual(parseCurveFile(text), base);
}

// JSON errors are distinct from unsupported file metadata and invalid curves.
for (const input of [undefined, null, '{', '{"x":NaN}', '{"x":Infinity}', 'globalThis.compromised = true']) reject(input, 'json');
for (const value of [null, [], 7, 'curve', {}, envelope(base)]) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.format) continue;
  reject(JSON.stringify(value), 'format');
}
for (const patch of [
  { format: 'other' }, { version: 0 }, { version: 2 }, { version: '1' },
  { domain: [0, 1] }, { domain: [-1, 1, 2] }, { domain: { 0: -1, 1: 1 } },
  { range: [-1, 1] }, { range: ['0', 1] }, { range: null },
]) reject(JSON.stringify({ ...envelope(base), ...patch }), 'format');

for (const invalid of [
  null, {}, [], { ...base, points: [] }, { ...base, points: [[-1, 0]] },
  { ...base, points: [[-1, 0], [0, .5], [-.5, .3], [1, 0]] },
  { ...base, points: [[-1, 0], [-.99, .5], [1, 0]] },
  { ...base, points: [[-1, 0], [1, .5]] }, // Linked heights disagree: no normalization.
  { ...base, points: [[-1, 0], [0, 1.01], [1, 0]] },
  { ...base, points: [[-1, -.01], [0, .5], [1, -.01]] },
  { ...base, points: [[-.9, 0], [1, 0]] },
  { ...base, points: [[-1, 0], [1.01, 0]] },
  { ...base, points: [[-1, 0], [0, '0.5'], [1, 0]] },
  { ...base, points: [[-1, 0], [0], [1, 0]] },
  { ...base, points: [[-1, 0], [0, .5, .2], [1, 0]] },
  { ...base, points: [[-1, 0], null, [1, 0]] },
  { ...base, points: Array.from({ length: 19 }, (_, i) => [-1 + i / 9, .5]) },
  { ...base, mode: 'cubic' }, { ...base, periodic: 'false' },
]) reject(JSON.stringify(envelope(invalid)), 'curve');
reject('{"format":"navier-stokes-flow-lab.initial-condition","version":1,"domain":[-1,1],"range":[0,1],"curve":{"points":[[-1,0],[0,1e400],[1,0]],"mode":"smooth","periodic":true}}', 'curve');
assert.throws(() => serializeCurve({ ...base, points: [[-1, .1], [1, .2]] }), error => error instanceof CurveFileError && error.code === 'curve');

// Limit is UTF-8 bytes, not JS string length. Exact 64 KiB whitespace-padded
// JSON is accepted; one extra byte, multibyte text or huge input is rejected.
const padding = MAX_CURVE_FILE_BYTES - new TextEncoder().encode(valid).length;
assert.deepEqual(parseCurveFile(valid + ' '.repeat(padding)), base);
reject(valid + ' '.repeat(padding + 1), 'size');
reject('"' + 'é'.repeat(32768) + '"', 'size');
reject(' '.repeat(MAX_CURVE_FILE_BYTES * 2), 'size');

// Unknown JSON metadata is inert and discarded, including prototype-looking
// keys; only the normalized curve leaves the decoder.
{
  const doc = JSON.parse(valid);
  doc.note = 'globalThis.compromised = true';
  Object.defineProperty(doc, '__proto__', { enumerable: true, value: { polluted: true } });
  assert.deepEqual(parseCurveFile(JSON.stringify(doc)), base);
  assert.equal({}.polluted, undefined);
}

// Import/export must not perturb a solver's starting samples, exact solution,
// or subsequent steps. Check every supported stencil, both velocity signs,
// and linked/unlinked smooth/linear curves on several grids.
for (const curve of cases) for (const { id: scheme } of SCHEMES) for (const a of [-1, 1]) for (const N of [40, 80, 200, 400]) {
  const roundtrip = parseCurveFile(serializeCurve(curve));
  const params = { scheme, profile: 'custom', N, a, cfl: .5 };
  const original = createSimulation({ ...params, customCurve: curve });
  const imported = createSimulation({ ...params, customCurve: roundtrip });
  assert.deepEqual(imported.u, original.u);
  assert.deepEqual(imported.exact(.12345), original.exact(.12345));
  assert.deepEqual(imported.exact(2), original.exact(2));
  for (let i = 0; i < 8; i++) { original.step(); imported.step(); }
  assert.deepEqual(imported.u, original.u);
  assert.deepEqual(imported.g, original.g);
  assert.deepEqual(imported.metrics(), original.metrics());
}

console.log('PASS: bounded curve JSON, exact smooth/linear round trips, malformed/unsupported rejection, UTF-8 limits, independent copies and all 10 solvers preserved.');
