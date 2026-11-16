import assert from 'node:assert/strict';
import { createWaveSolver } from '../dist/wave-solver.js';

function verify(solver) {
  const { state, nx, ny, h } = solver;
  assert.equal(state.failed, false, `${solver.scenario}: ${state.message}`);
  for (const field of [state.u, state.v, state.pressure]) assert.ok(field.every(Number.isFinite));
  assert.ok(state.maxDivergence < 1.01e-5, `${solver.scenario}: divergence ${state.maxDivergence}`);
  for (const particle of state.particles) {
    assert.ok(particle.x > 0 && particle.x < solver.width && particle.y > 0 && particle.y < solver.height);
    assert.equal(state.solid[Math.floor(particle.y / h) * nx + Math.floor(particle.x / h)], 0);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
    if (!i || i === nx || state.solid[j * nx + i - 1] || state.solid[j * nx + i]) assert.equal(state.u[j * (nx + 1) + i], 0);
  }
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
    if (!j || j === ny || state.solid[(j - 1) * nx + i] || state.solid[j * nx + i]) assert.equal(state.v[j * nx + i], 0);
  }
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

// Definitions are in metres, before grid rasterization.
const pulse = createWaveSolver({ waveHeight: 0.3, depth: 0.75, resolution: 40 });
close(pulse.initialSurfaceAt(0.85), 1.05);
assert.ok(pulse.state.maxSpeed > 0);
const double = createWaveSolver({ scenario: 'double-pulse', waveHeight: 0.3, depth: 0.5, resolution: 40 });
close(double.initialSurfaceAt(0.55), 0.8);
close(double.initialSurfaceAt(1.55), 0.8);
close(double.initialSurfaceAt(1.05), 0.5);
assert.ok(double.state.maxSpeed > 0);
const hump = createWaveSolver({ scenario: 'hump', waveHeight: 0.3, depth: 0.5, resolution: 40 });
close(hump.initialSurfaceAt(1), 0.8);
assert.ok(hump.state.u.every(value => value === 0) && hump.state.v.every(value => value === 0));
const standing = createWaveSolver({ scenario: 'standing-wave', waveHeight: 0.4, depth: 0.25, resolution: 40 });
close(standing.initialSurfaceAt(0), 0.45);
close(standing.initialSurfaceAt(2), 0.05);
close(standing.initialSurfaceAt(4), 0.45);
assert.ok(standing.state.u.every(value => value === 0) && standing.state.v.every(value => value === 0));
const dam = createWaveSolver({ scenario: 'dam-break', waveHeight: 1, depth: 0.75, resolution: 40 });
close(dam.initialSurfaceAt(1), 1.75);
close(dam.initialSurfaceAt(2), 0.75);
assert.ok(dam.state.u.every(value => value === 0) && dam.state.v.every(value => value === 0));
const still = createWaveSolver({ scenario: 'still', waveHeight: 0.4, depth: 0.75, resolution: 40 });
assert.equal(still.waveHeight, 0);
close(still.initialSurfaceAt(1), 0.75);

// Existing saved lessons keep their original surfaces and velocity initialization.
for (const amplitude of [0.08, 0.12, 0.18]) {
  const legacyPulse = createWaveSolver({ scenario: 'pulse', amplitude, resolution: 40 });
  assert.equal(legacyPulse.waveHeight, amplitude);
  assert.equal(legacyPulse.depth, 0.5);
  for (let x = 0; x <= 4; x += 0.125) {
    assert.equal(legacyPulse.initialSurfaceAt(x), 0.5 + amplitude * Math.exp(-(((x - 0.85) / 0.35) ** 2)));
  }
  const legacyDam = createWaveSolver({ scenario: 'dam-break', amplitude, resolution: 40 });
  assert.equal(legacyDam.initialSurfaceAt(1), 0.95 + amplitude);
  assert.equal(legacyDam.initialSurfaceAt(2), 0.25);
}

for (const value of [NaN, Infinity, -Infinity, '', '  ', null, false, {}, []]) {
  const invalid = createWaveSolver({ resolution: value, depth: value, waveHeight: value, amplitude: value, viscosity: value });
  assert.equal(invalid.nx, 80);
  assert.equal(invalid.depth, 0.5);
  assert.equal(invalid.waveHeight, 0.12);
  assert.equal(invalid.viscosity, 1e-6);
  verify(invalid);
}
const bounded = createWaveSolver({ resolution: 999, depth: 999, waveHeight: 999 });
assert.equal(bounded.nx, 160);
assert.equal(bounded.ny, 80);
assert.equal(bounded.depth, 0.75);
assert.equal(bounded.waveHeight, 0.4);
const minimum = createWaveSolver({ resolution: -1, depth: -1, waveHeight: -1 });
assert.equal(minimum.nx, 40);
assert.equal(minimum.depth, 0.25);
assert.equal(minimum.waveHeight, 0);

// Every offered grid actually creates a distinct, square-cell spatial discretization.
for (const resolution of [40, 60, 80, 100, 120, 160]) {
  const solver = createWaveSolver({ scenario: 'still', resolution, depth: 0.5 });
  assert.equal(solver.nx, resolution);
  assert.equal(solver.ny, resolution / 2);
  assert.equal(solver.h, 4 / resolution);
  for (let frame = 0; frame < 4; frame++) solver.step();
  verify(solver);
  assert.ok(solver.state.maxSpeed < 1e-5);
}

// New profiles evolve under the existing projection, with bounded markers and finite pressure.
const solvers = [pulse, double, hump, standing, dam, still];
for (const solver of solvers) {
  verify(solver);
  const initial = solver.state.liquid.slice();
  for (let frame = 0; frame < 120; frame++) {
    solver.step();
    if (frame % 30 === 0) verify(solver);
  }
  verify(solver);
  if (solver.scenario === 'still') {
    assert.ok(solver.state.maxSpeed < 1e-5);
    assert.deepEqual(solver.state.liquid, initial);
  } else assert.notDeepEqual(solver.state.liquid, initial, `${solver.scenario} must evolve`);
  solver.reset();
  assert.equal(solver.state.time, 0);
  assert.deepEqual(solver.state.liquid, initial);
  verify(solver);
}
const fine = createWaveSolver({ scenario: 'double-pulse', resolution: 160, waveHeight: 0.18,
  obstacle: { shape: 'triangle', size: 0.7, centerX: 2.75, bottomY: 0 } });
for (let frame = 0; frame < 30; frame++) fine.step();
verify(fine);

// Exercise a long, high-head release; duration is controlled by the caller, not a six-second solver cap.
const long = createWaveSolver({ scenario: 'dam-break', resolution: 40, waveHeight: 1, depth: 0.75 });
while (long.state.time < 20 - 1e-9) {
  long.step(Math.min(1 / 60, 20 - long.state.time));
  if (Math.abs(long.state.time - Math.round(long.state.time)) < 1e-8) verify(long);
}
verify(long);
close(long.state.time, 20);
console.log('PASS wave options: six profiles, geometric height/depth definitions, legacy compatibility, finite options, six grids through 160×80, reset, projection/walls/markers and 20-second high-head dam release.');
