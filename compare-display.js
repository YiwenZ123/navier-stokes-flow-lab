// One display scale is shared by both velocity-perturbation fields.
// Keep it independent of the solver and the selected animation frame.
export const DEFAULT_FIELD_MAX = 0.5;

export function parseFieldMaximum(value) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) {
    throw new RangeError('Enter a positive finite velocity scale.');
  }
  const maximum = Number(value);
  if (!Number.isFinite(maximum) || !(maximum > 0) || !Number.isFinite(1 / maximum)) {
    throw new RangeError('The velocity scale must be positive, finite, and representable.');
  }
  return maximum;
}

export function fieldPeak(frame, { driftX = 0, driftY = 0 } = {}) {
  let peak = 0;
  for (const method of ['explicit', 'mac']) {
    const field = frame?.[method];
    if (!field?.u || !field?.v) continue;
    const count = Math.min(field.u.length, field.v.length);
    for (let index = 0; index < count; index++) {
      const speed = Math.hypot(field.u[index] - driftX, field.v[index] - driftY);
      if (Number.isFinite(speed)) peak = Math.max(peak, speed);
    }
  }
  return peak;
}

export function fitFieldMaximum(frame, settings) {
  const peak = fieldPeak(frame, settings);
  if (!(peak > 0) || !Number.isFinite(1 / peak)) return DEFAULT_FIELD_MAX;
  // Round outward to two significant digits. Near the numeric limits, keep
  // the finite peak if the decimal rounding would overflow or underflow.
  const increment = 10 ** (Math.floor(Math.log10(peak)) - 1);
  let maximum = Number(peak.toPrecision(2));
  if (maximum < peak) maximum = Number((maximum + increment).toPrecision(2));
  return Number.isFinite(maximum) ? Math.max(peak, maximum) : peak;
}

export function fieldVector(du, dv, maximum = DEFAULT_FIELD_MAX) {
  maximum = parseFieldMaximum(maximum);
  const speed = Math.hypot(du, dv);
  if (!Number.isFinite(du) || !Number.isFinite(dv) || !Number.isFinite(speed) || speed === 0) {
    return { alpha: 0, x: 0, y: 0, clipped: false };
  }
  const clipped = speed > maximum;
  // Divide by speed when saturated, preserving direction without allowing
  // unstable field values to draw arrows across the whole canvas.
  const divisor = clipped ? speed : maximum;
  return {
    alpha: 0.68 * Math.min(1, speed / maximum),
    x: du / divisor,
    y: dv / divisor,
    clipped
  };
}
