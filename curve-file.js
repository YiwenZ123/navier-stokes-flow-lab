import { normalizeCurve } from './custom-profile.js?v=341dbc61d218';

export const MAX_CURVE_FILE_BYTES = 65536;
const FORMAT = 'navier-stokes-flow-lab.initial-condition';

export class CurveFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CurveFileError';
    this.code = code;
  }
}

function checkedCurve(value) {
  // The editor normalizer deliberately links endpoint heights. A file must
  // already be consistent; importing must never silently change its values.
  if (value?.periodic === true && Array.isArray(value.points)
    && Array.isArray(value.points[0]) && Array.isArray(value.points.at(-1))
    && !Object.is(value.points[0][1], value.points.at(-1)[1])) {
    throw new CurveFileError('curve', 'Linked endpoint values must match exactly');
  }
  try {
    return normalizeCurve(value);
  } catch {
    throw new CurveFileError('curve', 'Invalid initial-condition control points or interpolation settings');
  }
}

const isPair = (value, left, right) => Array.isArray(value)
  && value.length === 2 && value[0] === left && value[1] === right;

export function parseCurveFile(text) {
  if (typeof text !== 'string') throw new CurveFileError('json', 'Expected JSON text');
  // Check code-unit length first to avoid allocating an encoded copy of an
  // arbitrarily large string. UTF-8 always uses at least this many bytes.
  if (text.length > MAX_CURVE_FILE_BYTES || new TextEncoder().encode(text).length > MAX_CURVE_FILE_BYTES) {
    throw new CurveFileError('size', 'Curve files must be no larger than 64 KiB');
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new CurveFileError('json', 'The file is not valid JSON');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || document.format !== FORMAT || document.version !== 1
    || !isPair(document.domain, -1, 1) || !isPair(document.range, 0, 1)) {
    throw new CurveFileError('format', 'Unsupported curve format, version, domain or range');
  }
  return checkedCurve(document.curve);
}

// Number#toString is a lossless round trip for finite doubles; handle −0
// explicitly because JSON.stringify would otherwise turn it into +0.
const numberText = value => Object.is(value, -0) ? '-0' : JSON.stringify(value);

export function serializeCurve(value) {
  const curve = checkedCurve(value);
  const points = curve.points.map(point => `      [${point.map(numberText).join(', ')}]`).join(',\n');
  return [
    '{',
    `  "format": "${FORMAT}",`,
    '  "version": 1,',
    '  "domain": [-1, 1],',
    '  "range": [0, 1],',
    '  "curve": {',
    '    "points": [',
    points,
    '    ],',
    `    "mode": ${JSON.stringify(curve.mode)},`,
    `    "periodic": ${curve.periodic}`,
    '  }',
    '}',
    '',
  ].join('\n');
}
