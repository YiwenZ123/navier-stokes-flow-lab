import { ITERATION_METHODS, SOR_OMEGAS, normalizeIterationOptions } from "./iteration-options.js";

export function readIterationOptions(search = location.search) {
  const query = new URLSearchParams(search);
  return normalizeIterationOptions({
    pressureMethod: query.get("pressure"), pressureOmega: query.get("omega"),
    predictorMethod: query.get("predictor"), predictorOmega: query.get("predictorOmega")
  });
}

export function writeIterationQuery(url, options) {
  url.searchParams.set("pressure", options.pressureMethod);
  url.searchParams.set("omega", String(options.pressureOmega));
  url.searchParams.set("predictor", options.predictorMethod);
  url.searchParams.set("predictorOmega", String(options.predictorOmega));
}

export function iterationLabel(method, { pressure = false, omega } = {}) {
  if (method === "sor") return `SOR${omega === undefined ? "" : `（ω = ${omega}）`}`;
  if (method === "gauss-seidel") return "Gauss–Seidel";
  return pressure ? "加权 Jacobi" : "Jacobi";
}

export function mountIterationControls(host, initial, onChange) {
  let options = normalizeIterationOptions(initial);
  host.classList.add("iteration-settings");
  host.innerHTML = ["pressure", "predictor"].map(kind => {
    const title = kind === "pressure" ? "压力迭代" : "MAC 预测迭代";
    const id = `${host.id}-${kind}`;
    return `<div class="iteration-row">
      <label for="${id}">${title}</label>
      <select id="${id}" data-iteration="${kind}Method" aria-describedby="${id}-note"></select>
      <span class="iteration-omega" data-omega="${kind}">
        <label for="${id}-omega">松弛因子 ω</label>
        <select id="${id}-omega" data-iteration="${kind}Omega" aria-label="${kind === "pressure" ? "压力" : "预测"}松弛因子 ω"></select>
      </span>
      <details class="parameter-help"><summary aria-label="${title}说明">说明</summary><div class="parameter-help-body">
        <p id="${id}-note" class="iteration-note" data-note="${kind}"></p>
      </div></details>
    </div>`;
  }).join("");
  for (const kind of ["pressure", "predictor"]) {
    const methodSelect = host.querySelector(`[data-iteration="${kind}Method"]`);
    for (const method of ITERATION_METHODS) {
      const option = document.createElement("option");
      option.value = method.id;
      option.textContent = method.id === "jacobi" && kind === "pressure" ? "加权 Jacobi（默认）" : method.label;
      methodSelect.append(option);
    }
    const omegaSelect = host.querySelector(`[data-iteration="${kind}Omega"]`);
    for (const omega of SOR_OMEGAS) {
      const option = document.createElement("option");
      option.value = String(omega);
      option.textContent = omega.toFixed(1);
      omegaSelect.append(option);
    }
  }
  function render(next) {
    options = normalizeIterationOptions(next);
    for (const control of host.querySelectorAll("[data-iteration]")) {
      control.value = String(options[control.dataset.iteration]);
    }
    for (const kind of ["pressure", "predictor"]) {
      const method = options[`${kind}Method`];
      host.querySelector(`[data-omega="${kind}"]`).hidden = method !== "sor";
      const explanation = method === "sor" ? "逐点松弛更新；ω = 1 时等同于 Gauss–Seidel。"
        : method === "gauss-seidel" ? "逐点更新，后面的点立即使用本轮新值。"
        : kind === "pressure" ? "同时更新压力，固定权重为 2/3。" : "用上一轮预测速度同时更新。";
      host.querySelector(`[data-note="${kind}"]`).textContent = explanation + (kind === "pressure"
        ? "切换后从第 0 层重算。" : method === "sor"
          ? "较大的 ω 可能使非线性预测迭代不收敛。" : "每轮结束后检查完整动量方程的残差。");
    }
  }
  host.addEventListener("change", event => {
    const key = event.target.dataset.iteration;
    if (!key) return;
    render({ ...options, [key]: event.target.value });
    onChange({ ...options });
  });
  render(options);
  return { render };
}
