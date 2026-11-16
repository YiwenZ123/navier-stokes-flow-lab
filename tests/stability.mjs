import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPATIAL_GRID } from "../dist/spatial-grid.js";
import { INITIAL_CONDITIONS } from "../dist/initial-conditions.js";
import { createMacSolver } from "../dist/mac-solver.js";
import { runComparison, runStabilitySweep } from "../dist/compare-solver.js";
import { DT_OPTIONS, COMPARISON_END_TIME, normalizeTimeStep } from "../dist/time-step-options.js";

assert.equal(COMPARISON_END_TIME, 12);
assert.equal(normalizeTimeStep(null), .1);
assert.equal(normalizeTimeStep("not-a-number"), .1);
assert.equal(normalizeTimeStep(-1), .1);
assert.equal(normalizeTimeStep(.025), .025);
assert.equal(normalizeTimeStep(100), 1.2);
assert.throws(() => createMacSolver({dt: 0}), RangeError);
assert.throws(() => createMacSolver({steps: 0}), RangeError);
assert.throws(() => runComparison("taylor-green", {dt:.3,finalTime:1}), RangeError);

// Equal physical spacing uses 18 intervals. The explicit animation includes both
// boundary nodes; periodic MAC and comparison fields store 18 samples per axis.
assert.equal(SPATIAL_GRID.intervals, 18);
assert.equal(SPATIAL_GRID.length, 2 * Math.PI);
assert.equal(SPATIAL_GRID.h, SPATIAL_GRID.length / SPATIAL_GRID.intervals);
const explicitDocument = readFileSync(new URL("../dist/explicit-ns-presets.html", import.meta.url), "utf8");
const embeddedGrid = explicitDocument.match(/const spatialGrid\s*=\s*\{\s*intervals:\s*(\d+),\s*length:\s*([.\deE+-]+)\s*\}/);
assert.ok(embeddedGrid, "The sandboxed explicit animation must embed the shared grid configuration");
assert.equal(Number(embeddedGrid[1]), SPATIAL_GRID.intervals);
assert.equal(Number(embeddedGrid[2]), SPATIAL_GRID.length);
assert.equal(Number(embeddedGrid[2]) / Number(embeddedGrid[1]), SPATIAL_GRID.h);
assert.match(explicitDocument, /const size = spatialGrid\.intervals \+ 1;/);
assert.match(explicitDocument, /const h = length \/ spatialGrid\.intervals;/);

const macGrid = createMacSolver();
assert.equal(macGrid.size, SPATIAL_GRID.intervals);
assert.equal(macGrid.h, SPATIAL_GRID.h);
assert.equal(macGrid.state.u.length, SPATIAL_GRID.intervals ** 2);
assert.equal(macGrid.state.v.length, SPATIAL_GRID.intervals ** 2);

// Even periodic grids admit an alternating mode. This checks that the weighted
// pressure iteration damps it and the projection removes its divergence.
const alternating = createMacSolver({
  dt: .1, steps: 1,
  initialVelocity: (i, j) => ({u: (i + j) % 2 ? -.01 : .01, v: 0})
});
for (let calls = 0; calls < 5000 && alternating.state.layer < 1
  && alternating.state.stage !== "failed"; calls++) alternating.step(1);
assert.equal(alternating.state.stage, "complete", "Alternating pressure mode must converge on the even grid");
assert.ok(alternating.state.maxStarDivergence > .01);
assert.ok(alternating.state.pressureResidual <= alternating.pressureTolerance);
assert.ok(alternating.state.maxDivergence <= alternating.dt / alternating.density * alternating.pressureTolerance * (1 + 1e-7));
assert.ok(Math.abs(alternating.state.maxDivergence
  - alternating.dt / alternating.density * alternating.state.pressureResidual) < 1e-12);

for (const preset of INITIAL_CONDITIONS) {
  const report = [];
  for (const dt of DT_OPTIONS) {
    const result = runComparison(preset.id, {dt});
    assert.equal(result.settings.dt, dt);
    assert.equal(result.settings.size, SPATIAL_GRID.intervals);
    assert.equal(result.settings.h, SPATIAL_GRID.h);
    for (const method of ["explicit", "mac"]) {
      assert.equal(result.frames[0][method].u.length, SPATIAL_GRID.intervals ** 2);
      assert.equal(result.frames[0][method].v.length, SPATIAL_GRID.intervals ** 2);
    }
    assert.equal(result.frames.at(-1).time, COMPARISON_END_TIME);
    assert.equal(result.frames.length, Math.round(COMPARISON_END_TIME/dt) + 1);
    for (const method of ["explicit","mac"]) {
      const outcome = result.outcomes[method];
      assert.ok(["bounded","growth","diverged","pressure-failed","predictor-failed"].includes(outcome.status));
      assert.ok(result.frames[0][method].maxDivergence < 1e-13);
      let lastAvailable = 0;
      let missing = false;
      let maximumGrowth = preset.id === "uniform" ? null : 1;
      for (const frame of result.frames) {
        const snapshot = frame[method];
        if (snapshot === null) {
          missing = true;
          assert.notEqual(outcome.stopTime, null);
          continue;
        }
        assert.equal(missing,false,"A stopped method must not restart or fabricate later fields");
        lastAvailable = frame.time;
        for (const values of [snapshot.u,snapshot.v,snapshot.divergence]) assert.ok(values.every(Number.isFinite));
        for (const key of ["velocityRmsError","maxDivergence","perturbationRms","cfl","diffusionNumber","advectionDiffusion"]) assert.ok(Number.isFinite(snapshot[key]),key);
        assert.ok(Math.abs(snapshot.advectionDiffusion-snapshot.cfl-4*snapshot.diffusionNumber)<1e-10);
        if (frame.layer>0) {
          assert.ok(snapshot.pressureResidual <= result.settings.pressureTolerance*(1+1e-7));
          if (method === "mac") {
            assert.ok(snapshot.predictorResidual <= result.settings.predictorTolerance*(1+1e-7));
            assert.ok(Math.abs(snapshot.maxDivergence-dt/result.settings.density*snapshot.pressureResidual)<1e-12,
              "MAC projection divergence must agree with the pressure residual");
          }
        }
        if (snapshot.growthFactor !== null) maximumGrowth = Math.max(maximumGrowth,snapshot.growthFactor);
        if (preset.id === "uniform") {
          assert.equal(snapshot.velocityRmsError,0);
          assert.equal(snapshot.maxDivergence,0);
          assert.equal(snapshot.pressureSweeps,0);
          assert.equal(snapshot.growthFactor,null);
        }
      }
      assert.equal(outcome.lastValidTime,lastAvailable);
      assert.equal(outcome.maxGrowth,maximumGrowth);
      if (outcome.completed) {
        assert.equal(outcome.stopTime,null);
        assert.equal(outcome.endError,result.frames.at(-1)[method].velocityRmsError);
        assert.equal(lastAvailable,COMPARISON_END_TIME);
      } else {
        assert.equal(outcome.endError,null);
        assert.ok(outcome.stopTime <= COMPARISON_END_TIME);
      }
    }
    report.push(`${dt}:${result.outcomes.explicit.status}/${result.outcomes.mac.status}`);
  }
  console.log(preset.id,report.join(" "));
}

const defaultSweep = runStabilitySweep();
assert.equal(defaultSweep.length, DT_OPTIONS.length);
assert.ok(defaultSweep.some(row=>row.explicit.status === "diverged" && row.mac.completed));
assert.ok(defaultSweep.every(row=>row.finalTime === COMPARISON_END_TIME));
assert.ok(defaultSweep.every(row=>!Object.hasOwn(row,"frames")));
console.log("PASS: 7 presets × 9 timesteps, independent stopping, equal end time, uniform invariance, shared spatial grid, alternating-mode convergence and projection identity.");
