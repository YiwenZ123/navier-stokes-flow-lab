// Display ranges use Pa internally; only the editable inputs use kPa.
export const DEFAULT_PRESSURE_RANGE = Object.freeze({ minimum: -5000, maximum: 20000 });

function validateRange(range) {
  const { minimum, maximum } = range || {};
  const span = maximum - minimum;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)
    || !Number.isFinite(span) || !(span > 0)) {
    throw new RangeError('Pressure limits must be finite and increasing, with a finite positive span.');
  }
  return span;
}

function frozenRange(minimum, maximum) {
  const range = { minimum, maximum };
  validateRange(range);
  return Object.freeze(range);
}

function kilopascals(value) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) {
    throw new RangeError('Enter both pressure limits in kPa.');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError('Pressure limits must be finite numbers.');
  return number;
}

export function createPressureRange(minimumKPa, maximumKPa) {
  return frozenRange(kilopascals(minimumKPa) * 1000, kilopascals(maximumKPa) * 1000);
}

export function pressureColor(pressurePa, range = DEFAULT_PRESSURE_RANGE) {
  const span = validateRange(range);
  if (!Number.isFinite(pressurePa)) throw new RangeError('Pressure must be finite.');
  const fraction = Math.max(0, Math.min(1, (pressurePa - range.minimum) / span));
  return `rgb(${Math.round(167 + 64 * fraction)}, ${Math.round(217 - 91 * fraction)}, ${Math.round(247 - 192 * fraction)})`;
}

export function pressureExtent(pressure, liquid) {
  if (!pressure || !liquid || !Number.isSafeInteger(pressure.length)
    || pressure.length < 0 || pressure.length !== liquid.length) {
    throw new RangeError('Pressure and liquid arrays must have the same length.');
  }
  let minimum = Infinity, maximum = -Infinity;
  for (let index = 0; index < pressure.length; index++) {
    if (!liquid[index] || !Number.isFinite(pressure[index])) continue;
    minimum = Math.min(minimum, pressure[index]);
    maximum = Math.max(maximum, pressure[index]);
  }
  return minimum === Infinity ? null : { minimum, maximum };
}

export function fitPressureRange(pressure, liquid) {
  const extent = pressureExtent(pressure, liquid);
  if (!extent) return DEFAULT_PRESSURE_RANGE;
  let minimum = Math.floor(Math.min(0, extent.minimum) / 1000) * 1000;
  let maximum = Math.ceil(Math.max(0, extent.maximum) / 1000) * 1000;
  // Preserve outward rounding even for tiny values whose division underflows.
  if (minimum > extent.minimum) minimum -= 1000;
  if (maximum < extent.maximum) maximum += 1000;
  if (minimum === maximum) maximum = minimum + 1000;
  return frozenRange(minimum === 0 ? 0 : minimum, maximum);
}
