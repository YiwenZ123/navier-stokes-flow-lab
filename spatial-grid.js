// All demonstrations use the same physical spacing on a 2π × 2π domain.
const intervals = 18;
const length = 2 * Math.PI;

export const SPATIAL_GRID = Object.freeze({ intervals, length, h: length / intervals });

export function spatialGridSummary() {
  return `空间步长 Δx = Δy = 2π/${intervals} ≈ ${SPATIAL_GRID.h.toFixed(4)}`;
}
