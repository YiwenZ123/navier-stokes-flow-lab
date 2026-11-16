import { createWaveSolver } from "./wave-solver.js?v=14";
import { t } from "./i18n.js?v=14";
import { mountParameterSidebar } from "./parameter-sidebar.js?v=edb979ef0040";

const byId = id => document.getElementById(id);
const scenarioSelect = byId("wave-scenario");
const amplitudeSelect = byId("wave-amplitude");
const fieldSelect = byId("wave-field");
const shapeSelect = byId("wave-shape");
const sizeSelect = byId("wave-size");
const centerXInput = byId("wave-center-x");
const bottomYInput = byId("wave-bottom-y");
const resolutionSelect = byId("wave-resolution");
const arrowsCheckbox = byId("wave-arrows");
const playButton = byId("wave-play");
const stepButton = byId("wave-step");
const tank = byId("wave-tank");
const historyCanvas = byId("wave-history");
const endTime = 6;
const frameDuration = 1 / 60;
let solver;
let playing = false;
let animationFrame;
let pressureHistory = [];

function createSimulation() {
  return createWaveSolver({
    scenario: scenarioSelect.value,
    amplitude: scenarioSelect.value === "pulse" ? Number(amplitudeSelect.value) : 0.12,
    resolution: Number(resolutionSelect.value),
    obstacle: {
      shape: shapeSelect.value,
      size: Number(sizeSelect.value),
      centerX: centerXInput.value === "" ? 2.75 : Number(centerXInput.value),
      bottomY: bottomYInput.value === "" ? 0 : Number(bottomYInput.value)
    }
  });
}

function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function scientific(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) < 1e-12 ? "0" : value.toExponential(2).replace("e-", "e−");
}

function theme() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    surface: dark ? "#181818" : "#ffffff",
    paper: dark ? "#222222" : "#f5f5f5",
    text: dark ? "#ededed" : "#202020",
    muted: dark ? "#aaaaaa" : "#686868",
    line: dark ? "#363636" : "#e4e4e4",
    blue: dark ? "#85b9e6" : "#2867a4"
  };
}

function prepareCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const bitmapWidth = Math.round(width * ratio);
  const bitmapHeight = Math.round(height * ratio);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function addArrow(context, x, y, dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length < 1.5) return;
  const tipX = x + dx / 2;
  const tipY = y + dy / 2;
  const head = Math.min(length * 0.32, 3.8) / length;
  context.moveTo(x - dx / 2, y - dy / 2);
  context.lineTo(tipX, tipY);
  context.moveTo(tipX - head * (dx + 0.6 * dy), tipY - head * (dy - 0.6 * dx));
  context.lineTo(tipX, tipY);
  context.lineTo(tipX - head * (dx - 0.6 * dy), tipY - head * (dy + 0.6 * dx));
}

function drawTank(colors) {
  const drawing = prepareCanvas(tank);
  if (!drawing) return;
  const { context, width, height } = drawing;
  const { nx, ny, h, obstacle, state } = solver;
  const left = 32;
  const top = 24;
  const scale = Math.min((width - left - 12) / solver.width, (height - top - 28) / solver.height);
  const tankWidth = solver.width * scale;
  const tankHeight = solver.height * scale;
  const bottom = top + tankHeight;
  const cell = h * scale;
  const pressureMode = fieldSelect.value === "pressure";
  let peakPressure = 1000;
  let lowestPressure = 0;
  for (let index = 0; index < state.pressure.length; index++) {
    if (state.liquid[index]) {
      peakPressure = Math.max(peakPressure, state.pressure[index]);
      lowestPressure = Math.min(lowestPressure, state.pressure[index]);
    }
  }
  const pressureMaximum = Math.ceil(peakPressure / 1000) * 1000;
  const pressureMinimum = lowestPressure < -1 ? Math.floor(lowestPressure / 1000) * 1000 : 0;
  byId("wave-pressure-low").textContent = `${number(pressureMinimum / 1000, 1)} kPa`;
  byId("wave-pressure-high").textContent = `${number(pressureMaximum / 1000, 1)} kPa`;

  context.fillStyle = colors.surface;
  context.fillRect(left, top, tankWidth, tankHeight);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const index = j * nx + i;
      if (!state.liquid[index]) continue;
      if (pressureMode) {
        const fraction = Math.max(0, Math.min(1, (state.pressure[index] - pressureMinimum) / (pressureMaximum - pressureMinimum)));
        const red = Math.round(167 + fraction * 64);
        const green = Math.round(217 - fraction * 91);
        const blue = Math.round(247 - fraction * 192);
        context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      } else {
        context.fillStyle = "#60b6e6";
      }
      context.fillRect(left + i * cell, bottom - (j + 1) * cell, cell + 0.4, cell + 0.4);
    }
  }

  if (arrowsCheckbox.checked) {
    context.strokeStyle = colors.text;
    context.lineWidth = 1.15;
    context.lineCap = "round";
    context.beginPath();
    const stride = Math.max(2, Math.ceil(nx / 24));
    for (let j = 1; j < ny; j += stride) {
      for (let i = 1; i < nx; i += stride) {
        if (!state.liquid[j * nx + i]) continue;
        const u = (state.u[j * (nx + 1) + i] + state.u[j * (nx + 1) + i + 1]) / 2;
        const v = (state.v[j * nx + i] + state.v[(j + 1) * nx + i]) / 2;
        const velocityScale = 0.75 * stride * cell / Math.max(1, Math.hypot(u, v));
        addArrow(context, left + (i + 0.5) * cell, bottom - (j + 0.5) * cell, u * velocityScale, -v * velocityScale);
      }
    }
    context.stroke();
  }

  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  context.strokeRect(left, top, tankWidth, tankHeight);
  // Render the exact solid-cell mask used by projection and particle collisions.
  context.fillStyle = colors.paper;
  context.beginPath();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (state.solid[j * nx + i]) context.rect(left + i * cell, bottom - (j + 1) * cell, cell + 0.2, cell + 0.2);
    }
  }
  context.fill();
  context.save();
  context.clip();
  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  context.beginPath();
  for (let offset = -tankHeight; offset < tankWidth; offset += 10) {
    context.moveTo(left + offset, bottom);
    context.lineTo(left + offset + tankHeight, top);
  }
  context.stroke();
  context.restore();
  context.strokeStyle = colors.text;
  context.lineWidth = 1.25;
  context.beginPath();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const index = j * nx + i;
      if (!state.solid[index]) continue;
      const x = left + i * cell;
      const y = bottom - (j + 1) * cell;
      if (i === 0 || !state.solid[index - 1]) { context.moveTo(x, y); context.lineTo(x, y + cell); }
      if (i === nx - 1 || !state.solid[index + 1]) { context.moveTo(x + cell, y); context.lineTo(x + cell, y + cell); }
      if (j === 0 || !state.solid[index - nx]) { context.moveTo(x, y + cell); context.lineTo(x + cell, y + cell); }
      if (j === ny - 1 || !state.solid[index + nx]) { context.moveTo(x, y); context.lineTo(x + cell, y); }
    }
  }
  context.stroke();
  context.fillStyle = colors.text;
  context.font = "12px system-ui, sans-serif";
  context.textAlign = "center";
  const labelX = Math.max(left + 45, Math.min(left + tankWidth - 45, left + obstacle.centerX * scale));
  const labelY = Math.max(top + 12, bottom - (obstacle.bottomY + obstacle.size) * scale - 8);
  context.fillText(shapeName(), labelX, labelY);
  context.fillStyle = colors.muted;
  context.font = "11px system-ui, sans-serif";
  for (let x = 0; x <= solver.width; x++) context.fillText(String(x), left + x * scale, bottom + 17);
  context.fillText("x / m", left + tankWidth - 8, bottom + 28);
  context.textAlign = "right";
  for (let y = 0; y <= solver.height; y += 0.5) context.fillText(number(y, 1), left - 6, bottom - y * scale + 4);
  context.textAlign = "left";
  context.fillText("y / m", 0, 10);
}

function drawHistory(colors) {
  const drawing = prepareCanvas(historyCanvas);
  if (!drawing) return;
  const { context, width, height } = drawing;
  const left = 36;
  const right = width - 12;
  const top = 14;
  const bottom = height - 25;
  const peak = Math.max(1, ...pressureHistory.map(point => point.pressure / 1000));
  const maximum = Math.ceil(peak * 1.1);
  context.strokeStyle = colors.line;
  context.lineWidth = 1;
  context.font = "11px system-ui, sans-serif";
  for (let tick = 0; tick <= 2; tick++) {
    const y = bottom - (bottom - top) * tick / 2;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = colors.muted;
    context.textAlign = "right";
    context.fillText(number(maximum * tick / 2, 1), left - 7, y + 4);
  }
  context.textAlign = "center";
  for (let time = 0; time <= endTime; time += 2) context.fillText(`${time} s`, left + (right - left) * time / endTime, bottom + 19);
  context.beginPath();
  pressureHistory.forEach((point, index) => {
    const x = left + (right - left) * point.time / endTime;
    const y = bottom - (bottom - top) * Math.max(0, point.pressure) / 1000 / maximum;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = colors.blue;
  context.lineWidth = 1.8;
  context.stroke();
}

function recordPressure() {
  const { time, wallPressure } = solver.state;
  const last = pressureHistory[pressureHistory.length - 1];
  if (!last || time - last.time >= 0.025) pressureHistory.push({ time, pressure: wallPressure });
}

function shapeName() {
  return {
    square: t("Fixed square", "固定正方形"),
    circle: t("Fixed circle", "固定圆形"),
    triangle: t("Fixed triangle", "固定三角形")
  }[solver.obstacle.shape];
}

function failureMessage(state) {
  if (state.message === "流速超过当前网格的演示范围，计算已暂停。") {
    return t("Velocity exceeded this grid’s demonstration range. Simulation paused.", state.message);
  }
  return t("Pressure projection did not converge. Reset the simulation to try again.", "压力投影未收敛。请重置后再试。");
}

function render() {
  const state = solver.state;
  const complete = state.time >= endTime - 1e-8;
  const pressureMode = fieldSelect.value === "pressure";
  playButton.textContent = playing ? t("Pause", "暂停") : complete ? t("Replay", "重播") : t("Play", "播放");
  playButton.disabled = Boolean(state.failed);
  stepButton.disabled = playing || complete || Boolean(state.failed);
  byId("wave-time").textContent = `t = ${number(state.time)} s / ${endTime} s`;
  byId("wave-wall-pressure").textContent = `${number(state.wallPressure / 1000)} kPa`;
  byId("wave-force").textContent = `${number(state.forceX)} N/m`;
  byId("wave-divergence").textContent = `${scientific(state.maxDivergence)} s⁻¹`;
  byId("wave-dt").textContent = state.dt > 0 ? `${number(state.dt * 1000, 2)} ms` : "—";
  byId("wave-field-label").textContent = pressureMode ? t("Water pressure · gauge", "水中压力 · 表压") : t("Water & free surface", "水体与自由液面");
  byId("wave-pressure-scale").hidden = !pressureMode;
  tank.setAttribute("aria-label", pressureMode
    ? t("Water pressure and a fixed obstacle in a 2D tank. Blue to orange indicates increasing pressure.", "二维水槽中的水体压力场与固定障碍物，蓝色至橙色表示压力由低到高。")
    : t("Free surface and a fixed obstacle in a 2D tank. Blue represents water.", "二维水槽中的自由液面和固定障碍物，蓝色表示水体。"));
  const status = byId("wave-status");
  status.dataset.failed = String(Boolean(state.failed));
  status.textContent = state.failed ? failureMessage(state)
    : complete ? t("Six seconds of physical time completed. Replay or change the initial condition.", "已完成 6 秒物理时间，可重播或切换初始条件。")
    : playing ? t("Advancing water velocity, pressure and the free surface.", "正在推进水体速度、压力与自由液面。")
    : state.time > 0 ? t("Paused. Step through the simulation or resume playback.", "已暂停，可单步观察或继续播放。")
    : t("Ready. Press Play to observe wave impact.", "就绪，点击播放观察波浪冲击。");
  status.setAttribute("aria-live", playing ? "off" : "polite");
  byId("wave-solver-info").textContent = t(
    `ρ = ${solver.density} kg/m³, ν = ${scientific(solver.viscosity)} m²/s. Pressure solver: ${state.pressureIterations ?? 0} iterations; max. residual ${scientific(state.pressureResidual)} Pa/m²; occupied water-cell area change ${number(state.gridVolumeError)}%.`,
    `ρ = ${solver.density} kg/m³，ν = ${scientific(solver.viscosity)} m²/s。当前压力求解 ${state.pressureIterations ?? 0} 轮，最大残差 ${scientific(state.pressureResidual)} Pa/m²，网格占水面积偏差 ${number(state.gridVolumeError)}%。`
  );
  const notes = {
    pulse: t("Release a wave pulse on the left to observe propagation, impact and reflection. Both ends of the tank are closed.", "从水槽左侧释放初始波包，观察波传播、撞击与反射。水槽两端为封闭边界。"),
    "dam-break": t("Release a taller water column on the left. The surge travels right toward the obstacle. Both ends of the tank are closed.", "释放左侧较高的水柱，涌浪向右传播并冲击障碍物。水槽两端为封闭边界。"),
    still: t("Start from a flat, still water surface to observe the balance of gravity and the pressure gradient.", "从静止的平坦水面开始，观察重力与压力梯度的平衡。")
  };
  byId("wave-scenario-note").textContent = notes[scenarioSelect.value];
  byId("wave-domain").textContent = t(
    `${number(solver.width, 1)} × ${number(solver.height, 1)} m tank · ${solver.nx} × ${solver.ny} grid · Δx = Δy = ${number(solver.h, 4)} m`,
    `${number(solver.width, 1)} × ${number(solver.height, 1)} m 水槽 · ${solver.nx} × ${solver.ny} 网格 · Δx = Δy = ${number(solver.h, 4)} m`
  );
  const colors = theme();
  drawTank(colors);
  drawHistory(colors);
}

function pause() {
  playing = false;
  cancelAnimationFrame(animationFrame);
}

function advance() {
  solver.step(Math.min(frameDuration, endTime - solver.state.time));
  recordPressure();
  if (solver.state.failed || solver.state.time >= endTime - 1e-8) pause();
}

function frame() {
  if (!playing) return;
  // One bounded simulation advance per repaint keeps controls responsive.
  advance();
  render();
  if (playing) animationFrame = requestAnimationFrame(frame);
}

function reset() {
  pause();
  solver = createSimulation();
  pressureHistory = [];
  recordPressure();
  byId("wave-amplitude-row").hidden = scenarioSelect.value !== "pulse";
  const { size, centerX, bottomY } = solver.obstacle;
  // Bounds can fall between hundredths on the 120-cell grid.
  centerXInput.step = "any";
  bottomYInput.step = "any";
  centerXInput.min = number(size / 2 + solver.h, 4);
  centerXInput.max = number(solver.width - size / 2 - solver.h, 4);
  bottomYInput.max = number(solver.height - size - solver.h, 4);
  centerXInput.value = number(centerX, 4).replace(/0+$/, "").replace(/\.$/, "");
  bottomYInput.value = number(bottomY, 4).replace(/0+$/, "").replace(/\.$/, "");
  render();
}

playButton.addEventListener("click", () => {
  if (playing) {
    pause();
    render();
    return;
  }
  if (solver.state.time >= endTime - 1e-8) reset();
  playing = true;
  render();
  animationFrame = requestAnimationFrame(frame);
});
stepButton.addEventListener("click", () => { advance(); render(); });
byId("wave-reset").addEventListener("click", reset);
scenarioSelect.addEventListener("change", reset);
amplitudeSelect.addEventListener("change", reset);
for (const control of [shapeSelect, sizeSelect, centerXInput, bottomYInput, resolutionSelect]) {
  control.addEventListener("change", reset);
}
for (const control of [centerXInput, bottomYInput]) {
  control.addEventListener("blur", () => {
    if (control.value === "" || !control.validity.valid) reset();
  });
}
window.addEventListener("languagechange", () => { if (solver) render(); });
fieldSelect.addEventListener("change", render);
arrowsCheckbox.addEventListener("change", render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) { pause(); render(); }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
const waveRoot = byId("wave-demo");
const sidebarControls = [...waveRoot.children].filter(node =>
  node.matches(".wave-setting, .wave-controls-grid, #wave-geometry-help")
);
const sidebarContent = [...waveRoot.children].filter(node =>
  node.matches(".wave-tank-figure, .wave-metrics, .wave-status, .wave-history-figure, #wave-model-help")
);
for (const control of sidebarControls) control.classList.add("wave-parameter-control");
mountParameterSidebar(waveRoot, { controls: sidebarControls, content: sidebarContent, key: "waves" });
waveRoot.classList.add("wave-sidebar-ready");
new ResizeObserver(() => { if (solver) render(); }).observe(tank);
reset();
