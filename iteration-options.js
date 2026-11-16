export const ITERATION_METHODS = Object.freeze([
  Object.freeze({ id: "jacobi", label: "Jacobi" }),
  Object.freeze({ id: "gauss-seidel", label: "Gauss–Seidel" }),
  Object.freeze({ id: "sor", label: "SOR" })
]);

export const SOR_OMEGAS = Object.freeze([1, 1.1, 1.2, 1.3, 1.5, 1.7, 1.9]);

export function normalizeIterationMethod(value) {
  return ITERATION_METHODS.some(method => method.id === value) ? value : "jacobi";
}

export function normalizeSorOmega(value, fallback = 1.5) {
  const numeric = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(numeric)
    || numeric < 1 || numeric >= 2) return fallback;
  return SOR_OMEGAS.reduce((nearest, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(nearest - numeric) ? candidate : nearest
  );
}

export function normalizeIterationOptions(input = {}) {
  return {
    pressureMethod: normalizeIterationMethod(input.pressureMethod),
    pressureOmega: normalizeSorOmega(input.pressureOmega),
    predictorMethod: normalizeIterationMethod(input.predictorMethod),
    predictorOmega: normalizeSorOmega(input.predictorOmega, 1.1)
  };
}
