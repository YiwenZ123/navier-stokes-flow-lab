import { createMacSolver } from "./mac-solver.js";
import { getInitialCondition } from "./initial-conditions.js";
import { DT_OPTIONS, COMPARISON_END_TIME, GROWTH_WARNING, GROWTH_STOP, normalizeTimeStep } from "./time-step-options.js";
import { normalizeIterationOptions } from "./iteration-options.js";

const pressureSweepLimit = 3000;

function periodicNeighbors(size) {
  const count = size * size;
  const west = new Int32Array(count);
  const east = new Int32Array(count);
  const south = new Int32Array(count);
  const north = new Int32Array(count);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cell = j * size + i;
      west[cell] = j * size + (i + size - 1) % size;
      east[cell] = j * size + (i + 1) % size;
      south[cell] = ((j + size - 1) % size) * size + i;
      north[cell] = ((j + 1) % size) * size + i;
    }
  }
  return { west, east, south, north };
}

function removeMean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  for (let i = 0; i < values.length; i++) values[i] -= mean;
  return mean;
}

function flowMetrics(u, v, settings) {
  let squareSum = 0;
  let maxAbsU = 0;
  let maxAbsV = 0;
  for (let c = 0; c < u.length; c++) {
    squareSum += (u[c] - settings.driftX) ** 2 + (v[c] - settings.driftY) ** 2;
    maxAbsU = Math.max(maxAbsU, Math.abs(u[c]));
    maxAbsV = Math.max(maxAbsV, Math.abs(v[c]));
  }
  // This global maximum bound is conservative for every local upwind coefficient.
  const cfl = settings.dt / settings.h * (maxAbsU + maxAbsV);
  const diffusionNumber = settings.viscosity * settings.dt / settings.h ** 2;
  return {
    perturbationRms: Math.sqrt(squareSum / u.length),
    cfl, diffusionNumber, advectionDiffusion: cfl + 4 * diffusionNumber
  };
}

function createExplicitSolver(settings, neighbors, initial) {
  const { size, h, dt, density, viscosity, pressureTolerance, pressureRelaxation, pressureMethod } = settings;
  const { west, east, south, north } = neighbors;
  const count = size * size;
  const field = () => new Float64Array(count);
  const u = field();
  const v = field();
  const nextU = field();
  const nextV = field();
  const source = field();
  let pressure = field();
  let nextPressure = field();
  const hSquared = h * h;
  const centeredX = (q, c) => (q[east[c]] - q[west[c]]) / (2 * h);
  const centeredY = (q, c) => (q[north[c]] - q[south[c]]) / (2 * h);
  const neighborSum = (q, c) => q[west[c]] + q[east[c]] + q[south[c]] + q[north[c]];
  const laplacian = (q, c) => (neighborSum(q, c) - 4 * q[c]) / hSquared;
  let pressureSweeps = 0;
  let pressureResidual = null;
  let rhsMean = null;
  for (let c = 0; c < count; c++) {
    const x = (c % size + 0.5) * h;
    const y = (Math.floor(c / size) + 0.5) * h;
    u[c] = initial.u(x, y);
    v[c] = initial.v(x, y);
  }

  function solvePressure() {
    for (let c = 0; c < count; c++) {
      const ux = centeredX(u, c);
      const uy = centeredY(u, c);
      const vx = centeredX(v, c);
      const vy = centeredY(v, c);
      source[c] = -density * (ux * ux + 2 * uy * vx + vy * vy);
    }
    // Once discrete divergence develops, this collocated source may have a nonzero mean.
    rhsMean = removeMean(source);
    pressure.fill(0);
    pressureSweeps = 0;
    while (pressureSweeps <= pressureSweepLimit) {
      pressureResidual = 0;
      for (let c = 0; c < count; c++) {
        const sum = neighborSum(pressure, c);
        const residual = (sum - 4 * pressure[c]) / hSquared - source[c];
        pressureResidual = Math.max(pressureResidual, Math.abs(residual));
        const jacobi = (sum - hSquared * source[c]) / 4;
        nextPressure[c] = pressure[c] + pressureRelaxation * (jacobi - pressure[c]);
      }
      if (pressureResidual <= pressureTolerance) {
        removeMean(pressure);
        return true;
      }
      if (!Number.isFinite(pressureResidual) || pressureSweeps === pressureSweepLimit) return false;
      if (pressureMethod === "jacobi") {
        [pressure, nextPressure] = [nextPressure, pressure];
      } else {
        // Lexicographic GS/SOR uses neighbors as soon as their values are updated.
        for (let c = 0; c < count; c++) {
          const gaussSeidel = (neighborSum(pressure, c) - hSquared * source[c]) / 4;
          pressure[c] += pressureRelaxation * (gaussSeidel - pressure[c]);
        }
        removeMean(pressure);
      }
      pressureSweeps++;
    }
    return false;
  }

  function advect(q, c) {
    // Identical to the lesson's backward differences while both velocities are positive.
    // Follow the velocity sign if an unstable solution develops reversed flow.
    const deltaX = u[c] >= 0 ? q[c] - q[west[c]] : q[east[c]] - q[c];
    const deltaY = v[c] >= 0 ? q[c] - q[south[c]] : q[north[c]] - q[c];
    return (u[c] * deltaX + v[c] * deltaY) / h;
  }

  function step() {
    if (!solvePressure()) return false;
    for (let c = 0; c < count; c++) {
      nextU[c] = u[c] + dt * (-advect(u, c) - centeredX(pressure, c) / density + viscosity * laplacian(u, c));
      nextV[c] = v[c] + dt * (-advect(v, c) - centeredY(pressure, c) / density + viscosity * laplacian(v, c));
    }
    u.set(nextU);
    v.set(nextV);
    return true;
  }

  function snapshot(reference) {
    const divergence = field();
    let maxDivergence = 0;
    let squaredError = 0;
    for (let c = 0; c < count; c++) {
      const x = (c % size + 0.5) * h;
      const y = (Math.floor(c / size) + 0.5) * h;
      divergence[c] = centeredX(u, c) + centeredY(v, c);
      maxDivergence = Math.max(maxDivergence, Math.abs(divergence[c]));
      squaredError += (u[c] - reference.u(x, y)) ** 2 + (v[c] - reference.v(x, y)) ** 2;
    }
    return {
      u: u.slice(), v: v.slice(), divergence, maxDivergence,
      velocityRmsError: Math.sqrt(squaredError / count),
      predictorSweeps: 0, pressureSweeps, pressureResidual, rhsMean,
      ...flowMetrics(u, v, settings)
    };
  }
  return { step, snapshot, get pressureSweeps() { return pressureSweeps; } };
}

function macSnapshot(state, reference, settings, { east, north }) {
  const { size, h } = settings;
  const count = size * size;
  const u = new Float64Array(count);
  const v = new Float64Array(count);
  let squaredError = 0;
  for (let c = 0; c < count; c++) {
    const x = (c % size) * h;
    const y = Math.floor(c / size) * h;
    squaredError += (state.u[c] - reference.u(x, y + h / 2)) ** 2
      + (state.v[c] - reference.v(x + h / 2, y)) ** 2;
    // Plots use cell-center averages; errors and growth metrics use native face values.
    u[c] = (state.u[c] + state.u[east[c]]) / 2;
    v[c] = (state.v[c] + state.v[north[c]]) / 2;
  }
  return {
    u, v, divergence: state.divergence.slice(), maxDivergence: state.maxDivergence,
    maxStarDivergence: state.maxStarDivergence,
    velocityRmsError: Math.sqrt(squaredError / count),
    predictorSweeps: state.predictorSweeps, pressureSweeps: state.pressureSweeps,
    pressureResidual: state.pressureResidual,
    predictorResidual: state.predictorResidual,
    ...flowMetrics(state.u, state.v, settings)
  };
}

function newOutcome(snapshot) {
  return {
    status: "bounded", reason: "计算窗口内未达到扰动增长阈值。", completed: false,
    stopTime: null, lastValidTime: 0,
    maxGrowth: snapshot.perturbationRms > 1e-12 ? 1 : null,
    endError: null, endDivergence: null, lastError: snapshot.velocityRmsError,
    lastDivergence: snapshot.maxDivergence,
    initialCfl: snapshot.cfl, peakCfl: snapshot.cfl,
    initialAdvectionDiffusion: snapshot.advectionDiffusion,
    peakAdvectionDiffusion: snapshot.advectionDiffusion,
    totalPressureSweeps: 0, totalPredictorSweeps: 0
  };
}

function acceptSnapshot(snapshot, outcome, initialRms, time) {
  const finite = [snapshot.perturbationRms, snapshot.velocityRmsError, snapshot.maxDivergence,
    snapshot.cfl, snapshot.advectionDiffusion].every(Number.isFinite);
  if (!finite) {
    outcome.status = "diverged";
    outcome.reason = "速度或诊断量出现非有限值，已停止该方法。";
    outcome.stopTime = time;
    return null;
  }
  snapshot.growthFactor = initialRms > 1e-12 ? snapshot.perturbationRms / initialRms : null;
  snapshot.status = snapshot.growthFactor !== null && snapshot.growthFactor >= GROWTH_WARNING ? "growth" : "bounded";
  outcome.lastValidTime = time;
  outcome.lastError = snapshot.velocityRmsError;
  outcome.lastDivergence = snapshot.maxDivergence;
  outcome.peakCfl = Math.max(outcome.peakCfl, snapshot.cfl);
  outcome.peakAdvectionDiffusion = Math.max(outcome.peakAdvectionDiffusion, snapshot.advectionDiffusion);
  if (snapshot.growthFactor !== null) outcome.maxGrowth = Math.max(outcome.maxGrowth, snapshot.growthFactor);
  if (outcome.maxGrowth >= GROWTH_WARNING) {
    outcome.status = "growth";
    outcome.reason = `扰动 RMS 曾达到初始值的 ${GROWTH_WARNING} 倍，出现明显数值增长。`;
  }
  if (snapshot.growthFactor >= GROWTH_STOP) {
    snapshot.status = "diverged";
    outcome.status = "diverged";
    outcome.reason = `扰动 RMS 达到初始值的 ${GROWTH_STOP} 倍，已停止该方法。`;
    outcome.stopTime = time;
  }
  return snapshot;
}

export function runComparison(presetId = "taylor-green", { dt: requestedDt = 0.1, finalTime = COMPARISON_END_TIME, ...requestedIterations } = {}) {
  const iterationOptions = normalizeIterationOptions(requestedIterations);
  const dt = normalizeTimeStep(requestedDt);
  const steps = Math.round(finalTime / dt);
  if (!Number.isFinite(finalTime) || steps < 1 || Math.abs(steps * dt - finalTime) > 1e-10) {
    throw new RangeError("比较终点必须是时间步长的正整数倍。");
  }
  const preset = getInitialCondition(presetId);
  const { driftX, driftY, amplitude, waveNumber } = preset;
  const initial = preset.velocity(0);
  const mac = createMacSolver({
    dt, steps, ...iterationOptions,
    initialVelocity: (i, j, h) => ({
      u: initial.u(i * h, (j + 0.5) * h),
      v: initial.v((i + 0.5) * h, j * h)
    })
  });
  const { size, h, density, viscosity, pressureTolerance, predictorTolerance, pressureRelaxation } = mac;
  const settings = {
    size, h, dt, steps, finalTime, density, viscosity, pressureTolerance, predictorTolerance,
    pressureRelaxation, driftX, driftY, amplitude, waveNumber,
    presetId: preset.id, presetLabel: preset.label,
    growthWarning: GROWTH_WARNING, growthStop: GROWTH_STOP,
    ...iterationOptions
  };
  const neighbors = periodicNeighbors(size);
  const explicit = createExplicitSolver(settings, neighbors, initial);
  const first = { layer: 0, time: 0, explicit: explicit.snapshot(initial), mac: macSnapshot(mac.state, initial, settings, neighbors) };
  const outcomes = { explicit: newOutcome(first.explicit), mac: newOutcome(first.mac) };
  const initialRms = { explicit: first.explicit.perturbationRms, mac: first.mac.perturbationRms };
  for (const method of ["explicit", "mac"]) acceptSnapshot(first[method], outcomes[method], initialRms[method], 0);
  const frames = [first];

  for (let layer = 1; layer <= steps; layer++) {
    const time = layer === steps ? finalTime : layer * dt;
    const reference = preset.velocity(time, viscosity);
    const frame = { layer, time, explicit: null, mac: null };
    if (outcomes.explicit.stopTime === null) {
      const success = explicit.step();
      outcomes.explicit.totalPressureSweeps += explicit.pressureSweeps;
      if (success) {
        frame.explicit = acceptSnapshot(explicit.snapshot(reference), outcomes.explicit, initialRms.explicit, time);
      } else {
        Object.assign(outcomes.explicit, {
          status: "pressure-failed", reason: "压力迭代未在轮数上限内收敛，未接受该时间步。", stopTime: time
        });
      }
    }
    if (outcomes.mac.stopTime === null) {
      while (mac.state.layer < layer && mac.state.stage !== "failed") mac.step(100);
      outcomes.mac.totalPressureSweeps += mac.state.pressureSweeps;
      outcomes.mac.totalPredictorSweeps += mac.state.predictorSweeps;
      if (mac.state.stage === "failed") {
        const predictor = mac.state.failedStage === "predictor";
        Object.assign(outcomes.mac, {
          status: predictor ? "predictor-failed" : "pressure-failed",
          reason: predictor ? "隐式预测迭代未收敛，未接受该时间步。" : "压力迭代未收敛，未接受该时间步。",
          stopTime: time
        });
      } else {
        frame.mac = acceptSnapshot(macSnapshot(mac.state, reference, settings, neighbors), outcomes.mac, initialRms.mac, time);
      }
    }
    frames.push(frame);
  }
  for (const method of ["explicit", "mac"]) {
    const outcome = outcomes[method];
    outcome.completed = outcome.stopTime === null;
    if (outcome.completed) {
      outcome.endError = frames.at(-1)[method].velocityRmsError;
      outcome.endDivergence = frames.at(-1)[method].maxDivergence;
    }
  }
  return { settings, frames, outcomes };
}

export function runStabilitySweep(presetId = "taylor-green", iterationOptions = {}) {
  const normalized = normalizeIterationOptions(iterationOptions);
  return DT_OPTIONS.map(dt => {
    const { settings, outcomes } = runComparison(presetId, { ...normalized, dt });
    return { dt, steps: settings.steps, finalTime: settings.finalTime, ...outcomes };
  });
}
