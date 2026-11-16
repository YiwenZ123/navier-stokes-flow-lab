import { runComparison, runStabilitySweep } from "./compare-solver.js";

self.addEventListener("message", ({ data }) => {
  const { requestId, presetId, dt, iterationOptions = {} } = data;
  try {
    const result = runComparison(presetId, { dt, ...iterationOptions });
    self.postMessage({ requestId, type: "result", result });
    const rows = runStabilitySweep(presetId, iterationOptions);
    self.postMessage({ requestId, type: "sweep", rows });
  } catch (error) {
    self.postMessage({ requestId, type: "error", message: error.message || "计算未完成。" });
  }
});
