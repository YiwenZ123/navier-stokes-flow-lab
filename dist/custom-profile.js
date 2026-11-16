/* Shared curve interpolation for the editor, grid samples and exact transport.
 * No DOM, storage, network access or mutable external references are retained.
 */
export const DEFAULT_CURVE = Object.freeze({
  points: Object.freeze([
    Object.freeze([-1, .25]),
    Object.freeze([0.001617164723032083, 0.758692286036036]),
    Object.freeze([1, .25]),
  ]),
  mode: 'smooth',
  periodic: true,
});

export function normalizeCurve(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.points)
    || value.points.length < 2 || value.points.length > 18
    || !['smooth', 'linear'].includes(value.mode) || typeof value.periodic !== 'boolean') {
    throw new RangeError('A curve needs 2–18 points, smooth/linear mode and a boolean periodic flag');
  }
  const points = value.points.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
      || point[0] < -1 || point[0] > 1 || point[1] < 0 || point[1] > 1
      || (index > 0 && point[0] - value.points[index - 1][0] < .035 - 1e-12)) {
      throw new RangeError('Curve coordinates must be finite, ordered, spaced by at least 0.035 and within x∈[−1,1], u∈[0,1]');
    }
    return [point[0], point[1]];
  });
  if (points[0][0] !== -1 || points.at(-1)[0] !== 1) {
    throw new RangeError('The first and last curve coordinates must be x=−1 and x=1');
  }
  if (value.periodic) points.at(-1)[1] = points[0][1];
  return { points, mode: value.mode, periodic: value.periodic };
}

// PCHIP weighted harmonic means preserve each segment's endpoint range.
// With linked endpoints, both derivatives use the intervals across the seam.
export function makeSlopes(points, periodic) {
  const n = points.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1][0] - points[i][0]);
    d.push((points[i + 1][1] - points[i][1]) / h[i]);
  }
  function mean(dl, dr, hl, hr) {
    if (dl * dr <= 0) return 0;
    const w1 = 2 * hr + hl, w2 = hr + 2 * hl;
    return (w1 + w2) / (w1 / dl + w2 / dr);
  }
  for (let i = 1; i < n - 1; i++) m[i] = mean(d[i - 1], d[i], h[i - 1], h[i]);
  if (periodic) m[0] = m[n - 1] = mean(d[n - 2], d[0], h[n - 2], h[0]);
  else if (n === 2) m[0] = m[1] = d[0];
  else {
    function edge(d0, d1, h0, h1) {
      const v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (v * d0 <= 0) return 0;
      if (d0 * d1 < 0 && Math.abs(v) > Math.abs(3 * d0)) return 3 * d0;
      return v;
    }
    m[0] = edge(d[0], d[1], h[0], h[1]);
    m[n - 1] = edge(d[n - 2], d[n - 3], h[n - 2], h[n - 3]);
  }
  return m;
}

// Editor evaluation includes the right endpoint (the left limit at a jump).
export function interpolate(points, slopes, x, mode) {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points.at(-1)[0]) return points.at(-1)[1];
  let i = 0;
  while (i < points.length - 2 && x > points[i + 1][0]) i++;
  const h = points[i + 1][0] - points[i][0], q = (x - points[i][0]) / h;
  if (mode === 'linear') return (1 - q) * points[i][1] + q * points[i + 1][1];
  const q2 = q * q, q3 = q2 * q;
  return (2 * q3 - 3 * q2 + 1) * points[i][1] + (q3 - 2 * q2 + q) * h * slopes[i]
    + (-2 * q3 + 3 * q2) * points[i + 1][1] + (q3 - q2) * h * slopes[i + 1];
}

export function createCurveProfile(value = DEFAULT_CURVE) {
  const normalized = normalizeCurve(value);
  const curve = Object.freeze({
    points: Object.freeze(normalized.points.map(point => Object.freeze(point))),
    mode: normalized.mode,
    periodic: normalized.periodic,
  });
  const slopes = makeSlopes(curve.points, curve.periodic);
  function at(x) {
    if (!Number.isFinite(x)) throw new RangeError('A profile coordinate must be finite');
    const wrapped = x - 2 * Math.floor((x + 1) / 2);
    return interpolate(curve.points, slopes, wrapped, curve.mode);
  }
  function sample(N) {
    if (!Number.isInteger(N) || N < 2 || N > 10000) throw new RangeError('N must be an integer from 2 to 10000');
    // Include x=−1 and exclude x=1, so the periodic node is not duplicated.
    return Float64Array.from({ length: N }, (_, i) => at(-1 + 2 * i / N));
  }
  return Object.freeze({ curve, value: at, sample });
}
