import assert from 'node:assert/strict';
import { createWaveSolver } from '../dist/wave-solver.js';

function verifyState(solver) {
  const { nx, ny, h, density, obstacle, state } = solver;
  assert.equal(state.failed, false, state.message);
  for (const values of [state.u, state.v, state.pressure]) {
    assert.ok(values.every(Number.isFinite));
  }
  let divergence = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!state.projectedMask[j * nx + i]) continue;
      const value = (state.u[j * (nx + 1) + i + 1] - state.u[j * (nx + 1) + i]
        + state.v[(j + 1) * nx + i] - state.v[j * nx + i]) / h;
      divergence = Math.max(divergence, Math.abs(value));
    }
  }
  assert.ok(divergence < 1.01e-5, `Projection divergence ${divergence}`);
  assert.ok(Math.abs(divergence - state.maxDivergence) < 1e-10);
  if (state.projectionDt > 0) {
    assert.ok(Math.abs(divergence - state.pressureResidual * state.projectionDt / density) < 1e-9);
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      if (i === 0 || i === nx || state.solid[j * nx + i - 1] || state.solid[j * nx + i]) {
        assert.equal(state.u[j * (nx + 1) + i], 0);
      }
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (j === 0 || j === ny || state.solid[(j - 1) * nx + i] || state.solid[j * nx + i]) {
        assert.equal(state.v[j * nx + i], 0);
      }
    }
  }
  for (const particle of state.particles) {
    assert.ok(particle.x > 0 && particle.x < solver.width && particle.y > 0 && particle.y < solver.height);
    const cell = Math.floor(particle.y / h) * nx + Math.floor(particle.x / h);
    assert.equal(state.solid[cell], 0, 'Markers must stay outside the rasterized solid');
  }
  let forceX = 0;
  let frontPressure = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const index = j * nx + i;
      if (!state.projectedMask[index]) continue;
      if (i + 1 < nx && state.solid[index + 1]) {
        forceX += state.pressure[index] * h;
        frontPressure = Math.max(frontPressure, state.pressure[index]);
      }
      if (i > 0 && state.solid[index - 1]) forceX -= state.pressure[index] * h;
    }
  }
  assert.ok(Math.abs(forceX - state.forceX) < 1e-7, 'Loads must integrate actual exposed mask faces');
  assert.ok(Math.abs(frontPressure - state.wallPressure) < 1e-7);
}

const still = createWaveSolver({ scenario: 'still' });
for (let frame = 0; frame < 120; frame++) still.step();
verifyState(still);
assert.ok(still.state.maxSpeed < 1e-5, 'Hydrostatic water must remain at rest');
const expectedBottomPressure = still.density * still.gravity * (still.depth - still.h / 2);
assert.ok(Math.abs(still.state.wallPressure - expectedBottomPressure) < 0.2);
assert.ok(Math.abs(still.state.forceX) < 0.1, 'Hydrostatic front and rear loads balance');
assert.equal(still.state.gridVolumeError, 0);

for (const amplitude of [0.08, 0.12, 0.18]) {
  const solver = createWaveSolver({ scenario: 'pulse', amplitude });
  let maxForce = 0;
  let maxFront = solver.state.wallPressure;
  for (let frame = 0; frame < 360; frame++) {
    solver.step();
    maxForce = Math.max(maxForce, solver.state.forceX);
    maxFront = Math.max(maxFront, solver.state.wallPressure);
    if (frame % 60 === 0) verifyState(solver);
  }
  verifyState(solver);
  assert.ok(maxForce > 100, 'Wave must exert a measurable net pressure load');
  assert.ok(maxFront > expectedBottomPressure + 100, 'Wave must raise front pressure above hydrostatic');
  assert.ok(Math.abs(solver.state.gridVolumeError) < 8, 'Pulse coarse geometric area drift');
  assert.ok(Math.abs(solver.state.time - 6) < 1e-9);
  solver.reset();
  verifyState(solver);
  assert.equal(solver.state.time, 0);
}

for (const resolution of [40, 80, 120]) {
  const solver = createWaveSolver({ scenario: 'dam-break', resolution });
  for (let frame = 0; frame < 120; frame++) solver.step();
  verifyState(solver);
}
const openTank = createWaveSolver({ obstacle: false, amplitude: 0.18 });
for (let frame = 0; frame < 60; frame++) openTank.step();
verifyState(openTank);
assert.equal(openTank.state.forceX, 0);
assert.equal(openTank.state.wallPressure, 0);
for (const shape of ['square', 'circle', 'triangle']) {
  for (const resolution of [40, 80, 120]) {
    const obstacle = { shape, size: 0.55, centerX: 2.325, bottomY: 0.15 };
    const calm = createWaveSolver({ scenario: 'still', resolution, obstacle });
    assert.equal(calm.obstacle.shape, shape);
    assert.equal(calm.obstacle.centerX, obstacle.centerX);
    assert.equal(calm.obstacle.bottomY, obstacle.bottomY);
    for (let frame = 0; frame < 30; frame++) calm.step();
    verifyState(calm);
    assert.ok(calm.state.maxSpeed < 1e-5, 'Every geometry must support hydrostatic equilibrium');
    assert.ok(Math.abs(calm.state.forceX) < 0.1);

    const wave = createWaveSolver({ scenario: 'pulse', amplitude: 0.18, resolution, obstacle });
    for (let frame = 0; frame < 120; frame++) {
      wave.step();
      if (frame % 30 === 0) verifyState(wave);
    }
    verifyState(wave);
    assert.ok(wave.state.solid.some(value => value === 1));
  }
  const large = createWaveSolver({ scenario: 'dam-break', resolution: 40,
    obstacle: { shape, size: 1.2, centerX: 2, bottomY: 0 } });
  for (let frame = 0; frame < 120; frame++) large.step();
  verifyState(large);
}
const bounded = createWaveSolver({ obstacle: { shape: 'circle', size: 99, centerX: 99, bottomY: 99 } });
assert.ok(bounded.obstacle.x >= bounded.h);
assert.ok(bounded.obstacle.x + bounded.obstacle.width <= bounded.width - bounded.h + 1e-10);
assert.ok(bounded.obstacle.y + bounded.obstacle.height <= bounded.height - bounded.h + 1e-10);
const aliased = createWaveSolver({ obstacle: { shape: 'triangle', size: 0.6, x: 2.5, y: 0.2 } });
assert.equal(aliased.obstacle.centerX, 2.5);
assert.equal(aliased.obstacle.bottomY, 0.2);
console.log('PASS waves: hydrostatic equilibrium, projection identity, raster boundaries/collisions, face-integrated loads, pulse amplitudes, three shapes × three resolutions, shifted and raised bodies, size limits, reset and no-obstacle case.');
