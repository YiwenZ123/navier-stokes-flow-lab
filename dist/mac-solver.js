import { SPATIAL_GRID } from "./spatial-grid.js";
import { normalizeIterationOptions } from "./iteration-options.js";

export function createMacSolver({ initialVelocity, dt = 0.1, steps = 12, ...requestedIterations } = {}) {
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("时间步长必须为正的有限数值。");
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError("时间步数必须为正整数。");
  const size = SPATIAL_GRID.intervals;
  const h = SPATIAL_GRID.h;
  const density = 1;
  const viscosity = 0.05;
  const predictorTolerance = 1e-7;
  const pressureTolerance = 1e-4;
  const predictorSweepLimit = 300;
  const pressureSweepLimit = 3000;
  const iterationOptions = normalizeIterationOptions(requestedIterations);
  const { pressureMethod, pressureOmega, predictorMethod, predictorOmega } = iterationOptions;
  const pressureRelaxation = pressureMethod === "jacobi" ? 2 / 3 : pressureMethod === "sor" ? pressureOmega : 1;
  const predictorRelaxation = predictorMethod === "sor" ? predictorOmega : 1;

  const cellCount = size * size;
  const inverseH = 1 / h;
  const hSquared = h * h;
  const diffusionWeight = dt * viscosity / hSquared;
  const advectionWeight = dt * inverseH;
  const field = () => new Float64Array(cellCount);
  const u = field();
  const v = field();
  const starDivergence = field();
  const divergence = field();
  const poissonRhs = field();
  let uStar = field();
  let vStar = field();
  let nextU = field();
  let nextV = field();
  let pressure = field();
  let nextPressure = field();

  // A cell index refers to its center pressure, its west-face u and its south-face v.
  const west = new Int32Array(cellCount);
  const east = new Int32Array(cellCount);
  const south = new Int32Array(cellCount);
  const north = new Int32Array(cellCount);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cell = j * size + i;
      west[cell] = j * size + (i + size - 1) % size;
      east[cell] = j * size + (i + 1) % size;
      south[cell] = ((j + size - 1) % size) * size + i;
      north[cell] = ((j + 1) % size) * size + i;
    }
  }

  let stage;
  let layer;
  let predictorSweeps;
  let pressureSweeps;
  let predictorResidual;
  let pressureResidual;
  let maxStarDivergence;
  let maxDivergence;
  let failedStage;

  function computeDivergence(horizontal, vertical, result) {
    let maximum = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      result[cell] = (horizontal[east[cell]] - horizontal[cell]
        + vertical[north[cell]] - vertical[cell]) * inverseH;
      maximum = Math.max(maximum, Math.abs(result[cell]));
    }
    return maximum;
  }

  function initializeVelocity() {
    if (initialVelocity) {
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const sample = initialVelocity(i, j, h);
          const cell = j * size + i;
          u[cell] = sample.u;
          v[cell] = sample.v;
        }
      }
      return;
    }

    const streamfunction = field();
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        streamfunction[j * size + i] = 0.55 * Math.sin(i * h) * Math.sin(j * h);
      }
    }
    // Taking the discrete curl on the staggered grid makes the initial divergence vanish.
    for (let cell = 0; cell < cellCount; cell++) {
      u[cell] = 0.48 + (streamfunction[north[cell]] - streamfunction[cell]) * inverseH;
      v[cell] = 0.21 - (streamfunction[east[cell]] - streamfunction[cell]) * inverseH;
    }
  }

  function reset() {
    initializeVelocity();
    uStar.set(u);
    vStar.set(v);
    pressure.fill(0);
    poissonRhs.fill(0);
    maxDivergence = computeDivergence(u, v, divergence);
    starDivergence.set(divergence);
    layer = 0;
    predictorSweeps = 0;
    pressureSweeps = 0;
    predictorResidual = null;
    pressureResidual = null;
    maxStarDivergence = null;
    failedStage = null;
    stage = "initial";
  }

  function momentumRow(cell, transported, previousTime, candidate, advectingU, advectingV) {
    // Freeze these local upwind coefficients for this row's update.
    const weightWest = diffusionWeight + advectionWeight * Math.max(advectingU, 0);
    const weightEast = diffusionWeight + advectionWeight * Math.max(-advectingU, 0);
    const weightSouth = diffusionWeight + advectionWeight * Math.max(advectingV, 0);
    const weightNorth = diffusionWeight + advectionWeight * Math.max(-advectingV, 0);
    const diagonal = 1 + weightWest + weightEast + weightSouth + weightNorth;
    const numerator = previousTime[cell]
      + weightWest * transported[west[cell]] + weightEast * transported[east[cell]]
      + weightSouth * transported[south[cell]] + weightNorth * transported[north[cell]];
    candidate[cell] = numerator / diagonal;
    return Math.abs(diagonal * transported[cell] - numerator);
  }

  function evaluatePredictor() {
    let maximum = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      const transverseV = (vStar[cell] + vStar[west[cell]]
        + vStar[north[cell]] + vStar[north[west[cell]]]) / 4;
      const transverseU = (uStar[cell] + uStar[south[cell]]
        + uStar[east[cell]] + uStar[east[south[cell]]]) / 4;
      const residualU = momentumRow(cell, uStar, u, nextU, uStar[cell], transverseV);
      const residualV = momentumRow(cell, vStar, v, nextV, transverseU, vStar[cell]);
      maximum = Math.max(maximum, residualU, residualV);
    }
    predictorResidual = maximum;
  }

  function beginPredictor() {
    uStar.set(u);
    vStar.set(v);
    starDivergence.set(divergence);
    pressure.fill(0);
    poissonRhs.fill(0);
    predictorSweeps = 0;
    pressureSweeps = 0;
    pressureResidual = null;
    maxStarDivergence = null;
    evaluatePredictor();
    stage = "predictor";
  }

  function iteratePredictor(sweeps) {
    for (let sweep = 0; sweep < sweeps && predictorSweeps < predictorSweepLimit
      && Number.isFinite(predictorResidual) && predictorResidual > predictorTolerance; sweep++) {
      if (predictorMethod === "jacobi") {
        // The candidates and both advecting components use the prior complete iterate.
        [uStar, nextU] = [nextU, uStar];
        [vStar, nextV] = [nextV, vStar];
      } else {
        // Nonlinear GS/SOR: visit cells in row-major order, updating u then v.
        // Each row uses the latest available face velocities, including all
        // changes earlier in this sweep. Coefficients are refreshed per row;
        // the convergence check below recomputes the full nonlinear residual.
        for (let cell = 0; cell < cellCount; cell++) {
          const transverseV = (vStar[cell] + vStar[west[cell]]
            + vStar[north[cell]] + vStar[north[west[cell]]]) / 4;
          momentumRow(cell, uStar, u, nextU, uStar[cell], transverseV);
          uStar[cell] += predictorRelaxation * (nextU[cell] - uStar[cell]);
          const transverseU = (uStar[cell] + uStar[south[cell]]
            + uStar[east[cell]] + uStar[east[south[cell]]]) / 4;
          momentumRow(cell, vStar, v, nextV, transverseU, vStar[cell]);
          vStar[cell] += predictorRelaxation * (nextV[cell] - vStar[cell]);
        }
      }
      predictorSweeps++;
      evaluatePredictor();
    }
    maxStarDivergence = computeDivergence(uStar, vStar, starDivergence);
    if (predictorResidual <= predictorTolerance) {
      stage = "predicted";
    } else if (!Number.isFinite(predictorResidual) || predictorSweeps === predictorSweepLimit) {
      failedStage = "predictor";
      stage = "failed";
    }
  }

  function removeMean(values) {
    let mean = 0;
    for (const value of values) mean += value / cellCount;
    for (let cell = 0; cell < cellCount; cell++) values[cell] -= mean;
  }

  function evaluatePressure() {
    let maximum = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      const neighborSum = pressure[west[cell]] + pressure[east[cell]]
        + pressure[south[cell]] + pressure[north[cell]];
      const jacobi = (neighborSum - hSquared * poissonRhs[cell]) / 4;
      nextPressure[cell] = pressure[cell] + pressureRelaxation * (jacobi - pressure[cell]);
      const residual = (neighborSum - 4 * pressure[cell]) / hSquared - poissonRhs[cell];
      maximum = Math.max(maximum, Math.abs(residual));
    }
    pressureResidual = maximum;
  }

  function beginPressure() {
    for (let cell = 0; cell < cellCount; cell++) {
      poissonRhs[cell] = density / dt * starDivergence[cell];
    }
    // Periodic fluxes cancel in the sum; remove the roundoff remainder.
    removeMean(poissonRhs);
    evaluatePressure();
    stage = "pressure";
  }

  function iteratePressure(sweeps) {
    for (let sweep = 0; sweep < sweeps && pressureSweeps < pressureSweepLimit
      && Number.isFinite(pressureResidual) && pressureResidual > pressureTolerance; sweep++) {
      if (pressureMethod === "jacobi") {
        [pressure, nextPressure] = [nextPressure, pressure];
      } else {
        // Fixed row-major ordering: updated neighbors are used immediately.
        for (let cell = 0; cell < cellCount; cell++) {
          const neighborSum = pressure[west[cell]] + pressure[east[cell]]
            + pressure[south[cell]] + pressure[north[cell]];
          const gaussSeidel = (neighborSum - hSquared * poissonRhs[cell]) / 4;
          pressure[cell] += pressureRelaxation * (gaussSeidel - pressure[cell]);
        }
        removeMean(pressure);
      }
      pressureSweeps++;
      // Evaluate on the complete updated field, never on a mixture of row residuals.
      evaluatePressure();
    }
    if (pressureResidual <= pressureTolerance) {
      removeMean(pressure);
      evaluatePressure();
      stage = "pressurized";
    } else if (!Number.isFinite(pressureResidual) || pressureSweeps === pressureSweepLimit) {
      failedStage = "pressure";
      stage = "failed";
    }
  }

  function projectVelocity() {
    const correctionWeight = dt / density * inverseH;
    for (let cell = 0; cell < cellCount; cell++) {
      u[cell] = uStar[cell] - correctionWeight * (pressure[cell] - pressure[west[cell]]);
      v[cell] = vStar[cell] - correctionWeight * (pressure[cell] - pressure[south[cell]]);
    }
    maxDivergence = computeDivergence(u, v, divergence);
    layer++;
    stage = layer === steps ? "complete" : "projected";
  }

  function step(sweeps = 1) {
    switch (stage) {
      case "initial":
      case "projected":
        beginPredictor();
        break;
      case "predictor":
        iteratePredictor(sweeps);
        break;
      case "predicted":
        beginPressure();
        break;
      case "pressure":
        iteratePressure(sweeps);
        break;
      case "pressurized":
        projectVelocity();
        break;
    }
  }

  reset();
  return {
    size, h, dt, density, viscosity, steps, predictorTolerance, pressureTolerance, pressureRelaxation, step, reset,
    ...iterationOptions, predictorRelaxation,
    get state() {
      return {
        stage, layer, time: layer * dt, predictorSweeps, pressureSweeps,
        predictorResidual, pressureResidual, maxStarDivergence, maxDivergence, failedStage,
        u, v, uStar, vStar, pressure, starDivergence, divergence, poissonRhs
      };
    }
  };
}
