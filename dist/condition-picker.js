import { INITIAL_CONDITIONS, getInitialCondition } from "./initial-conditions.js";

export function selectedInitialCondition() {
  return getInitialCondition(new URL(location.href).searchParams.get("initial"));
}

export function mountConditionPicker(host, condition, onChange, { layout = "standard" } = {}) {
  host.classList.add("condition-picker");
  host.innerHTML = layout === "animation" ? `
    <label for="${host.id}-select">初始条件</label>
    <select id="${host.id}-select" aria-describedby="${host.id}-formula ${host.id}-boundary"></select>
    <details class="parameter-help"><summary aria-label="初始条件说明">说明</summary><div class="parameter-help-body">
      <p id="${host.id}-formula" class="mac-initial-formula"></p>
      <p id="${host.id}-boundary" class="mac-boundary-note">区域 [0, 2π)²；采用周期边界，初始离散散度约为 0。切换后从第 0 层重新计算。</p>
    </div></details>
  ` : `
    <div class="condition-choice">
      <label for="${host.id}-select">初始流场</label>
      <select id="${host.id}-select" aria-describedby="${host.id}-description"></select>
      <details class="parameter-help"><summary aria-label="初始条件说明">说明</summary><div class="parameter-help-body">
        <p class="condition-description" id="${host.id}-description"></p>
        <div class="condition-formula"></div>
        <p>周期区域 [0, 2π) × [0, 2π)。背景流速 (0.60, 0.55)，初始离散散度约为 0。切换后从第 0 层开始。</p>
      </div></details>
    </div>
  `;
  const select = host.querySelector("select");
  for (const preset of INITIAL_CONDITIONS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    select.append(option);
  }

  let activeId = condition.id;
  function render(preset) {
    activeId = preset.id;
    select.value = preset.id;
    const description = host.querySelector(".condition-description");
    if (description) description.textContent = preset.description;
    host.querySelector(".condition-formula, .mac-initial-formula").textContent = preset.formula;
    for (const link of document.querySelectorAll(".method-nav a")) {
      const target = new URL(link.href);
      if (!/\/(mac|compare)\.html$/.test(target.pathname)) continue;
      target.searchParams.set("initial", preset.id);
      const dt = new URL(location.href).searchParams.get("dt");
      if (dt !== null) target.searchParams.set("dt", dt);
      else target.searchParams.delete("dt");
      link.href = target.pathname + target.search + target.hash;
    }
  }

  select.addEventListener("change", () => {
    const preset = getInitialCondition(select.value);
    onChange(preset, { source: "selection" });
    render(preset);
    const url = new URL(location.href);
    url.searchParams.set("initial", preset.id);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", () => {
    const preset = selectedInitialCondition();
    if (preset.id === activeId) return;
    onChange(preset, { source: "history" });
    render(preset);
  });
  render(condition);
}
