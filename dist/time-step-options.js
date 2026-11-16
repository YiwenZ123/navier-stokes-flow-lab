export const DT_OPTIONS = Object.freeze([0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 1.2]);
export const COMPARISON_END_TIME = 12;
export const DEMO_END_TIME = 1.2;
export const GROWTH_WARNING = 2;
export const GROWTH_STOP = 20;

export function normalizeTimeStep(value) {
  if (value === null || value === undefined || value === "") return 0.1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0.1;
  return DT_OPTIONS.reduce((nearest, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(nearest - numeric) ? candidate : nearest
  );
}
