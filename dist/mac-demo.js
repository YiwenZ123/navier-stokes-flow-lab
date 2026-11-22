import { createMacSolver } from "./mac-solver.js";
import { mountConditionPicker, selectedInitialCondition } from "./condition-picker.js";
import { DT_OPTIONS, DEMO_END_TIME, normalizeTimeStep } from "./time-step-options.js";
import { spatialGridSummary } from "./spatial-grid.js";
import { readIterationOptions, writeIterationQuery, iterationLabel, mountIterationControls } from "./iteration-controls.js";
import { mountParameterSidebar } from "./parameter-sidebar.js?v=edb979ef0040";
import { mountIterationStoryboard } from "./iteration-storyboard.js?v=67320c82aa24";

const root = document.querySelector("#mac-demo");
let condition = selectedInitialCondition();
let timeStep = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
let iterationOptions = readIterationOptions();
let iterationControls;
let solver = solverForCondition(condition);

function solverForCondition(preset) {
  const velocity = preset.velocity(0, 0.05);
  return createMacSolver({
    ...iterationOptions,
    dt: timeStep, steps: Math.round(DEMO_END_TIME / timeStep),
    initialVelocity: (i, j, h) => ({
      u: velocity.u(i * h, (j + 0.5) * h),
      v: velocity.v((i + 0.5) * h, j * h)
    })
  });
}

root.innerHTML = `
  <header class="mac-header">
    <h2 id="mac-animation-title">隐式 MAC 投影法</h2>
    <div class="mac-controls" role="group" aria-label="演示控制">
      <button type="button" class="mac-play" data-mac="play">播放</button>
      <button type="button" data-mac="step">单步</button>
    </div>
  </header>
  <div id="mac-initial" class="mac-initial"></div>
  <div class="mac-spatial" aria-label="空间网格">
    <p>${spatialGridSummary()}</p>
    <details class="parameter-help"><summary aria-label="空间网格说明">说明</summary><div class="parameter-help-body">
      <p class="mac-spatial-note">每方向 ${solver.size} 个空间间隔；MAC 为 ${solver.size} × ${solver.size} 个压力单元，速度位于单元面。</p>
    </div></details>
  </div>
  <div class="mac-timestep">
    <label for="mac-time-step">时间步长 Δt</label>
    <select id="mac-time-step" aria-describedby="mac-step-note"></select>
    <span id="mac-step-info" aria-live="polite"></span>
    <details class="parameter-help"><summary aria-label="时间步长说明">说明</summary><div class="parameter-help-body">
      <p class="mac-step-note" id="mac-step-note">固定终点 T = 1.20。调节后重算；长时间稳定性比较请打开<a id="mac-stability-link" href="./compare.html">「结果对比」</a>。</p>
    </div></details>
  </div>
  <div id="mac-iterations"></div>
  <div class="mac-arrow-settings">
    <label for="mac-arrow-style">箭头样式</label>
    <select id="mac-arrow-style">
      <option value="faces">MAC 面速度</option>
      <option value="combined">合速度（显式样式）</option>
    </select>
  </div>
  <div class="mac-demo-layout">
    <div class="mac-storyboard"></div>
    <figure class="mac-figure">
      <figcaption class="mac-field-caption"><strong data-mac="field"></strong><span class="mac-caption-note">箭头 · <span data-mac="velocity"></span></span></figcaption>
      <canvas class="mac-plot" role="img"></canvas>
      <div class="mac-pressure-scale" aria-label="底色数值范围">
        <span data-mac="pressure-low"></span><i aria-hidden="true"></i><span data-mac="pressure-high"></span>
      </div>
    </figure>
    <div class="mac-panel">
      <div class="mac-time"><strong data-mac="layer"></strong><span data-mac="time"></span></div>
      <progress class="mac-progress" data-mac="progress" max="12" value="0" aria-label="已推进的物理时间步"></progress>
      <dl class="mac-metrics">
        <div><dt>预测迭代 / 最大残差</dt><dd data-mac="predictor"></dd></div>
        <div><dt>压力迭代 / 最大残差</dt><dd data-mac="pressure"></dd></div>
        <div><dt>投影前最大离散散度</dt><dd data-mac="before"></dd></div>
        <div><dt>投影后最大离散散度</dt><dd data-mac="after"></dd></div>
      </dl>
      <p class="mac-status" data-mac="status" role="status"></p>
      <p class="mac-face-legend">
        <span data-mac="face-u">→ 竖直面 u</span><span data-mac="face-v">↑ 水平面 v</span>
        <span data-mac="combined-legend" hidden>↗ 单元中心合速度 · 由相邻面速度平均</span>
        <span>⊙ 单元中心 p*</span>
      </p>
      <button type="button" class="mac-reset" data-mac="reset">重置动画</button>
    </div>
  </div>
`;

const elements = Object.fromEntries(
  Array.from(root.querySelectorAll("[data-mac]"), element => [element.dataset.mac, element])
);
const storyboard = mountIterationStoryboard(root.querySelector(".mac-storyboard"), { mode: "mac" });
const canvas = root.querySelector("canvas");
const context = canvas.getContext("2d");
const arrowStyleSelect = root.querySelector("#mac-arrow-style");
const colorScheme = matchMedia("(prefers-color-scheme: dark)");
const size = solver.size;
let referenceVelocity = Math.max(maxMagnitude(solver.state.u), maxMagnitude(solver.state.v), 1e-12);
const phaseIndex = { predictor: 0, predicted: 0, pressure: 2, pressurized: 2, projected: 3, complete: 3 };
let playing = false;
let timer;

function maxMagnitude(values) {
  let peak = 0;
  for (const value of values) peak = Math.max(peak, Math.abs(value));
  return peak;
}

function format(value) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return value.toExponential(2).replaceAll("-", "−");
}

function iterationText(sweeps, residual) {
  return Number.isFinite(residual) ? `${sweeps} / ${format(residual)}` : "—";
}

function write(name, value) {
  if (elements[name].textContent !== value) elements[name].textContent = value;
}

function describe(state) {
  switch (state.stage) {
    case "initial": return "从第 0 层速度开始隐式预测。";
    case "predictor": return "在当前时间层内迭代预测速度。";
    case "predicted": return "预测速度已收敛，可计算压力方程右端。";
    case "pressure":
      return state.pressureSweeps === 0
        ? "已用预测速度的离散散度构造压力方程右端。"
        : "在单元中心迭代压力，预测面速度保持固定。";
    case "pressurized": return "压力已收敛，可用压力梯度校正面速度。";
    case "projected": return `面速度已校正，进入第 ${state.layer} 层。`;
    case "complete": return `完成 ${solver.steps} 个时间步。`;
    case "failed": return state.failedStage === "predictor"
      ? "隐式预测迭代未收敛，已暂停；这与时间推进发散不是同一判据。"
      : "压力迭代未收敛，已暂停，未接受该时间步。";
  }
}

function arrow(x, y, value, horizontal, cell) {
  const length = Math.min(Math.abs(value) / referenceVelocity, 1.2) * cell * 0.62;
  if (length < 1) return;
  const direction = Math.sign(value) * (horizontal ? 1 : -1);
  const half = direction * length / 2;
  const head = Math.min(length * 0.31, 3.2);
  const tipX = x + (horizontal ? half : 0);
  const tipY = y + (horizontal ? 0 : half);
  const wingX = tipX - (horizontal ? direction * head : 0);
  const wingY = tipY - (horizontal ? 0 : direction * head);
  context.moveTo(x - (horizontal ? half : 0), y - (horizontal ? 0 : half));
  context.lineTo(tipX, tipY);
  context.moveTo(wingX + (horizontal ? 0 : head * 0.62), wingY + (horizontal ? head * 0.62 : 0));
  context.lineTo(tipX, tipY);
  context.lineTo(wingX - (horizontal ? 0 : head * 0.62), wingY - (horizontal ? head * 0.62 : 0));
}

function drawCombinedArrows(u, v, left, bottom, cell) {
  context.beginPath();
  // Sample every other cell, as in the explicit animation.
  for (let j = 1; j < size; j += 2) {
    for (let i = 1; i < size; i += 2) {
      const index = j * size + i;
      const east = j * size + (i + 1) % size;
      const north = ((j + 1) % size) * size + i;
      const centerU = (u[index] + u[east]) / 2;
      const centerV = (v[index] + v[north]) / 2;
      const speed = Math.hypot(centerU, centerV);
      if (speed === 0) continue;
      const scale = 0.9 * cell / Math.max(referenceVelocity, speed / 1.2);
      const dx = centerU * scale;
      const dy = -centerV * scale;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const x = left + (i + 0.5) * cell;
      const y = bottom - (j + 0.5) * cell;
      const tipX = x + dx / 2;
      const tipY = y + dy / 2;
      const wing = Math.min(4.5, length * 0.33) / length;
      context.moveTo(x - dx / 2, y - dy / 2);
      context.lineTo(tipX, tipY);
      context.moveTo(tipX - wing * (dx + 0.62 * dy), tipY - wing * (dy - 0.62 * dx));
      context.lineTo(tipX, tipY);
      context.lineTo(tipX - wing * (dx - 0.62 * dy), tipY - wing * (dy + 0.62 * dx));
    }
  }
  context.stroke();
}

function drawPlot(pressure, u, v, peak, showCombined) {
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const pixelRatio = Math.min(devicePixelRatio, 2);
  const bitmapWidth = Math.round(width * pixelRatio);
  const bitmapHeight = Math.round(height * pixelRatio);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }

  const styles = getComputedStyle(root);
  const color = name => styles.getPropertyValue(`--mac-${name}`).trim();
  const negative = color("negative");
  const positive = color("positive");
  const side = Math.min(width, height) - 32;
  const cell = side / size;
  const left = 19;
  const top = 9;
  const bottom = top + side;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = color("background");
  context.fillRect(left, top, side, side);
  if (peak > 0) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const value = pressure[j * size + i];
        context.globalAlpha = 0.72 * Math.abs(value) / peak;
        context.fillStyle = value < 0 ? negative : positive;
        context.fillRect(left + i * cell, bottom - (j + 1) * cell, cell, cell);
      }
    }
    context.globalAlpha = 1;
  }

  context.lineWidth = 0.7;
  context.strokeStyle = color("grid");
  context.beginPath();
  for (let line = 0; line <= size; line++) {
    const x = left + line * cell;
    const y = bottom - line * cell;
    context.moveTo(x, bottom);
    context.lineTo(x, bottom - size * cell);
    context.moveTo(left, y);
    context.lineTo(left + size * cell, y);
  }
  context.stroke();

  context.fillStyle = color("dot");
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      context.beginPath();
      context.arc(left + (i + 0.5) * cell, bottom - (j + 0.5) * cell, 1.08, 0, 2 * Math.PI);
      context.fill();
    }
  }

  context.lineCap = "round";
  context.lineWidth = 1.25;
  if (showCombined) {
    context.strokeStyle = color("foreground");
    drawCombinedArrows(u, v, left, bottom, cell);
  } else {
    context.strokeStyle = color("u");
    context.beginPath();
    for (let j = 0; j < size; j++) {
      for (let i = 0; i <= size; i++) {
        arrow(left + i * cell, bottom - (j + 0.5) * cell, u[j * size + i % size], true, cell);
      }
    }
    context.stroke();
    context.strokeStyle = color("v");
    context.beginPath();
    for (let j = 0; j <= size; j++) {
      for (let i = 0; i < size; i++) {
        arrow(left + (i + 0.5) * cell, bottom - j * cell, v[(j % size) * size + i], false, cell);
      }
    }
    context.stroke();
  }

  const center = Math.floor(size / 2);
  const focusX = left + center * cell;
  const focusY = bottom - (center + 1) * cell;
  context.strokeStyle = color("focus");
  context.lineWidth = 1.45;
  context.strokeRect(focusX + 2, focusY + 2, cell - 4, cell - 4);
  context.beginPath();
  context.arc(focusX + cell / 2, focusY + cell / 2, 2.6, 0, 2 * Math.PI);
  context.stroke();
  context.fillStyle = color("focus");
  context.font = "12px system-ui, sans-serif";
  context.fillText("y", 5, top + 9);
  context.fillText("x", left + side - 6, bottom + 15);
}

function isFinished(state) {
  return state.stage === "complete" || state.stage === "failed";
}

function render() {
  const state = solver.state;
  const hasProjection = state.stage === "projected" || state.stage === "complete";
  const displayStage = state.stage === "failed" ? state.failedStage : state.stage;
  const usePrediction = ["predictor", "predicted", "pressure", "pressurized"].includes(displayStage);
  const currentPhase = displayStage === "pressure" && state.pressureSweeps === 0 ? 1 : phaseIndex[displayStage];
  const peak = maxMagnitude(state.pressure);
  const showCombined = arrowStyleSelect.value === "combined";
  const velocityStage = usePrediction ? "预测" : hasProjection ? "校正" : "初始";

  write("field", "投影压力 p*");
  write("velocity", `${velocityStage}${showCombined ? "合速度" : "面速度"}`);
  elements["face-u"].hidden = showCombined;
  elements["face-v"].hidden = showCombined;
  elements["combined-legend"].hidden = !showCombined;
  const arrowDescription = showCombined
    ? "单元中心的合速度箭头由相邻面速度平均得到。"
    : "竖直面上的横箭头表示 u，水平面上的纵箭头表示 v。";
  canvas.setAttribute("aria-label", `MAC 交错网格。方格的着色表示单元中心的投影压力 p 星号。${arrowDescription}`);
  write("pressure-low", format(-peak));
  write("pressure-high", format(peak));
  write("layer", `时间层 n = ${state.layer} / ${solver.steps}`);
  write("time", `t = ${Number(state.time.toFixed(3))}`);
  elements.progress.max = solver.steps;
  elements.progress.value = state.layer;
  write("status", describe(state));
  write("predictor", iterationText(state.predictorSweeps, state.predictorResidual));
  write("pressure", iterationText(state.pressureSweeps, state.pressureResidual));
  write("before", format(state.maxStarDivergence));
  write("after", format(hasProjection ? state.maxDivergence : null));
  write("play", playing ? "暂停" : isFinished(state) ? "重播" : "播放");
  elements.step.disabled = playing || isFinished(state);
  elements.reset.disabled = state.stage === "initial" && !playing;

  storyboard.update({
    phase: currentPhase ?? -1,
    layer: state.layer,
    time: state.time,
    iteration: state.pressureSweeps,
    residual: state.pressureResidual,
    tolerance: solver.pressureTolerance,
    method: iterationOptions.pressureMethod === "jacobi" ? "Weighted Jacobi" : iterationLabel(iterationOptions.pressureMethod),
    playing,
    failed: state.stage === "failed",
    complete: state.stage === "complete",
    predictorIterations: state.predictorSweeps,
    predictorResidual: state.predictorResidual
  });
  drawPlot(state.pressure, usePrediction ? state.uStar : state.u, usePrediction ? state.vStar : state.v, peak, showCombined);
}

function pause() {
  clearTimeout(timer);
  playing = false;
}

function playNext() {
  const prior = solver.state.stage;
  solver.step(prior === "pressure" ? 18 : 3);
  const current = solver.state;
  if (isFinished(current)) pause();
  render();
  if (playing) timer = setTimeout(playNext, prior === current.stage ? 105 : 400);
}

elements.play.addEventListener("click", () => {
  if (playing) {
    pause();
    render();
    return;
  }
  if (isFinished(solver.state)) solver.reset();
  playing = true;
  playNext();
});

elements.step.addEventListener("click", () => {
  solver.step();
  render();
});

elements.reset.addEventListener("click", () => {
  pause();
  solver.reset();
  render();
});

const timeStepSelect = document.querySelector("#mac-time-step");
for (const value of DT_OPTIONS) {
  const option = document.createElement("option");
  option.value = String(value);
  option.textContent = value === 0.1 ? "0.10（默认）" : value < 0.1 ? String(value) : value.toFixed(2);
  timeStepSelect.append(option);
}

function updateTimeStepInfo() {
  timeStepSelect.value = String(timeStep);
  document.querySelector("#mac-step-info").textContent =
    `${solver.steps} 步 · T = ${DEMO_END_TIME.toFixed(2)}`;
  const comparison = new URL("./compare.html", location.href);
  comparison.searchParams.set("initial", condition.id);
  comparison.searchParams.set("dt", String(timeStep));
  writeIterationQuery(comparison, iterationOptions);
  document.querySelector("#mac-stability-link").href = comparison.pathname + comparison.search;
  for (const link of document.querySelectorAll(".method-nav a")) {
    const target = new URL(link.href);
    if (!/\/(mac|compare)(\.html)?$/.test(target.pathname)) continue;
    target.searchParams.set("dt", String(timeStep));
    target.searchParams.set("initial", condition.id);
    writeIterationQuery(target, iterationOptions);
    link.href = target.pathname + target.search + target.hash;
  }
}

function resetForSettings() {
  pause();
  solver = solverForCondition(condition);
  referenceVelocity = Math.max(maxMagnitude(solver.state.u), maxMagnitude(solver.state.v), 1e-12);
  updateTimeStepInfo();
  iterationControls?.render(iterationOptions);
  render();
}

iterationControls = mountIterationControls(document.querySelector("#mac-iterations"), iterationOptions, next => {
  iterationOptions = next;
  const url = new URL(location.href);
  writeIterationQuery(url, next);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  resetForSettings();
});

mountConditionPicker(document.querySelector("#mac-initial"), condition, (preset, { source } = {}) => {
  if (source === "history") {
    iterationOptions = readIterationOptions();
    timeStep = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
  }
  condition = preset;
  resetForSettings();
}, { layout: "animation" });

timeStepSelect.addEventListener("change", () => {
  timeStep = normalizeTimeStep(timeStepSelect.value);
  const url = new URL(location.href);
  url.searchParams.set("dt", String(timeStep));
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  resetForSettings();
});
window.addEventListener("popstate", () => {
  const nextStep = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
  const nextIteration = readIterationOptions();
  if (nextStep === timeStep && JSON.stringify(nextIteration) === JSON.stringify(iterationOptions)) return;
  timeStep = nextStep;
  iterationOptions = nextIteration;
  resetForSettings();
});
updateTimeStepInfo();

arrowStyleSelect.addEventListener("change", render);
root.classList.add("mac-sidebar-layout");
mountParameterSidebar(root, {
  key: "mac",
  controls: [
    root.querySelector("#mac-initial"),
    root.querySelector(".mac-spatial"),
    root.querySelector(".mac-timestep"),
    root.querySelector("#mac-iterations"),
    root.querySelector(".mac-arrow-settings")
  ],
  content: [root.querySelector(".mac-demo-layout")]
});
new ResizeObserver(render).observe(canvas);
colorScheme.addEventListener("change", render);
render();
