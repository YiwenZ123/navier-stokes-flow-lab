import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { metadata, frames } from '../dist/assets/home-wave-data.js';
import { createWaveSolver } from '../dist/wave-solver.js';

// The homepage is a replay of this precise lesson configuration, not a separate
// lower-resolution approximation. Check the asset independently of its generator.
const expectedOptions = {
  scenario: 'dam-break', amplitude: 0.12, resolution: 120,
  obstacle: { shape: 'square', size: 0.7, centerX: 2.75, bottomY: 0 }
};
assert.deepEqual(metadata.options, expectedOptions);
assert.equal(metadata.nx, 120);
assert.equal(metadata.ny, 60);
assert.equal(metadata.width, 4);
assert.equal(metadata.height, 2);
assert.equal(metadata.h, 1 / 30);
assert.equal(metadata.duration, 6);
assert.equal(metadata.fps, 60);
assert.equal(metadata.integrationInterval, 1 / 60);
assert.equal(metadata.sampleEvery, 1);
assert.equal(metadata.encoding, 'base64-lsb-first-liquid-mask');
const solverSource = await readFile(new URL('../dist/wave-solver.js', import.meta.url));
assert.equal(metadata.solverSha256, createHash('sha256').update(solverSource).digest('hex'),
  'Regenerate the replay when the numerical solver changes');

const cellCount = metadata.nx * metadata.ny;
assert.equal(cellCount, 7200);
assert.equal(frames.length, 361, 'Include t = 0 and every 1/60 s through t = 6');
assert.equal(metadata.times.length, frames.length);
const decoded = frames.map((encoded, frame) => {
  assert.equal(typeof encoded, 'string');
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    `Frame ${frame} is not strict base64`);
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.length, 900, `Frame ${frame} must encode exactly 7200 bits`);
  assert.equal(bytes.toString('base64'), encoded, `Frame ${frame} has noncanonical padding`);
  const mask = new Uint8Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    mask[cell] = (bytes[cell >> 3] >> (cell & 7)) & 1;
    const i = cell % 120, j = Math.floor(cell / 120);
    if (i >= 72 && i <= 92 && j <= 20) {
      assert.equal(mask[cell], 0, `Frame ${frame}: water inside the square at cell ${cell}`);
    }
  }
  assert.equal(metadata.times[frame], Number((frame / 60).toFixed(9)),
    `Incorrect physical timestamp for frame ${frame}`);
  if (frame) assert.ok(metadata.times[frame] > metadata.times[frame - 1]);
  return mask;
});

const solver = createWaveSolver(expectedOptions);
assert.equal(solver.nx, metadata.nx);
assert.equal(solver.ny, metadata.ny);
assert.equal(solver.h, metadata.h);
assert.equal(solver.obstacle.x, 2.4);
assert.equal(solver.obstacle.y, 0);
assert.equal(solver.state.solid.reduce((sum, value) => sum + value, 0), 441);
for (let cell = 0; cell < cellCount; cell++) {
  const i = cell % 120, j = Math.floor(cell / 120);
  assert.equal(solver.state.solid[cell], Number(i >= 72 && i <= 92 && j <= 20));
}

let largestDivergence = 0;
let changingFrames = 0;
for (let frame = 0; frame < frames.length; frame++) {
  if (frame) solver.step(Math.min(1 / 60, 6 - solver.state.time));
  const { state } = solver;
  assert.equal(state.failed, false, `Frame ${frame}: ${state.message}`);
  assert.ok(Math.abs(state.time - metadata.times[frame]) < 1e-9,
    `Frame ${frame} does not correspond to the solver's physical time`);
  for (const field of [state.u, state.v, state.pressure]) {
    assert.ok(field.every(Number.isFinite), `Nonfinite solver field at frame ${frame}`);
  }
  assert.ok(state.maxDivergence <= 1.01e-5, `Projection did not converge at frame ${frame}`);
  largestDivergence = Math.max(largestDivergence, state.maxDivergence);
  let changed = false;
  for (let cell = 0; cell < cellCount; cell++) {
    if (decoded[frame][cell] !== state.mask[cell]) {
      assert.fail(`Replay differs from fresh solver at frame ${frame}, cell ${cell}`);
    }
    assert.equal(state.liquid[cell], state.mask[cell], 'Replay must use the visible post-advection liquid mask');
    if (frame && decoded[frame][cell] !== decoded[frame - 1][cell]) changed = true;
  }
  if (changed) changingFrames++;
  for (const particle of state.particles) {
    assert.ok(particle.x > 0 && particle.x < 4 && particle.y > 0 && particle.y < 2);
    const cell = Math.floor(particle.y / solver.h) * solver.nx + Math.floor(particle.x / solver.h);
    assert.equal(state.solid[cell], 0, `Marker inside a solid at frame ${frame}`);
  }
}
assert.ok(changingFrames > 0, 'The replay must contain evolving water geometry');
assert.ok(Math.abs(solver.state.time - 6) < 1e-8);
assert.notDeepEqual(decoded.at(-1), decoded[0], 'The final frame must retain the simulated result');
console.log(`Home wave replay verified: ${frames.length} frames, 7200 cells each, all equal to a fresh 120×60 MAC solve; max divergence ${largestDivergence.toExponential(3)}.`);
