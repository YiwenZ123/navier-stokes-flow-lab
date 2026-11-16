import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { createMacSolver } from "../dist/mac-solver.js";
import { runComparison, runStabilitySweep } from "../dist/compare-solver.js";
import { INITIAL_CONDITIONS, getInitialCondition } from "../dist/initial-conditions.js";

const methods = ["jacobi", "gauss-seidel", "sor"];
const near = (actual, expected, tolerance = 1e-12, message = "numerical agreement") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
const maxDifference = (a, b) => Math.max(...Array.from(a, (value, i) => Math.abs(value - b[i])));
const baseline = {
  "taylor-green": {
    explicit: [.041652589602030145, .015429739989608433, 89, 0],
    mac: [.05361522925418231, .000009509367234506759, 87, 12]
  },
  "multi-vortex": {
    explicit: [.0616930610753103, .011097887880556634, 19, 0],
    mac: [.0706243152927456, .000008346985331220828, 17, 10]
  }
};
// Captured from the shared-grid revision before adding iteration choices.
for (const [preset, reference] of Object.entries(baseline)) {
  const frame = runComparison(preset, { dt: .1, finalTime: 1.2 }).frames.at(-1);
  for (const method of ["explicit", "mac"]) {
    const [error, divergence, pressureSweeps, predictorSweeps] = reference[method];
    near(frame[method].velocityRmsError, error);
    near(frame[method].maxDivergence, divergence);
    assert.equal(frame[method].pressureSweeps, pressureSweeps);
    assert.equal(frame[method].predictorSweeps, predictorSweeps);
  }
}

function makeMac(options = {}) {
  const velocity = getInitialCondition("taylor-green").velocity(0);
  return createMacSolver({
    dt: .1, steps: 1,
    initialVelocity: (i, j, h) => ({
      u: velocity.u(i * h, (j + .5) * h),
      v: velocity.v((i + .5) * h, j * h)
    }), ...options
  });
}

function finish(solver) {
  for (let calls = 0; calls < 5000 && !["complete", "failed"].includes(solver.state.stage); calls++) solver.step(100);
  assert.equal(solver.state.stage, "complete");
  return solver;
}

// Compute operators independently in physical x/y indexing, using the final
// complete iterate rather than any intermediate values from a sweep.
function residuals(solver) {
  const { size: n, h, dt, viscosity } = solver;
  const { u, v, uStar, vStar, pressure: p, poissonRhs: b } = solver.state;
  const at = (i, j) => ((j + n) % n) * n + (i + n) % n;
  const lap = (q, i, j) => (q[at(i + 1, j)] + q[at(i - 1, j)]
    + q[at(i, j + 1)] + q[at(i, j - 1)] - 4 * q[at(i, j)]) / h ** 2;
  const advect = (q, i, j, a, c) => a * (a >= 0 ? q[at(i, j)] - q[at(i - 1, j)] : q[at(i + 1, j)] - q[at(i, j)]) / h
    + c * (c >= 0 ? q[at(i, j)] - q[at(i, j - 1)] : q[at(i, j + 1)] - q[at(i, j)]) / h;
  let pressure = 0, predictor = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = at(i, j);
    pressure = Math.max(pressure, Math.abs(lap(p, i, j) - b[k]));
    const acrossV = (vStar[k] + vStar[at(i - 1, j)] + vStar[at(i, j + 1)] + vStar[at(i - 1, j + 1)]) / 4;
    const acrossU = (uStar[k] + uStar[at(i, j - 1)] + uStar[at(i + 1, j)] + uStar[at(i + 1, j - 1)]) / 4;
    predictor = Math.max(predictor,
      Math.abs(uStar[k] - u[k] + dt * (advect(uStar, i, j, uStar[k], acrossV) - viscosity * lap(uStar, i, j))),
      Math.abs(vStar[k] - v[k] + dt * (advect(vStar, i, j, acrossU, vStar[k]) - viscosity * lap(vStar, i, j))));
  }
  return { pressure, predictor };
}

const firstPressureSweeps = [];
for (const method of methods) {
  const solver = makeMac({ pressureMethod: method, predictorMethod: method });
  solver.step();
  near(solver.state.predictorResidual, residuals(solver).predictor);
  for (let calls = 0; solver.state.stage === "predictor" && calls < 5000; calls++) {
    solver.step(1);
    near(solver.state.predictorResidual, residuals(solver).predictor);
  }
  assert.equal(solver.state.stage, "predicted");
  solver.step();
  assert.equal(solver.state.stage, "pressure");
  solver.step(1);
  firstPressureSweeps.push(solver.state.pressure.slice());
  near(solver.state.pressureResidual, residuals(solver).pressure);
  for (let calls = 0; solver.state.stage === "pressure" && calls < 5000; calls++) {
    solver.step(1);
    near(solver.state.pressureResidual, residuals(solver).pressure);
  }
  assert.equal(solver.state.stage, "pressurized");
  near(solver.state.pressure.reduce((a, b) => a + b, 0) / solver.size ** 2, 0);
  solver.step();
  near(solver.state.maxDivergence, solver.dt / solver.density * solver.state.pressureResidual);
}
assert.ok(maxDifference(firstPressureSweeps[0], firstPressureSweeps[1]) > 1e-5);
assert.ok(maxDifference(firstPressureSweeps[1], firstPressureSweeps[2]) > 1e-5);

// With omega = 1, SOR must perform exactly the same in-place update as GS.
const gs = finish(makeMac({ pressureMethod: "gauss-seidel", predictorMethod: "gauss-seidel" }));
const sorOne = finish(makeMac({ pressureMethod: "sor", pressureOmega: 1, predictorMethod: "sor", predictorOmega: 1 }));
for (const key of ["u", "v", "pressure"]) assert.deepEqual(sorOne.state[key], gs.state[key]);
assert.equal(sorOne.state.pressureSweeps, gs.state.pressureSweeps);
assert.equal(sorOne.state.predictorSweeps, gs.state.predictorSweeps);
const comparisonGs = runComparison("taylor-green", { dt: .1, finalTime: 1.2, pressureMethod: "gauss-seidel", predictorMethod: "gauss-seidel" });
const comparisonSorOne = runComparison("taylor-green", { dt: .1, finalTime: 1.2, pressureMethod: "sor", pressureOmega: 1, predictorMethod: "sor", predictorOmega: 1 });
assert.deepEqual(comparisonSorOne.frames, comparisonGs.frames);

const reference = runComparison("taylor-green", { dt: .1, finalTime: 1.2 });
for (const method of ["gauss-seidel", "sor"]) {
  const result = runComparison("taylor-green", { dt: .1, finalTime: 1.2, pressureMethod: method, predictorMethod: method });
  for (const name of ["explicit", "mac"]) for (const component of ["u", "v"]) {
    // An O(tolerance) difference is expected because each method stops at a
    // different pressure iterate, then propagates that error across 12 steps.
    assert.ok(maxDifference(result.frames.at(-1)[name][component], reference.frames.at(-1)[name][component]) < 2e-4);
  }
}

for (const method of methods) {
  const alternating = finish(makeMac({ pressureMethod: method,
    initialVelocity: (i, j) => ({ u: (i + j) % 2 ? -.01 : .01, v: 0 }) }));
  assert.ok(alternating.state.maxStarDivergence > .01);
  assert.ok(alternating.state.pressureResidual <= alternating.pressureTolerance);
  near(alternating.state.maxDivergence, alternating.dt / alternating.density * alternating.state.pressureResidual);
}

let cases = 0;
for (const preset of INITIAL_CONDITIONS) for (const dt of [.1, .6, 1.2]) for (const method of methods) {
  const result = runComparison(preset.id, { dt, pressureMethod: method, predictorMethod: method });
  assert.equal(result.settings.pressureMethod, method);
  assert.equal(result.settings.predictorMethod, method);
  assert.equal(result.frames.at(-1).time, 12);
  assert.ok(result.outcomes.mac.completed, `${preset.id}/${dt}/${method}: MAC should converge at its default relaxation`);
  for (const frame of result.frames) for (const name of ["explicit", "mac"]) {
    const sample = frame[name];
    if (sample === null) {
      assert.notEqual(result.outcomes[name].stopTime, null);
      continue;
    }
    assert.ok(sample.u.every(Number.isFinite));
    assert.ok(sample.v.every(Number.isFinite));
    if (frame.layer > 0) {
      assert.ok(sample.pressureResidual <= result.settings.pressureTolerance * (1 + 1e-7));
      if (name === "mac") {
        assert.ok(sample.predictorResidual <= result.settings.predictorTolerance * (1 + 1e-7));
        near(sample.maxDivergence, dt / result.settings.density * sample.pressureResidual);
      }
    }
    if (preset.id === "uniform") {
      assert.equal(sample.velocityRmsError, 0);
      assert.equal(sample.maxDivergence, 0);
      assert.equal(sample.pressureSweeps, 0);
    }
  }
  cases++;
}

const failed = runComparison("taylor-green", { dt: .6, finalTime: 1.2,
  pressureMethod: "sor", predictorMethod: "sor", predictorOmega: 1.9 });
assert.equal(failed.outcomes.mac.status, "predictor-failed");
assert.equal(failed.outcomes.mac.lastValidTime, 0);
assert.equal(failed.outcomes.mac.endError, null);
assert.ok(failed.frames.slice(1).every(frame => frame.mac === null));
assert.ok(failed.frames.slice(1).some(frame => frame.explicit !== null), "A failed MAC solve must not suppress the independent explicit result");
const sweep = runStabilitySweep("taylor-green", { pressureMethod: "sor", predictorMethod: "sor", predictorOmega: 1.9 });
assert.ok(sweep.every(row => row.mac.status === "predictor-failed"), "Sweep must forward iteration options");

// Execute the actual embedded numerical IIFE without its DOM/rendering tail.
// Hooks exist only in this VM copy, not in the delivered sandbox or its CSP.
function explicitCore(method = "jacobi", omega = 1.5) {
  const outer = readFileSync(new URL("../dist/explicit-ns-presets.html", import.meta.url), "utf8");
  const html = outer.match(/data-srcdoc="([\s\S]*?)"/)[1]
    .replaceAll("&quot;", '"').replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const start = html.indexOf("(() => {\n  'use strict';");
  const end = html.indexOf("  const root = document.getElementById", start);
  assert.ok(start >= 0 && end > start);
  const scope = {};
  vm.runInNewContext(html.slice(start, end) + `
    globalThis.model = {
      configure(method, omega, preset = 'taylor-green') {
        pressureMethod = method; pressureOmega = omega;
        initialCondition = initialConditions.find(item => item.id === preset); reset();
      }, step, pressureSweep,
      get state() { return { size, h, tolerance, layer, phase, sweep, residual, divergence,
        u: u.slice(), v: v.slice(), pressure: pressure.slice(), source: source.slice() }; },
      manufactured() {
        pressure.fill(0); nextPressure.fill(0); source.fill(0); sweep = 0;
        eachInterior(a => {
          const x = (a % size) * h, y = Math.floor(a / size) * h;
          source[a] = -2 * y * (length - y) - 2 * x * (length - x);
        });
        residual = maxResidual();
      }
    };
  })();`, scope, { timeout: 1000 });
  scope.model.configure(method, omega);
  return scope.model;
}

function explicitResidual(state) {
  const { size: n, h, pressure: p, source } = state;
  let maximum = 0;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i;
    maximum = Math.max(maximum, Math.abs((p[k - 1] + p[k + 1] + p[k - n] + p[k + n] - 4 * p[k]) / h ** 2 - source[k]));
  }
  return maximum;
}
const explicitResults = [];
for (const method of methods) {
  const core = explicitCore(method);
  core.manufactured();
  while (core.state.residual > core.state.tolerance && core.state.sweep < 1800) {
    core.pressureSweep();
    near(core.state.residual, explicitResidual(core.state));
  }
  const state = core.state;
  assert.ok(state.residual <= state.tolerance);
  const length = (state.size - 1) * state.h;
  for (let j = 0; j < state.size; j++) for (let i = 0; i < state.size; i++) {
    const x = i * state.h, y = j * state.h, value = state.pressure[j * state.size + i];
    // This quadratic manufactured pressure has an exact centered-difference
    // Laplacian. The discrete maximum principle bounds the residual error.
    near(value, x * (length - x) * y * (length - y), length ** 2 / 8 * state.tolerance);
    if (i === 0 || j === 0 || i === state.size - 1 || j === state.size - 1) assert.equal(value, 0);
  }
  explicitResults.push(state.sweep);
}
assert.ok(explicitResults[1] < explicitResults[0], "GS must do real in-place work, not alias Jacobi");
assert.ok(explicitResults[2] < explicitResults[1], "SOR should accelerate this manufactured problem at omega=1.5");

const explicitGs = explicitCore("gauss-seidel");
const explicitSorOne = explicitCore("sor", 1);
explicitGs.step(); explicitSorOne.step();
const boundaryBefore = explicitGs.state.pressure;
for (let i = 0; i < 20; i++) { explicitGs.pressureSweep(); explicitSorOne.pressureSweep(); }
assert.deepEqual(Array.from(explicitGs.state.pressure), Array.from(explicitSorOne.state.pressure));
const n = explicitGs.state.size;
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  if (i === 0 || j === 0 || i === n - 1 || j === n - 1) assert.equal(explicitGs.state.pressure[j * n + i], boundaryBefore[j * n + i]);
}
const explicitDefault = explicitCore();
for (let calls = 0; explicitDefault.state.phase !== "complete" && calls < 5000; calls++) explicitDefault.step(100);
assert.equal(explicitDefault.state.phase, "complete");
assert.equal(explicitDefault.state.layer, 20);
assert.equal(explicitDefault.state.sweep, 41);
near(explicitDefault.state.residual, .0009851119841586542);
near(explicitDefault.state.divergence, .21513834106708662);
near(explicitDefault.state.u[100], 1.0760538795200658);
near(explicitDefault.state.v[100], .5472829540858104);

const original = readFileSync(new URL("../dist/explicit-ns-animation.html", import.meta.url));
assert.equal(createHash("sha256").update(original).digest("hex"), "d5ecbc9979251fd4c4d709b1f83626ec94fd5c7b2d83845d2112ff921deb4182");
console.log(`PASS: ${cases} preset/timestep/iteration combinations; Jacobi regression; GS=SOR(1); independent residuals; projection identity; periodic alternating mode; failure semantics; actual sandbox manufactured solution and fixed boundaries.`);
