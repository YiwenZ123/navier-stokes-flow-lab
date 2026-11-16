// Original decorative illustrations. These drawings do not run the flow solvers.
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function background(ctx, w, h, start, end) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function grid(ctx, w, h, spacing, color, inset = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  for (let x = inset; x < w - inset; x += spacing) {
    ctx.moveTo(x, inset); ctx.lineTo(x, h - inset);
  }
  for (let y = inset; y < h - inset; y += spacing) {
    ctx.moveTo(inset, y); ctx.lineTo(w - inset, y);
  }
  ctx.stroke();
}

function arrow(ctx, x, y, dx, dy, color, width = 1, head = 3) {
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length, uy = dy / length;
  const ex = x + dx / 2, ey = y + dy / 2;
  const tip = Math.min(head, length * 0.38);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x - dx / 2, y - dy / 2); ctx.lineTo(ex, ey);
  ctx.moveTo(ex - tip * ux - tip * 0.6 * uy, ey - tip * uy + tip * 0.6 * ux);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex - tip * ux + tip * 0.6 * uy, ey - tip * uy - tip * 0.6 * ux);
  ctx.stroke();
}

function circle(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
}

function smoothPath(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
}

function drawAdvection(ctx, w, h) {
  background(ctx, w, h, '#eef5fb', '#f8fafc');
  const left = w * 0.075, right = w * 0.94, bottom = h * 0.83;
  grid(ctx, w, h, w / 16, 'rgba(77,112,142,.065)');
  const colors = ['rgba(141,181,216,.52)', 'rgba(88,150,202,.64)', '#216695'];
  for (let layer = 0; layer < 3; layer++) {
    const points = [];
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const q = t - layer * 0.095;
      const value = 0.74 * Math.exp(-(((q - 0.27) / 0.13) ** 2))
        + 0.28 * Math.exp(-(((q - 0.62) / 0.105) ** 2));
      points.push([left + (right - left) * t, bottom - value * h * 0.76]);
    }
    smoothPath(ctx, points);
    ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
    ctx.fillStyle = ['rgba(128,176,218,.08)', 'rgba(75,141,194,.08)', 'rgba(42,115,167,.10)'][layer];
    ctx.fill();
    smoothPath(ctx, points);
    ctx.strokeStyle = colors[layer]; ctx.lineWidth = layer === 2 ? 2.3 : 1.4; ctx.stroke();
    if (layer === 2) {
      for (let j = 8; j < points.length; j += 16) {
        const [x, y] = points[j];
        circle(ctx, x, y, 2.1, '#f6fafd');
        ctx.strokeStyle = '#216695'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,92,130,.25)'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
  arrow(ctx, w * .82, h * .2, w * .1, 0, '#629ac1', 1.2, 4);
}

function drawExplicit(ctx, w, h) {
  background(ctx, w, h, '#faf0f1', '#f3f5fb');
  const centers = [
    { x: w * .36, y: h * .42, s: 1, color: '205,98,113' },
    { x: w * .68, y: h * .63, s: -1, color: '78,131,181' }
  ];
  for (const c of centers) {
    const radius = h * .62;
    const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
    glow.addColorStop(0, `rgba(${c.color},.23)`);
    glow.addColorStop(.53, `rgba(${c.color},.09)`);
    glow.addColorStop(1, `rgba(${c.color},0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, ring * h * .067, ring * h * .067, 0, 0, TAU);
      ctx.strokeStyle = `rgba(${c.color},${.19 - ring * .025})`;
      ctx.lineWidth = .7; ctx.stroke();
    }
  }
  const spacing = Math.max(23, w / 20);
  for (let y = spacing * .5; y < h; y += spacing) {
    for (let x = spacing * .5; x < w; x += spacing) {
      let vx = .13, vy = -.035;
      for (const c of centers) {
        const dx = (x - c.x) / h, dy = (y - c.y) / h;
        const denominator = dx * dx + dy * dy + .014;
        vx += -c.s * dy * .09 / denominator;
        vy += c.s * dx * .09 / denominator;
      }
      const magnitude = Math.hypot(vx, vy);
      const length = spacing * (.2 + .5 * Math.tanh(magnitude * 1.8));
      const warm = Math.hypot(x - centers[0].x, y - centers[0].y) < Math.hypot(x - centers[1].x, y - centers[1].y);
      arrow(ctx, x, y, vx / magnitude * length, vy / magnitude * length,
        warm ? 'rgba(162,63,85,.66)' : 'rgba(39,88,137,.67)', .95, 2.6);
    }
  }
}

function drawMac(ctx, w, h) {
  background(ctx, w, h, '#edf5ee', '#f7faf6');
  const size = Math.max(26, Math.min(w / 12, h / 7.3));
  const columns = Math.ceil(w / size), rows = Math.ceil(h / size);
  const ox = (w - columns * size) / 2, oy = (h - rows * size) / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = ox + i * size, y = oy + j * size;
      const p = Math.sin((i + .5) / columns * TAU) * Math.cos((j + .5) / rows * TAU);
      ctx.fillStyle = p > 0 ? `rgba(94,155,129,${.04 + p * .12})` : `rgba(90,142,161,${.02 - p * .09})`;
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(76,116,103,.16)'; ctx.lineWidth = .7;
      ctx.strokeRect(x, y, size, size);
      circle(ctx, x + size / 2, y + size / 2, 1.45, 'rgba(63,105,85,.35)');
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const vx = .53 + .3 * Math.sin(i / columns * TAU) * Math.cos((j + .5) / rows * TAU);
      arrow(ctx, ox + i * size, oy + (j + .5) * size, size * vx * .64, 0, 'rgba(39,102,82,.63)', 1.05, 2.4);
    }
  }
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < columns; i++) {
      const vy = -.18 + .36 * Math.cos((i + .5) / columns * TAU) * Math.sin(j / rows * TAU);
      arrow(ctx, ox + (i + .5) * size, oy + j * size, 0, size * vy * .81, 'rgba(43,100,117,.55)', 1, 2.2);
    }
  }
  const i = Math.floor(columns * .54), j = Math.floor(rows * .48);
  const x = ox + i * size, y = oy + j * size;
  ctx.fillStyle = 'rgba(255,255,255,.37)'; ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.strokeStyle = '#497d68'; ctx.lineWidth = 1.6; ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
  circle(ctx, x + size / 2, y + size / 2, 3.2, '#497d68');
  circle(ctx, x + size / 2, y + size / 2, 1.4, '#f4f8ef');
}

function drawCompare(ctx, w, h) {
  background(ctx, w, h, '#f3f5f8', '#fcfaf6');
  grid(ctx, w, h, w / 14, 'rgba(71,93,115,.075)');
  const bottom = h * .83, left = w * .075, width = w * .85;
  const curves = [
    { color: '#c28a54', fill: 'rgba(198,146,87,.08)', width: .167, center: .51, scale: .67 },
    { color: '#33799c', fill: 'rgba(44,116,157,.08)', width: .135, center: .48, scale: .76 }
  ];
  for (const curve of curves) {
    const points = [];
    for (let i = 0; i <= 250; i++) {
      const t = i / 250;
      const value = curve.scale * Math.exp(-(((t - curve.center) / curve.width) ** 2))
        + .09 * Math.exp(-(((t - .78) / .055) ** 2));
      points.push([left + t * width, bottom - value * h * .86]);
    }
    smoothPath(ctx, points); ctx.lineTo(left + width, bottom); ctx.lineTo(left, bottom);
    ctx.closePath(); ctx.fillStyle = curve.fill; ctx.fill();
    smoothPath(ctx, points); ctx.strokeStyle = curve.color; ctx.lineWidth = 2.1; ctx.stroke();
    for (let i = 10; i < points.length; i += 20) circle(ctx, points[i][0], points[i][1], 1.75, curve.color);
  }
  ctx.strokeStyle = 'rgba(60,85,108,.3)'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(left + width, bottom); ctx.stroke();
}

function drawWaves(ctx, w, h) {
  background(ctx, w, h, '#edf8f8', '#dceff0');
  const surface = h * .43;
  const contour = (x, depth) => {
    const t = x / w;
    const envelope = Math.exp(-(((t - .39) / .35) ** 2));
    return surface + depth * h * .048
      - h * .105 * Math.sin(t * TAU * 1.7 - .8 + depth * .065) * envelope * Math.exp(-depth * .055);
  };
  const water = [];
  for (let x = -2; x <= w + 4; x += 3) water.push([x, contour(x, 0)]);
  smoothPath(ctx, water); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const fill = ctx.createLinearGradient(0, surface, 0, h);
  fill.addColorStop(0, 'rgba(108,188,191,.19)'); fill.addColorStop(1, 'rgba(71,151,162,.035)');
  ctx.fillStyle = fill; ctx.fill();
  for (let d = 14; d >= 0; d--) {
    const points = [];
    for (let x = -2; x <= w + 4; x += 3) points.push([x, contour(x, d)]);
    smoothPath(ctx, points);
    ctx.strokeStyle = d === 0 ? '#388b99' : `rgba(48,133,146,${.12 + (14 - d) * .014})`;
    ctx.lineWidth = d === 0 ? 1.9 : .9; ctx.stroke();
  }
  const side = Math.min(w * .18, h * .30), x = w * .63, y = h * .34;
  const dx = side * .4, dy = -side * .3;
  const polygon = (points, color, stroke) => {
    smoothPath(ctx, points); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  };
  polygon([[x, y + side], [x + side, y + side], [x + side + dx, y + side + dy], [x + dx, y + side + dy]], 'rgba(31,104,119,.09)', 'rgba(31,104,119,0)');
  polygon([[x, y], [x + side, y], [x + side, y + side], [x, y + side]], '#eaf5f5', '#83b3b9');
  polygon([[x + side, y], [x + side + dx, y + dy], [x + side + dx, y + side + dy], [x + side, y + side]], '#c4dfe2', '#83b3b9');
  polygon([[x, y], [x + dx, y + dy], [x + side + dx, y + dy], [x + side, y]], '#fcfefe', '#83b3b9');
  // Short contours resume downstream of the solid, making its footprint readable.
  ctx.save();
  ctx.beginPath(); ctx.rect(x + side + dx + 4, y + side * .45, w, h); ctx.clip();
  for (let d = 1; d < 6; d++) {
    ctx.beginPath();
    ctx.ellipse(x + side * .65, y + side * .72, side * (.7 + d * .25), side * (.13 + d * .08), -.08, -.65, .7);
    ctx.strokeStyle = `rgba(46,125,139,${.2 - d * .02})`; ctx.lineWidth = .8; ctx.stroke();
  }
  ctx.restore();
}

const staticDrawers = { advection: drawAdvection, explicit: drawExplicit, mac: drawMac, compare: drawCompare, waves: drawWaves };

// Streamlines are contours of the analytic cylinder streamfunction, not a simulation.
function buildHero(record, doc) {
  const { width: w, height: h, ratio } = record;
  const buffer = doc.createElement('canvas');
  buffer.width = Math.round(w * ratio); buffer.height = Math.round(h * ratio);
  const ctx = buffer.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  background(ctx, w, h, '#f0f7fc', '#edf6f5');
  const glow = ctx.createRadialGradient(w * .55, h * .5, 0, w * .55, h * .5, w * .55);
  glow.addColorStop(0, 'rgba(255,255,255,.78)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  grid(ctx, w, h, Math.max(38, h / 8), 'rgba(80,129,149,.035)');
  const cx = w * .59, cy = h * .51, radius = Math.min(h * .195, w * .15);
  const spacing = h / 44, lines = [], count = 58;
  for (let line = 0; line < count; line++) {
    const psi = (line - (count - 1) / 2) * spacing;
    const sign = Math.sign(psi), value = Math.abs(psi), points = [], lengths = [0];
    for (let i = 0; i <= 280; i++) {
      const x = -16 + (w + 32) * i / 280, relativeX = x - cx;
      let low = Math.max(value, Math.sqrt(Math.max(0, radius * radius - relativeX * relativeX)));
      let high = value + radius + 1;
      for (let iteration = 0; iteration < 22; iteration++) {
        const mid = (low + high) / 2;
        const stream = mid * (1 - radius * radius / (relativeX * relativeX + mid * mid));
        if (stream < value) low = mid; else high = mid;
      }
      const point = [x, cy + sign * (low + high) / 2];
      if (points.length) {
        const previous = points[points.length - 1];
        lengths.push(lengths[lengths.length - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]));
      }
      points.push(point);
    }
    const blend = clamp((line - 5) / (count - 10), 0, 1);
    const color = `rgb(${Math.round(21 + blend * 96)},${Math.round(78 + blend * 106)},${Math.round(109 + blend * 75)})`;
    smoothPath(ctx, points); ctx.strokeStyle = color;
    ctx.globalAlpha = .42 + .18 * Math.sin(blend * Math.PI);
    ctx.lineWidth = line % 4 === 0 ? 1 : .7; ctx.stroke(); ctx.globalAlpha = 1;
    if (line % 3 === 1) lines.push({ points, lengths, total: lengths[lengths.length - 1], color, seed: (line * .61803398875) % 1 });
  }
  circle(ctx, cx, cy, radius, '#ffffff');
  ctx.strokeStyle = 'rgba(89,142,160,.20)'; ctx.lineWidth = 1; ctx.stroke();
  record.hero = { buffer, lines, radius, cx, cy };
}

function drawHero(record, phase) {
  const { ctx, width: w, height: h, hero } = record;
  if (!hero) return;
  ctx.drawImage(hero.buffer, 0, 0, w, h);
  for (const line of hero.lines) {
    const distance = (phase * Math.max(34, w * .043) + line.seed * line.total) % line.total;
    let low = 0, high = line.lengths.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (line.lengths[middle] < distance) low = middle; else high = middle;
    }
    const fraction = (distance - line.lengths[low]) / (line.lengths[high] - line.lengths[low]);
    const a = line.points[low], b = line.points[high];
    const x = a[0] + (b[0] - a[0]) * fraction, y = a[1] + (b[1] - a[1]) * fraction;
    circle(ctx, x, y, 4.5, 'rgba(255,255,255,.48)');
    circle(ctx, x, y, 1.8, line.color);
  }
}

/** Mount decorative canvas art. The returned pause state represents user intent. */
export function mountHomeArt(root = document) {
  const doc = root.ownerDocument || root;
  const win = doc.defaultView || window;
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = media.matches, destroyed = false, frame = 0, phase = 0;
  let previousTime = 0, previousPaint = 0;
  const canvases = [...root.querySelectorAll('canvas[data-home-art]')];
  if (root.matches?.('canvas[data-home-art]')) canvases.unshift(root);
  const records = canvases.map(canvas => ({
    canvas, ctx: canvas.getContext('2d', { alpha: false }), type: canvas.dataset.homeArt,
    width: 0, height: 0, ratio: 1, visible: false, hero: null
  })).filter(record => record.ctx && (record.type === 'hero' || staticDrawers[record.type]));
  const byCanvas = new Map(records.map(record => [record.canvas, record]));

  function draw(record) {
    if (!record.width || !record.height) return;
    if (record.type === 'hero') drawHero(record, phase);
    else staticDrawers[record.type](record.ctx, record.width, record.height);
  }

  function fit(record) {
    const rect = record.canvas.getBoundingClientRect();
    const w = Math.max(0, rect.width), h = Math.max(0, rect.height);
    const ratio = Math.min(win.devicePixelRatio || 1, 2);
    if (!w || !h) { record.width = w; record.height = h; return; }
    if (w === record.width && h === record.height && ratio === record.ratio) return;
    record.width = w; record.height = h; record.ratio = ratio;
    record.canvas.width = Math.round(w * ratio); record.canvas.height = Math.round(h * ratio);
    record.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (record.type === 'hero') buildHero(record, doc);
    draw(record);
  }

  const active = () => !destroyed && !paused && !doc.hidden && records.some(record => record.type === 'hero' && record.visible && record.width && record.height);
  function tick(time) {
    frame = 0;
    if (!active()) return;
    if (previousTime) phase += Math.min((time - previousTime) / 1000, .1);
    previousTime = time;
    if (!previousPaint || time - previousPaint >= 1000 / 24) {
      for (const record of records) if (record.type === 'hero' && record.visible) drawHero(record, phase);
      previousPaint = time;
    }
    frame = win.requestAnimationFrame(tick);
  }
  function synchronize() {
    if (!active()) {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0; previousTime = 0; previousPaint = 0;
    } else if (!frame) {
      previousTime = 0; previousPaint = 0;
      frame = win.requestAnimationFrame(tick);
    }
  }
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = byCanvas.get(entry.target);
      if (record) record.visible = entry.isIntersecting;
    }
    synchronize();
  }, { threshold: 0 }) : null;
  const resize = win.ResizeObserver ? new win.ResizeObserver(entries => {
    for (const entry of entries) { const record = byCanvas.get(entry.target); if (record) fit(record); }
    synchronize();
  }) : null;
  const handleResize = () => {
    for (const record of records) {
      fit(record);
      if (!intersection) {
        const rect = record.canvas.getBoundingClientRect();
        record.visible = rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth;
      }
    }
    synchronize();
  };
  const handleMotion = event => { paused = event.matches; synchronize(); };
  for (const record of records) {
    const rect = record.canvas.getBoundingClientRect();
    record.visible = rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth;
    fit(record); resize?.observe(record.canvas);
    if (record.type === 'hero') intersection?.observe(record.canvas);
  }
  doc.addEventListener('visibilitychange', synchronize);
  win.addEventListener('resize', handleResize, { passive: true });
  if (!intersection) win.addEventListener('scroll', handleResize, { passive: true });
  media.addEventListener?.('change', handleMotion);
  synchronize();
  return {
    setPaused(value) { paused = Boolean(value); synchronize(); },
    isPaused() { return paused; },
    destroy() {
      destroyed = true; synchronize(); intersection?.disconnect(); resize?.disconnect();
      doc.removeEventListener('visibilitychange', synchronize);
      win.removeEventListener('resize', handleResize); win.removeEventListener('scroll', handleResize);
      media.removeEventListener?.('change', handleMotion);
    }
  };
}
