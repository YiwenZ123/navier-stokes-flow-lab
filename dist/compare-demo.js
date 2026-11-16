import { mountConditionPicker, selectedInitialCondition } from "./condition-picker.js";
import { DT_OPTIONS, COMPARISON_END_TIME, normalizeTimeStep } from "./time-step-options.js";
import { SPATIAL_GRID, spatialGridSummary } from "./spatial-grid.js";
import { readIterationOptions, writeIterationQuery, iterationLabel, mountIterationControls } from "./iteration-controls.js";
import { t, translateText } from "./i18n.js?v=14";
import { mountParameterSidebar } from "./parameter-sidebar.js?v=edb979ef0040";

const root = document.querySelector("#comparison-demo");
const methods = ["explicit", "mac"];
let condition = selectedInitialCondition();
let timeStep = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
let iterationOptions = readIterationOptions();
let iterationControls;
let result = null;
let settings;
let frames = [];
let selected = 0;
let last = 0;
let plotPeak = 1;
let playing = false;
let timer;
let inputTimer;
let worker;
let requestId = 0;
let sweepComplete = false;
let sweepRows = null;
let errorMessage = null;

root.innerHTML = `
  <div class="comparison-spatial">
    <p aria-label="统一空间网格">${spatialGridSummary()}</p>
    <details class="parameter-help"><summary aria-label="空间网格说明">说明</summary><div class="parameter-help-body">
      <p class="comparison-note">两种方法均使用 ${SPATIAL_GRID.intervals} × ${SPATIAL_GRID.intervals} 个周期单元。</p>
    </div></details>
  </div>
  <div id="comparison-iterations"></div>
  <div class="comparison-dt">
    <div class="comparison-dt-heading"><label for="comparison-dt">时间步长 Δt</label><output for="comparison-dt" data-compare="dt-label"></output></div>
    <input id="comparison-dt" type="range" min="0" max="${DT_OPTIONS.length - 1}" step="1" data-compare="dt" aria-describedby="comparison-dt-note">
    <div class="comparison-dt-ticks"><span>${DT_OPTIONS[0]}</span><span>${DT_OPTIONS.at(-1)}</span></div>
    <div class="comparison-dt-presets" role="group" aria-label="常用时间步长">
      <button type="button" data-dt="0.05">小步长 0.05</button><button type="button" data-dt="0.2">步长 0.2</button><button type="button" data-dt="0.6">大步长 0.6</button>
    </div>
    <details class="parameter-help"><summary aria-label="时间步长说明">说明</summary><div class="parameter-help-body">
      <p id="comparison-dt-note" class="comparison-note">每个步长都计算到同一物理时刻 t = ${COMPARISON_END_TIME}，网格与初始条件保持一致。步长越大，时间步数越少。</p>
    </div></details>
  </div>
  <div class="comparison-chart-control">
    <label for="comparison-chart-metric" data-en="Chart metric" data-zh="图表指标">${t("Chart metric", "图表指标")}</label>
    <select id="comparison-chart-metric" data-compare="chart-metric"><option value="growthFactor">扰动增长倍数</option><option value="velocityRmsError">速度 RMS 误差</option><option value="maxDivergence">最大绝对散度</option></select>
  </div>
  <p class="comparison-message" data-compare="message" role="status">正在计算…</p>
  <div data-compare="results" hidden>
    <div class="comparison-time">
      <button type="button" data-compare="play">从头播放</button>
      <label for="comparison-step">物理时间</label>
      <input type="range" id="comparison-step" data-compare="slider" min="0" step="1">
      <output for="comparison-step" data-compare="time" aria-live="off"></output>
    </div>
    <table class="comparison-metrics">
      <caption>同一物理时刻的结果</caption>
      <thead><tr><th scope="col">指标</th><th scope="col">显式推进</th><th scope="col">隐式 MAC</th></tr></thead>
      <tbody>
        <tr class="comparison-status-row"><th scope="row">当前状态</th><td data-compare="explicit-status"></td><td data-compare="mac-status"></td></tr>
        <tr><th scope="row">扰动增长倍数</th><td data-compare="explicit-growth"></td><td data-compare="mac-growth"></td></tr>
        <tr><th scope="row">速度 RMS 误差</th><td data-compare="explicit-error"></td><td data-compare="mac-error"></td></tr>
        <tr><th scope="row">最大绝对散度</th><td data-compare="explicit-divergence"></td><td data-compare="mac-divergence"></td></tr>
        <tr><th scope="row">对流 CFL 数</th><td data-compare="explicit-cfl"></td><td data-compare="mac-cfl"></td></tr>
        <tr><th scope="row">对流–扩散指标 χ</th><td data-compare="explicit-chi"></td><td data-compare="mac-chi"></td></tr>
        <tr><th scope="row">压力迭代 / 轮</th><td data-compare="explicit-pressure"></td><td data-compare="mac-pressure"></td></tr>
        <tr><th scope="row">隐式预测 / 轮</th><td>—</td><td data-compare="mac-predictor"></td></tr>
      </tbody>
    </table>
    <p class="comparison-note" data-compare="diagnostic"></p>
    <figure class="comparison-history">
      <figcaption class="comparison-chart-heading">随物理时间变化</figcaption>
      <div class="comparison-curves" aria-label="曲线图例"><span><i class="comparison-key-explicit" aria-hidden="true"></i>显式推进</span><span><i class="comparison-key-mac" aria-hidden="true"></i>隐式 MAC</span></div>
      <canvas class="comparison-chart" data-compare="history" role="img" aria-label="两种方法随物理时间的变化曲线"></canvas>
      <details class="parameter-help"><summary aria-label="图表说明">说明</summary><div class="parameter-help-body">
        <p class="comparison-note" data-compare="history-note"></p>
      </div></details>
    </figure>
    <div class="comparison-fields">
      <figure><figcaption>显式推进 <span class="comparison-field-status" data-compare="explicit-field-status"></span></figcaption><canvas class="comparison-field" data-compare="explicit-field" role="img" aria-label="显式推进的速度扰动场，已扣除均匀平移速度"></canvas></figure>
      <figure><figcaption>隐式 MAC 投影法 <span class="comparison-field-status" data-compare="mac-field-status"></span></figcaption><canvas class="comparison-field" data-compare="mac-field" role="img" aria-label="MAC 的速度扰动场，面速度平均至单元中心，已扣除均匀平移速度"></canvas></figure>
    </div>
    <div class="comparison-colorbar"><span>0</span><i aria-hidden="true"></i><span data-compare="scale"></span></div>
    <details class="parameter-help"><summary aria-label="流场说明">说明</summary><div class="parameter-help-body">
      <p class="comparison-note">两幅图在当前时刻使用同一速度尺度；停止计算后不再显示流场，避免将旧结果当作当前结果。MAC 面速度平均到单元中心后绘图。</p>
      <p class="comparison-note" data-compare="uniform-note" hidden>均匀流扣除背景速度后为零，图中没有涡结构；初始扰动为零时，增长倍数不定义。</p>
    </div></details>
  </div>
  <section class="comparison-sweep" aria-labelledby="sweep-title">
    <h3 id="sweep-title">不同时间步长的稳定性观察</h3>
    <details class="parameter-help"><summary aria-label="扫描说明">说明</summary><div class="parameter-help-body">
      <p class="comparison-note">同一初始流场，各步长都尝试推进到 t = ${COMPARISON_END_TIME}。点击 Δt 可查看详细结果。</p>
      <p class="comparison-note">“未见明显增长”只描述本算例在观察区间内的结果。扰动达到初始值的 2 倍标为明显增长，达到 20 倍或出现非有限数时停止；这两条是演示判据。迭代未收敛单独标记。</p>
    </div></details>
    <p data-compare="sweep-message" class="comparison-note" role="status">正在扫描全部步长…</p>
    <table class="comparison-metrics comparison-sweep-table" data-compare="sweep-table" hidden>
      <thead><tr><th scope="col">Δt</th><th scope="col">显式推进</th><th scope="col">隐式 MAC</th></tr></thead><tbody data-compare="sweep-body"></tbody>
    </table>
  </section>
`;
const elements = Object.fromEntries(Array.from(root.querySelectorAll("[data-compare]"), el => [el.dataset.compare, el]));
const colorScheme = matchMedia("(prefers-color-scheme: dark)");
function statusLabel(status) {
  const labels = {
    bounded: t("No marked growth", "未见明显增长"),
    growth: t("Marked growth", "明显增长"),
    diverged: t("Growth limit reached; stopped", "增长超限，已停止"),
    "pressure-failed": t("Pressure iteration did not converge", "压力迭代未收敛"),
    "predictor-failed": t("Predictor iteration did not converge", "预测迭代未收敛")
  };
  return labels[status] || status;
}

function superscript(number) {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return Array.from(String(number), digit => digit === "-" ? "⁻" : digits[Number(digit)]).join("");
}
function format(value) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const [coefficient, exponent] = value.toExponential(2).split("e");
  return `${coefficient}×10${superscript(Number(exponent))}`;
}
const decimal = value => Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "—";
const timeText = value => Number(value.toFixed(3)).toString();
function setText(name, value) { elements[name].textContent = value; }
function pause() { clearTimeout(timer); playing = false; }

function updateStepControls() {
  elements.dt.value = String(DT_OPTIONS.indexOf(timeStep));
  elements.dt.setAttribute("aria-valuetext", `Δt = ${timeStep}`);
  setText("dt-label", `${timeStep} · ${Math.round(COMPARISON_END_TIME / timeStep)} ${t("steps", "步")}`);
  for (const button of root.querySelectorAll("[data-dt]")) button.setAttribute("aria-pressed", String(Number(button.dataset.dt) === timeStep));
}
function updateNotes() {
  document.querySelector("#comparison-settings-grid").textContent = `${SPATIAL_GRID.intervals} × ${SPATIAL_GRID.intervals} ${t("periodic cells", "个周期单元")} · ${translateText(spatialGridSummary())}`;
  document.querySelector("#comparison-condition-label").textContent = translateText(condition.label);
  document.querySelector("#comparison-condition-formula").textContent = condition.formula;
  document.querySelector("#comparison-condition-description").textContent = translateText(condition.description);
  document.querySelector("#comparison-settings-time").textContent = t(`Δt = ${timeStep}; ${Math.round(COMPARISON_END_TIME / timeStep)} steps; final time t = ${COMPARISON_END_TIME}`, `Δt = ${timeStep}，共 ${Math.round(COMPARISON_END_TIME / timeStep)} 步，终止时刻 t = ${COMPARISON_END_TIME}`);
  const pressureMethod = translateText(iterationLabel(iterationOptions.pressureMethod, { pressure: true, omega: iterationOptions.pressureOmega }));
  const predictorMethod = translateText(iterationLabel(iterationOptions.predictorMethod, { omega: iterationOptions.predictorOmega }));
  document.querySelector("#comparison-settings-iterations").textContent = t(`Both pressure solves use ${pressureMethod}; the MAC velocity predictor uses ${predictorMethod}.`, `两种方法的压力求解均选用 ${pressureMethod}；MAC 预测速度选用 ${predictorMethod}。`);
  elements["uniform-note"].hidden = condition.id !== "uniform";
}
function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("dt", String(timeStep));
  url.searchParams.set("initial", condition.id);
  writeIterationQuery(url, iterationOptions);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  for (const link of document.querySelectorAll(".method-nav a")) {
    const target = new URL(link.href);
    if (!/\/(mac|compare)(\.html)?$/.test(target.pathname)) continue;
    target.searchParams.set("dt", String(timeStep));
    target.searchParams.set("initial", condition.id);
    writeIterationQuery(target, iterationOptions);
    link.href = target.pathname + target.search + target.hash;
  }
}
function outcomeText(outcome) {
  const label = statusLabel(outcome.status);
  return outcome.stopTime === null ? label : `${label} · t = ${timeText(outcome.stopTime)}`;
}
function showError(message) {
  errorMessage = message;
  pause();
  elements.results.hidden = true;
  elements["sweep-table"].hidden = true;
  setText("message", t(`Calculation incomplete: ${translateText(message)} Adjust the time step and try again.`, `计算未完成：${message} 请调整步长重试。`));
  setText("sweep-message", t("This sweep did not finish.", "本次扫描未完成。"));
}
function requestComparison(startAt = "end") {
  pause();
  updateUrl();
  clearTimeout(inputTimer);
  worker?.terminate();
  const id = ++requestId;
  sweepComplete = false;
  sweepRows = null;
  errorMessage = null;
  result = null;
  frames = [];
  updateStepControls();
  updateNotes();
  iterationControls?.render(iterationOptions);
  elements.results.hidden = true;
  elements["sweep-table"].hidden = true;
  setText("message", t(`Calculating ${translateText(condition.label)}, Δt = ${timeStep}…`, `正在计算 ${condition.label}，Δt = ${timeStep}…`));
  setText("sweep-message", t("Sweeping all time steps…", "正在扫描全部步长…"));
  try { worker = new Worker(new URL("./comparison-worker.js", import.meta.url), { type: "module" }); }
  catch (error) { showError(error.message); return; }
  worker.addEventListener("error", () => { if (id === requestId) showError("计算线程无法运行"); });
  worker.addEventListener("message", ({ data }) => {
    if (data.requestId !== requestId) return;
    if (data.type === "error") { showError(data.message); return; }
    if (data.type === "result") {
      result = data.result;
      ({ settings, frames } = result);
      last = frames.length - 1;
      selected = startAt === "start" ? 0 : last;
      elements.slider.max = String(last);
      elements.results.hidden = false;
      setText("message", t(`Calculation complete · Δt = ${settings.dt} · observed to t = ${settings.finalTime}`, `已完成本次计算 · Δt = ${settings.dt} · 观察至 t = ${settings.finalTime}`));
      render();
    } else if (data.type === "sweep") renderSweep(data.rows);
  });
  worker.postMessage({ requestId: id, presetId: condition.id, dt: timeStep, iterationOptions });
}

function renderSweep(rows) {
  sweepRows = rows;
  sweepComplete = true;
  elements["sweep-body"].replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.dt === timeStep) tr.className = "comparison-sweep-selected";
    const th = document.createElement("th");
    th.scope = "row";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(row.dt);
    button.setAttribute("aria-label", t(`View results for time step ${row.dt}`, `查看时间步长 ${row.dt} 的详细结果`));
    button.setAttribute("aria-pressed", String(row.dt === timeStep));
    button.addEventListener("click", () => chooseTimeStep(row.dt));
    th.append(button); tr.append(th);
    for (const method of methods) {
      const outcome = row[method];
      const td = document.createElement("td");
      const status = document.createElement("strong");
      status.textContent = outcomeText(outcome);
      status.dataset.status = outcome.status;
      const detail = document.createElement("span");
      detail.textContent = `${t("Peak growth", "最大增长")} ${Number.isFinite(outcome.maxGrowth) ? decimal(outcome.maxGrowth) + "×" : "—"}${outcome.completed ? t(" · Final error ", " · 终点误差 ") + format(outcome.endError) : ""}`;
      td.append(status, detail); tr.append(td);
    }
    elements["sweep-body"].append(tr);
  }
  elements["sweep-table"].hidden = false;
  setText("sweep-message", t("Sweep complete. Growth is relative to the initial perturbation on each method's grid.", "扫描完成。增长倍数相对于各自网格上的初始扰动计算。"));
}

function prepareCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const context = canvas.getContext("2d");
  if (!context || width < 1 || height < 1) return null;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const bitmapWidth = Math.round(width * ratio);
  const bitmapHeight = Math.round(height * ratio);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) { canvas.width = bitmapWidth; canvas.height = bitmapHeight; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}
function addArrow(context, x, y, dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length < 1.4) return;
  const tipX = x + dx / 2, tipY = y + dy / 2;
  const wing = Math.min(3.6, length * 0.3) / length;
  context.moveTo(x - dx / 2, y - dy / 2); context.lineTo(tipX, tipY);
  context.moveTo(tipX - wing * (dx + 0.55 * dy), tipY - wing * (dy - 0.55 * dx));
  context.lineTo(tipX, tipY); context.lineTo(tipX - wing * (dx - 0.55 * dy), tipY - wing * (dy + 0.55 * dx));
}
function drawField(canvas, field, theme) {
  const drawing = prepareCanvas(canvas);
  if (!drawing) return;
  const { context, width, height } = drawing;
  if (!field) {
    context.font = "14px system-ui, sans-serif"; context.fillStyle = theme.label; context.textAlign = "center";
    context.fillText(t("No valid field at this time", "此时刻无有效流场"), width / 2, height / 2, Math.max(1, width - 16));
    return;
  }
  const { size, driftX, driftY } = settings;
  const span = Math.min(width, height) - 16;
  if (span < 1) return;
  const left = (width - span) / 2, bottom = (height + span) / 2, cell = span / size;
  const stride = Math.max(1, Math.ceil(size / 9));
  context.fillStyle = theme.field;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const index = j * size + i;
    const speed = Math.hypot(field.u[index] - driftX, field.v[index] - driftY);
    context.globalAlpha = 0.68 * Math.min(1, speed / plotPeak);
    const x = Math.round(left + i * cell), y = Math.round(bottom - (j + 1) * cell);
    context.fillRect(x, y, Math.round(left + (i + 1) * cell) - x, Math.round(bottom - j * cell) - y);
  }
  context.globalAlpha = 1; context.strokeStyle = theme.grid; context.lineWidth = 1;
  context.strokeRect(left, bottom - span, span, span);
  const arrowScale = 0.78 * stride * cell / plotPeak, offset = Math.floor(stride / 2);
  context.strokeStyle = theme.arrow; context.lineWidth = 1.2; context.lineCap = "round"; context.beginPath();
  for (let j = offset; j < size; j += stride) for (let i = offset; i < size; i += stride) {
    const index = j * size + i;
    addArrow(context, left + (i + 0.5) * cell, bottom - (j + 0.5) * cell, (field.u[index] - driftX) * arrowScale, -(field.v[index] - driftY) * arrowScale);
  }
  context.stroke();
}
function logScale(values) {
  const positive = values.filter(value => Number.isFinite(value) && value > 0);
  if (!positive.length) return { min: -6, max: 0, interval: 2 };
  const min = Math.floor(Math.log10(Math.min(...positive)));
  const span = Math.max(1, Math.ceil(Math.log10(Math.max(...positive))) - min);
  const interval = Math.max(1, Math.ceil(span / 5));
  return { min, max: min + interval * Math.ceil(span / interval), interval };
}
function drawHistory(theme) {
  const drawing = prepareCanvas(elements.history);
  if (!drawing || !frames.length) return;
  const { context, width, height } = drawing;
  const metric = elements["chart-metric"].value;
  const isLog = metric !== "growthFactor";
  const values = frames.flatMap(frame => methods.map(method => frame[method]?.[metric])).filter(Number.isFinite);
  const scale = isLog ? logScale(values) : { min: 0, max: Math.max(2, Math.ceil(Math.max(0, ...values))), interval: 1 };
  if (!isLog) scale.interval = Math.max(1, Math.ceil(scale.max / 5));
  const left = 43, right = width - 27, top = 12, bottom = height - 31;
  if (right <= left || bottom <= top) return;
  const x = time => left + time / COMPARISON_END_TIME * (right - left);
  const y = value => bottom - (value - scale.min) / (scale.max - scale.min) * (bottom - top);
  context.font = "12px system-ui, sans-serif"; context.fillStyle = theme.label; context.strokeStyle = theme.grid;
  context.lineWidth = 1; context.textAlign = "right"; context.textBaseline = "middle";
  for (let tick = scale.min; tick <= scale.max; tick += scale.interval) {
    const point = y(tick); context.beginPath(); context.moveTo(left, point); context.lineTo(right, point); context.stroke();
    context.fillText(isLog ? `10${superscript(tick)}` : `${tick}×`, left - 7, point);
  }
  context.textAlign = "center";
  for (let tick = 0; tick <= 4; tick++) {
    const t = COMPARISON_END_TIME * tick / 4;
    context.fillText(tick === 4 ? `t=${t}` : String(t), x(t), bottom + 17);
  }
  context.strokeStyle = theme.label; context.globalAlpha = 0.55; context.beginPath();
  context.moveTo(x(frames[selected].time), top); context.lineTo(x(frames[selected].time), bottom); context.stroke(); context.globalAlpha = 1;
  for (const method of methods) {
    context.strokeStyle = theme[method]; context.lineWidth = 2; context.lineJoin = "round";
    context.setLineDash(method === "mac" ? [5, 4] : []); context.beginPath();
    let started = false;
    for (const frame of frames) {
      const value = frame[method]?.[metric];
      if (!Number.isFinite(value) || (isLog && value <= 0)) { started = false; continue; }
      const point = y(isLog ? Math.log10(value) : value);
      if (started) context.lineTo(x(frame.time), point); else context.moveTo(x(frame.time), point);
      started = true;
    }
    context.stroke(); context.setLineDash([]);
  }
  if (!values.length || values.every(value => value === 0)) {
    context.fillStyle = theme.label; context.fillText(metric === "growthFactor" ? t("Zero initial perturbation; growth is undefined", "初始扰动为零，增长倍数不定义") : t("Zero data; no logarithmic curve to plot", "当前数据为零，无可绘制的对数曲线"), (left + right) / 2, (top + bottom) / 2, right - left);
  }
  setText("history-note", isLog ? t("Error and divergence use logarithmic axes; zeros are omitted. Values around 10⁻¹⁵ approach roundoff. Curves stop when calculation stops.", "误差与散度使用对数坐标，零值不绘制；约 10⁻¹⁵ 已接近舍入误差。停止后曲线中断。") : t("Growth = current perturbation RMS / initial perturbation RMS. 1× is the initial level; 2× marks noticeable growth. Curves stop when calculation stops.", "增长倍数 = 当前扰动 RMS / 初始扰动 RMS。1× 表示初始水平；2× 为增长提示阈值。停止后曲线中断。"));
}
function render() {
  if (!result || elements.results.hidden) return;
  const frame = frames[selected];
  elements.slider.value = String(selected);
  elements.slider.setAttribute("aria-valuetext", t(`Time ${timeText(frame.time)}, step ${frame.layer}`, `时间 ${timeText(frame.time)}，第 ${frame.layer} 层`));
  setText("time", `t = ${timeText(frame.time)} / ${COMPARISON_END_TIME} · n = ${frame.layer}`);
  setText("play", playing ? t("Pause", "暂停") : selected === last ? t("Play from start", "从头播放") : t("Play", "播放"));
  let peak = 0;
  for (const method of methods) {
    const state = frame[method], outcome = result.outcomes[method];
    setText(`${method}-status`, state ? (selected === 0 ? t("Initial condition", "初始条件") : statusLabel(state.status || "bounded")) : outcomeText(outcome));
    elements[`${method}-status`].dataset.status = state?.status || outcome.status;
    setText(`${method}-field-status`, state ? "" : `${t("Stopped", "已停止")} @ t = ${timeText(outcome.stopTime)}`);
    setText(`${method}-growth`, Number.isFinite(state?.growthFactor) ? decimal(state.growthFactor) + "×" : "—");
    setText(`${method}-error`, format(state?.velocityRmsError));
    setText(`${method}-divergence`, format(state?.maxDivergence));
    setText(`${method}-cfl`, decimal(state?.cfl));
    setText(`${method}-chi`, decimal(state?.advectionDiffusion));
    setText(`${method}-pressure`, state && selected > 0 ? String(state.pressureSweeps) : "—");
    if (state) for (let i = 0; i < state.u.length; i++) peak = Math.max(peak, Math.hypot(state.u[i] - settings.driftX, state.v[i] - settings.driftY));
  }
  setText("mac-predictor", frame.mac && selected > 0 ? String(frame.mac.predictorSweeps) : "—");
  plotPeak = Math.ceil(peak * 10) / 10 || 1;
  setText("scale", decimal(plotPeak));
  const initialChi = result.outcomes.explicit.initialAdvectionDiffusion;
  setText("diagnostic", t(`Initial explicit χ = ${decimal(initialChi)} (${initialChi > 1 ? "above 1" : "at most 1"}). χ ≤ 1 is a sufficient condition for frozen-velocity upwind advection–diffusion; it does not by itself guarantee stability of the full pressure-coupled algorithm.`, `初始显式 χ = ${decimal(initialChi)}${initialChi > 1 ? "，超过 1" : "，不超过 1"}。χ ≤ 1 是冻结速度的迎风对流–扩散格式的充分条件，不能单独保证整个压力耦合算法稳定。`));
  const styles = getComputedStyle(root);
  const theme = Object.fromEntries(["field", "arrow", "grid", "label", ...methods].map(name => [name, styles.getPropertyValue(`--comparison-${name}`).trim()]));
  for (const method of methods) drawField(elements[`${method}-field`], frame[method], theme);
  drawHistory(theme);
}
function advance() {
  selected++;
  if (selected >= last) pause();
  render();
  if (playing) timer = setTimeout(advance, Math.max(35, 5000 / last));
}
function chooseTimeStep(value) {
  timeStep = normalizeTimeStep(value);
  updateUrl();
  requestComparison("end");
}
elements.dt.addEventListener("input", () => {
  timeStep = DT_OPTIONS[Number(elements.dt.value)];
  pause(); worker?.terminate(); requestId++; result = null; elements.results.hidden = true; elements["sweep-table"].hidden = true;
  sweepRows = null; sweepComplete = false; errorMessage = null;
  updateStepControls(); setText("message", t("Recalculating with the new time step…", "调整步长后重新计算…"));
  clearTimeout(inputTimer); inputTimer = setTimeout(() => chooseTimeStep(timeStep), 180);
});
elements.play.addEventListener("click", () => {
  if (playing) pause();
  else { if (selected === last) selected = 0; playing = true; timer = setTimeout(advance, Math.max(35, 5000 / last)); }
  render();
});
elements.slider.addEventListener("input", () => { pause(); selected = Number(elements.slider.value); render(); });
elements["chart-metric"].addEventListener("change", render);
for (const button of root.querySelectorAll("[data-dt]")) button.addEventListener("click", () => chooseTimeStep(Number(button.dataset.dt)));
iterationControls = mountIterationControls(document.querySelector("#comparison-iterations"), iterationOptions, next => {
  iterationOptions = next;
  updateUrl();
  requestComparison("start");
});
mountConditionPicker(document.querySelector("#comparison-initial"), condition, (preset, { source } = {}) => {
  condition = preset;
  if (source === "history") {
    timeStep = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
    iterationOptions = readIterationOptions();
  }
  else updateUrl();
  requestComparison("start");
});
root.classList.add("comparison-sidebar-layout");
mountParameterSidebar(root, {
  key: "comparison",
  controls: [
    document.querySelector("#comparison-initial"),
    root.querySelector(".comparison-spatial"),
    root.querySelector("#comparison-iterations"),
    root.querySelector(".comparison-dt"),
    root.querySelector(".comparison-chart-control")
  ],
  content: [elements.message, elements.results, root.querySelector(".comparison-sweep")]
});
window.addEventListener("popstate", () => {
  const next = normalizeTimeStep(new URL(location.href).searchParams.get("dt"));
  const nextIteration = readIterationOptions();
  if (next !== timeStep || JSON.stringify(nextIteration) !== JSON.stringify(iterationOptions)) {
    timeStep = next;
    iterationOptions = nextIteration;
    requestComparison("end");
  }
});
const resize = new ResizeObserver(render);
for (const canvas of root.querySelectorAll("canvas")) resize.observe(canvas);
colorScheme.addEventListener("change", render);
window.addEventListener("pagehide", () => { pause(); worker?.terminate(); });
window.addEventListener("pageshow", event => { if (event.persisted && (!result || !sweepComplete)) requestComparison(); });
window.addEventListener("languagechange", () => {
  updateStepControls();
  updateNotes();
  if (errorMessage) { showError(errorMessage); return; }
  if (result) {
    setText("message", t(`Calculation complete · Δt = ${settings.dt} · observed to t = ${settings.finalTime}`, `已完成本次计算 · Δt = ${settings.dt} · 观察至 t = ${settings.finalTime}`));
    render();
  } else setText("message", t(`Calculating ${translateText(condition.label)}, Δt = ${timeStep}…`, `正在计算 ${condition.label}，Δt = ${timeStep}…`));
  if (sweepRows) renderSweep(sweepRows);
  else setText("sweep-message", t("Sweeping all time steps…", "正在扫描全部步长…"));
});
requestComparison();
