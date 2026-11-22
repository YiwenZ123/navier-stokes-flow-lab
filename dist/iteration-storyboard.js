export function mountIterationStoryboard(host, { mode = "explicit" } = {}) {
  const isMac = mode === "mac";
  const language = () => document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  const copy = {
    en: {
      title: isMac ? "One MAC projection step" : "One explicit time step",
      cards: isMac
        ? ["Predict velocity", "Build the right-hand side", "Solve pressure", "Project velocity"]
        : ["Build the right-hand side", "Solve pressure", "Check the residual", "Update velocity"],
      initial: "Ready for the next time step",
      paused: "Paused",
      active: "Computing",
      done: "Completed",
      waiting: "Waiting",
      failed: "Calculation stopped",
      complete: "End time reached",
      layer: "Time level",
      time: "Physical time",
      iteration: "Iteration",
      residual: "Maximum residual",
      tolerance: "Tolerance",
      accepted: "Residual meets tolerance",
      repeat: "Repeat and check the residual",
      check: "Residual checked after each sweep",
      known: "Known velocity",
      fixed: "Velocity stays fixed during this solve",
      source: "From the predicted face velocities",
      predictor: "Implicit momentum iteration",
      acceptedVelocity: "New velocity accepted",
      targetVelocity: "Next velocity",
      pressure: "Pressure Poisson equation",
      projection: "Subtract the pressure-gradient correction",
      update: "Advance physical time by Δt"
    },
    zh: {
      title: isMac ? "一个 MAC 投影时间步" : "一个显式时间步",
      cards: isMac
        ? ["预测速度", "构造压力方程右端", "迭代求解压力", "投影修正速度"]
        : ["构造压力方程右端", "迭代求解压力", "检查残差", "更新速度"],
      initial: "准备推进下一时间步",
      paused: "已暂停",
      active: "计算中",
      done: "已完成",
      waiting: "等待",
      failed: "计算已停止",
      complete: "已到达终点",
      layer: "时间层",
      time: "物理时间",
      iteration: "迭代轮数",
      residual: "最大残差",
      tolerance: "收敛阈值",
      accepted: "残差达到阈值",
      repeat: "继续迭代并检查残差",
      check: "每轮扫描后检查残差",
      known: "已知速度",
      fixed: "求压过程中速度保持固定",
      source: "由预测面速度构造",
      predictor: "隐式动量方程迭代",
      acceptedVelocity: "新速度已接受",
      targetVelocity: "下一层速度",
      pressure: "压力泊松方程",
      projection: "减去压力梯度修正量",
      update: "物理时间增加 Δt"
    }
  };
  const icons = [
    '<path d="M6 7h20M6 16h20M6 25h20M7 6v20M16 6v20M25 6v20"/><path class="is-icon-accent" d="M11 16h10m-4-4 4 4-4 4"/>',
    '<path d="M6 8h20M6 24h20M10 12v8m6-10v12m6-10v8"/><circle class="is-icon-accent" cx="16" cy="16" r="3"/>',
    '<path d="M5 24h22M7 20l5-9 5 5 8-10"/><path class="is-icon-accent" d="m11 22 4 4 9-10"/>',
    '<path d="M6 25V7m0 18h20"/><path class="is-icon-accent" d="m11 20 12-12m-7 0h7v7"/>'
  ];
  const pressureIndex = isMac ? 2 : 1;
  const root = document.createElement("section");
  root.className = "iteration-storyboard";
  root.dataset.i18nIgnore = "";
  root.dataset.mode = isMac ? "mac" : "explicit";
  root.dataset.playing = "false";
  root.dataset.failed = "false";
  root.dataset.complete = "false";
  root.innerHTML = `
    <header class="is-header">
      <h3 class="is-title"></h3>
      <span class="is-run-status"></span>
    </header>
    <ol class="is-cards">
      ${icons.map((icon, index) => `
        <li class="is-card" data-state="waiting">
          <div class="is-card-top">
            <svg class="is-icon" viewBox="0 0 32 32" aria-hidden="true">${icon}</svg>
            <span class="is-card-status"></span>
          </div>
          <h4 class="is-card-title"></h4>
          <div class="is-equation"></div>
          <div class="is-detail"></div>
          ${index === pressureIndex ? `
            <div class="is-feedback" aria-hidden="true">
              <svg viewBox="0 0 120 28" preserveAspectRatio="none">
                <path d="M10 8H100Q110 8 110 16Q110 24 100 24H20Q10 24 10 16V8m-5 5 5-5 5 5"/>
              </svg>
              <i class="is-feedback-dot"></i>
            </div>
            <p class="is-feedback-text"></p>
          ` : ""}
          <span class="is-connector" aria-hidden="true"><i></i></span>
        </li>
      `).join("")}
    </ol>
    <footer class="is-context">
      <div class="is-level-transition">
        <span class="is-source-label"></span>
        <strong class="is-source-level"></strong>
        <span class="is-level-wire" aria-hidden="true"><i></i></span>
        <strong class="is-target-level"></strong>
        <span class="is-target-label"></span>
      </div>
      <div class="is-time"><span></span><strong></strong></div>
    </footer>
  `;
  host.append(root);
  const cards = Array.from(root.querySelectorAll(".is-card"));
  let latestState = { phase: -1, layer: 0, time: 0, playing: false };

  function format(value) {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    return value.toExponential(2).replaceAll("-", "−");
  }

  function setLines(element, lines) {
    const values = lines.filter(Boolean);
    if (element.dataset.lines === JSON.stringify(values)) return;
    element.replaceChildren(...values.map(value => {
      const line = document.createElement("span");
      line.textContent = value;
      return line;
    }));
    element.dataset.lines = JSON.stringify(values);
  }

  function update(state) {
    latestState = state;
    const words = copy[language()];
    const phase = Number.isInteger(state.phase) ? Math.max(-1, Math.min(3, state.phase)) : -1;
    const layer = Number.isFinite(state.layer) ? Math.max(0, state.layer) : 0;
    const sourceLayer = Number.isFinite(state.sourceLayer) ? Math.max(0, state.sourceLayer)
      : phase === 3 && layer > 0 ? layer - 1 : layer;
    const reachedTolerance = !state.failed && Number.isFinite(state.residual) && Number.isFinite(state.tolerance)
      && state.residual <= state.tolerance && phase >= pressureIndex;
    root.dataset.playing = String(Boolean(state.playing));
    root.dataset.failed = String(Boolean(state.failed));
    root.dataset.complete = String(Boolean(state.complete));
    root.dataset.phase = String(phase);
    root.querySelector(".is-title").textContent = words.title;
    root.querySelector(".is-run-status").textContent = state.failed ? words.failed
      : state.complete ? words.complete
      : phase === -1 ? words.initial
      : state.playing ? words.active : words.paused;
    const equations = isMac ? [
      ["U* = Uⁿ + Δt Hₕ(U*)"],
      ["b = (ρ / Δt) DₕU*"],
      ["Lₕp* = b", "r = ‖Lₕp* − b‖∞"],
      ["Uⁿ⁺¹ = U*", "− (Δt / ρ) Gₕp*"]
    ] : [
      ["bⁿ = −ρ[(δₓu)²", "+ 2δᵧu δₓv + (δᵧv)²]"],
      ["Lₕpⁿ = bⁿ"],
      ["r = ‖Lₕp − bⁿ‖∞", "r ≤ ε"],
      ["ΔU = Δt(−U·∇ₕU", "− ∇ₕp / ρ + νLₕU)", "Uⁿ⁺¹ = Uⁿ + ΔU"]
    ];
    const method = language() === "zh"
      ? ({ "Weighted Jacobi": "加权 Jacobi", "Gauss–Seidel": "高斯–塞德尔" }[state.method] || state.method)
      : state.method;
    const pressureMetrics = [
      method || "",
      `${words.iteration} ${Number.isFinite(state.iteration) ? state.iteration : "—"}`,
      `${words.residual} ${format(state.residual)}`
    ];
    const details = isMac ? [
      [words.predictor,
        `${words.iteration} ${Number.isFinite(state.predictorIterations) ? state.predictorIterations : "—"}`,
        `${words.residual} ${format(state.predictorResidual)}`],
      [words.source],
      pressureMetrics,
      [words.projection, words.update]
    ] : [
      [`${words.known} Uⁿ`, words.fixed],
      pressureMetrics,
      [`${words.residual} ${format(state.residual)}`, `${words.tolerance} ${format(state.tolerance)}`],
      [words.update]
    ];
    cards.forEach((card, index) => {
      const current = index === phase;
      const status = current && state.failed ? "failed"
        : current ? "current" : index < phase ? "done" : "waiting";
      card.dataset.state = status;
      const predictorReady = Number.isFinite(state.predictorResidual) && state.predictorResidual <= 1e-7;
      card.dataset.ready = String(!state.failed && (index === pressureIndex ? reachedTolerance
        : isMac && index === 0 ? predictorReady : index <= phase));
      if (current) card.setAttribute("aria-current", "step");
      else card.removeAttribute("aria-current");
      card.querySelector(".is-card-title").textContent = words.cards[index];
      card.querySelector(".is-card-status").textContent = status === "failed" ? words.failed
        : status === "done" || current && state.complete ? words.done
        : current ? state.playing ? words.active : words.paused : words.waiting;
      setLines(card.querySelector(".is-equation"), equations[index]);
      setLines(card.querySelector(".is-detail"), details[index]);
    });
    const pressureCard = cards[pressureIndex];
    pressureCard.dataset.converged = String(reachedTolerance);
    pressureCard.querySelector(".is-feedback-text").textContent = reachedTolerance ? words.accepted
      : phase === pressureIndex && Number.isFinite(state.residual) ? words.repeat : words.check;
    root.querySelector(".is-source-label").textContent = words.layer;
    root.querySelector(".is-source-level").textContent = `n = ${sourceLayer}`;
    root.querySelector(".is-target-level").textContent = `n = ${sourceLayer + 1}`;
    root.querySelector(".is-target-label").textContent = phase === 3 && !state.failed ? words.acceptedVelocity : words.targetVelocity;
    root.querySelector(".is-time span").textContent = words.time;
    root.querySelector(".is-time strong").textContent = Number.isFinite(state.time) ? `t = ${Number(state.time.toFixed(4))}` : "—";
  }

  const languageObserver = new MutationObserver(() => update(latestState));
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  update(latestState);
  return { update };
}
