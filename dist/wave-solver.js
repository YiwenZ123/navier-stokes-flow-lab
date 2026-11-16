// Liquid-only MAC projection with material markers and atmospheric free surfaces.
// Positions are metres, velocities m/s, pressure Pa relative to atmosphere.
export function createWaveSolver(options = {}) {
  const nx = Math.max(40, Math.min(120, Math.round((options.resolution ?? 80) / 4) * 4));
  const ny = nx / 2;
  const width = 4;
  const height = 2;
  const h = width / nx;
  const density = 1000;
  const gravity = 9.81;
  const viscosity = Math.max(0, options.viscosity ?? 1e-6);
  const scenario = ['pulse', 'dam-break', 'still'].includes(options.scenario) ? options.scenario : 'pulse';
  const amplitude = Math.max(0, Math.min(0.25, options.amplitude ?? 0.12));
  const depth = 0.5;
  const geometry = typeof options.obstacle === 'object' && options.obstacle !== null ? options.obstacle : {};
  const shape = ['square', 'circle', 'triangle'].includes(geometry.shape) ? geometry.shape : 'square';
  const requestedSize = Number(geometry.size ?? 0.7);
  const obstacleSize = Math.max(0.2, Math.min(1.2, Number.isFinite(requestedSize) ? requestedSize : 0.7));
  const requestedX = Number(geometry.centerX ?? geometry.x ?? 2.75);
  const requestedY = Number(geometry.bottomY ?? geometry.y ?? 0);
  const centerX = Math.max(obstacleSize / 2 + h,
    Math.min(width - obstacleSize / 2 - h, Number.isFinite(requestedX) ? requestedX : 2.75));
  const bottomY = Math.max(0,
    Math.min(height - obstacleSize - h, Number.isFinite(requestedY) ? requestedY : 0));
  const obstacle = options.obstacle === false ? null : {
    shape, size: obstacleSize, centerX, bottomY,
    x: centerX - obstacleSize / 2, y: bottomY,
    width: obstacleSize, height: obstacleSize
  };
  const cells = nx * ny;
  const u = new Float64Array((nx + 1) * ny);
  const v = new Float64Array(nx * (ny + 1));
  const nextU = new Float64Array(u.length);
  const nextV = new Float64Array(v.length);
  const pressure = new Float64Array(cells);
  const solid = new Uint8Array(cells);
  const mask = new Uint8Array(cells);
  const projectedMask = new Uint8Array(cells);
  const liquid = new Float64Array(cells);
  const counts = new Uint16Array(cells);
  const q = new Float64Array(cells);
  const rhs = new Float64Array(cells);
  const diagonal = new Float64Array(cells);
  const residual = new Float64Array(cells);
  const direction = new Float64Array(cells);
  const product = new Float64Array(cells);
  const preconditioned = new Float64Array(cells);
  const particles = [];
  const active = [];
  const validU = new Uint8Array(u.length);
  const validV = new Uint8Array(v.length);
  const extrapolationScratch = new Float64Array(Math.max(u.length, v.length));
  const extrapolationFlags = new Uint8Array(extrapolationScratch.length);
  let initialVolume = 0;
  let initialGridVolume = 0;
  const markerVolume = h * h / 4;
  const state = {
    time: 0, u, v, pressure, solid, mask, projectedMask, liquid, particles,
    maxDivergence: 0, pressureResidual: 0, pressureIterations: 0,
    wallPressure: 0, forceX: 0, gridVolumeError: 0, gridVolume: 0, projectionDt: 0,
    dt: 0, failed: false, message: '', maxSpeed: 0,
    waterVolume: 0, initialVolume: 0, kineticEnergy: 0
  };

  function insideObstacle(x, y) {
    if (!obstacle || x < obstacle.x || x > obstacle.x + obstacle.width
      || y < obstacle.y || y > obstacle.y + obstacle.height) return false;
    if (obstacle.shape === 'circle') {
      const radius = obstacle.size / 2;
      return (x - obstacle.centerX) ** 2 + (y - obstacle.bottomY - radius) ** 2 <= radius ** 2;
    }
    if (obstacle.shape === 'triangle') {
      // Upright isosceles triangle, with both base width and height equal to size.
      const halfWidth = (obstacle.size - (y - obstacle.bottomY)) / 2;
      return Math.abs(x - obstacle.centerX) <= halfWidth;
    }
    return true;
  }

  function cellType(i, j) {
    if (i < 0 || i >= nx || j < 0 || j >= ny) return 2;
    const index = j * nx + i;
    return solid[index] ? 2 : mask[index];
  }

  function classify() {
    counts.fill(0);
    for (const particle of particles) {
      const i = Math.max(0, Math.min(nx - 1, Math.floor(particle.x / h)));
      const j = Math.max(0, Math.min(ny - 1, Math.floor(particle.y / h)));
      counts[j * nx + i]++;
    }
    active.length = 0;
    let occupiedArea = 0;
    for (let index = 0; index < cells; index++) {
      mask[index] = !solid[index] && counts[index] > 0 ? 1 : 0;
      liquid[index] = mask[index];
      if (mask[index]) active.push(index);
      occupiedArea += liquid[index] * h * h;
    }
    state.waterVolume = particles.length * markerVolume;
    state.gridVolume = occupiedArea;
    // Coarse geometric area, not a conservation claim based on fixed marker count.
    state.gridVolumeError = initialGridVolume ? 100 * (occupiedArea / initialGridVolume - 1) : 0;
  }

  function enforceWalls() {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (cellType(i - 1, j) === 2 || cellType(i, j) === 2) u[j * (nx + 1) + i] = 0;
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (cellType(i, j - 1) === 2 || cellType(i, j) === 2) v[j * nx + i] = 0;
      }
    }
  }

  function sample(values, columns, rows, x, y, offsetX, offsetY) {
    const gx = Math.max(0, Math.min(columns - 1, x / h - offsetX));
    const gy = Math.max(0, Math.min(rows - 1, y / h - offsetY));
    const i = Math.min(columns - 2, Math.floor(gx));
    const j = Math.min(rows - 2, Math.floor(gy));
    const fx = gx - i;
    const fy = gy - j;
    const low = values[j * columns + i] * (1 - fx) + values[j * columns + i + 1] * fx;
    const high = values[(j + 1) * columns + i] * (1 - fx) + values[(j + 1) * columns + i + 1] * fx;
    return low * (1 - fy) + high * fy;
  }

  function velocityAt(x, y) {
    return {
      u: sample(u, nx + 1, ny, x, y, 0, 0.5),
      v: sample(v, nx, ny + 1, x, y, 0.5, 0)
    };
  }

  function extend(values, valid, columns, rows) {
    // Only the air-side interpolation stencil needs extrapolated velocity.
    for (let pass = 0; pass < 3; pass++) {
      extrapolationScratch.set(values);
      extrapolationFlags.set(valid);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
          const index = j * columns + i;
          if (valid[index]) continue;
          let sum = 0;
          let count = 0;
          if (i > 0 && valid[index - 1]) { sum += values[index - 1]; count++; }
          if (i + 1 < columns && valid[index + 1]) { sum += values[index + 1]; count++; }
          if (j > 0 && valid[index - columns]) { sum += values[index - columns]; count++; }
          if (j + 1 < rows && valid[index + columns]) { sum += values[index + columns]; count++; }
          if (count) {
            extrapolationScratch[index] = sum / count;
            extrapolationFlags[index] = 1;
          }
        }
      }
      values.set(extrapolationScratch.subarray(0, values.length));
      valid.set(extrapolationFlags.subarray(0, valid.length));
    }
  }

  function extrapolateVelocity() {
    validU.fill(0);
    validV.fill(0);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        validU[j * (nx + 1) + i] = cellType(i - 1, j) === 1 || cellType(i, j) === 1 ? 1 : 0;
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        validV[j * nx + i] = cellType(i, j - 1) === 1 || cellType(i, j) === 1 ? 1 : 0;
      }
    }
    extend(u, validU, nx + 1, ny);
    extend(v, validV, nx, ny + 1);
    enforceWalls();
  }

  function advectComponent(values, target, columns, rows, ox, oy, dt) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const x = (i + ox) * h;
        const y = (j + oy) * h;
        const first = velocityAt(x, y);
        const middle = velocityAt(x - first.u * dt / 2, y - first.v * dt / 2);
        const index = j * columns + i;
        const laplacian = (values[j * columns + Math.max(0, i - 1)]
          + values[j * columns + Math.min(columns - 1, i + 1)]
          + values[Math.max(0, j - 1) * columns + i]
          + values[Math.min(rows - 1, j + 1) * columns + i] - 4 * values[index]) / (h * h);
        target[index] = sample(values, columns, rows, x - middle.u * dt, y - middle.v * dt, ox, oy)
          + dt * viscosity * laplacian;
      }
    }
  }

  function divergence(index) {
    const i = index % nx;
    const j = Math.floor(index / nx);
    return (u[j * (nx + 1) + i + 1] - u[j * (nx + 1) + i]
      + v[(j + 1) * nx + i] - v[j * nx + i]) / h;
  }

  function applyMatrix(input, output) {
    for (const index of active) {
      const i = index % nx;
      const j = Math.floor(index / nx);
      let value = diagonal[index] * input[index];
      if (i > 0 && mask[index - 1]) value -= input[index - 1];
      if (i + 1 < nx && mask[index + 1]) value -= input[index + 1];
      if (j > 0 && mask[index - nx]) value -= input[index - nx];
      if (j + 1 < ny && mask[index + nx]) value -= input[index + nx];
      output[index] = value;
    }
  }

  function project(dt) {
    projectedMask.set(mask);
    state.projectionDt = dt;
    for (let index = 0; index < cells; index++) q[index] = mask[index] ? pressure[index] * dt / density : 0;
    for (const index of active) {
      const i = index % nx;
      const j = Math.floor(index / nx);
      diagonal[index] = 0;
      for (const type of [cellType(i - 1, j), cellType(i + 1, j), cellType(i, j - 1), cellType(i, j + 1)]) {
        // Atmospheric p=0 at a fluid/air face, half a cell from liquid centre.
        diagonal[index] += type === 1 ? 1 : type === 0 ? 2 : 0;
      }
      rhs[index] = -divergence(index) * h * h;
    }
    applyMatrix(q, product);
    let rz = 0;
    let maximum = 0;
    for (const index of active) {
      residual[index] = rhs[index] - product[index];
      direction[index] = residual[index] / diagonal[index];
      rz += residual[index] * direction[index];
      maximum = Math.max(maximum, Math.abs(residual[index]));
    }
    const tolerance = 1e-5 * h * h;
    let iteration = 0;
    while (maximum > tolerance && iteration < 300) {
      applyMatrix(direction, product);
      let curvature = 0;
      for (const index of active) curvature += direction[index] * product[index];
      if (!(curvature > 0)) break;
      const alpha = rz / curvature;
      maximum = 0;
      let nextRz = 0;
      for (const index of active) {
        q[index] += alpha * direction[index];
        residual[index] -= alpha * product[index];
        preconditioned[index] = residual[index] / diagonal[index];
        nextRz += residual[index] * preconditioned[index];
        maximum = Math.max(maximum, Math.abs(residual[index]));
      }
      const beta = nextRz / rz;
      for (const index of active) direction[index] = preconditioned[index] + beta * direction[index];
      rz = nextRz;
      iteration++;
    }
    applyMatrix(q, product);
    maximum = 0;
    for (const index of active) maximum = Math.max(maximum, Math.abs(rhs[index] - product[index]) / (h * h));
    state.pressureResidual = maximum * density / dt;
    state.pressureIterations = iteration;
    for (let index = 0; index < cells; index++) pressure[index] = mask[index] ? q[index] * density / dt : 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const left = cellType(i - 1, j);
        const right = cellType(i, j);
        if (left === 2 || right === 2 || (left === 0 && right === 0)) continue;
        const factor = left === 0 || right === 0 ? 2 : 1;
        u[j * (nx + 1) + i] -= factor * (q[j * nx + i] - q[j * nx + i - 1]) / h;
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const below = cellType(i, j - 1);
        const above = cellType(i, j);
        if (below === 2 || above === 2 || (below === 0 && above === 0)) continue;
        const factor = below === 0 || above === 0 ? 2 : 1;
        v[j * nx + i] -= factor * (q[j * nx + i] - q[(j - 1) * nx + i]) / h;
      }
    }
    enforceWalls();
    state.maxDivergence = 0;
    for (const index of active) state.maxDivergence = Math.max(state.maxDivergence, Math.abs(divergence(index)));
    if (!Number.isFinite(state.maxDivergence) || state.maxDivergence > 0.01) {
      state.failed = true;
      state.message = '压力投影未收敛，计算已暂停。';
    }
  }

  function stopAtSolidFace(particle, targetX, targetY) {
    const dx = targetX - particle.x;
    const dy = targetY - particle.y;
    let i = Math.floor(particle.x / h);
    let j = Math.floor(particle.y / h);
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const crossingIntervalX = dx === 0 ? Infinity : h / Math.abs(dx);
    const crossingIntervalY = dy === 0 ? Infinity : h / Math.abs(dy);
    let crossingX = dx === 0 ? Infinity : ((i + (stepX > 0 ? 1 : 0)) * h - particle.x) / dx;
    let crossingY = dy === 0 ? Infinity : ((j + (stepY > 0 ? 1 : 0)) * h - particle.y) / dy;
    let fraction = 1;
    // Traverse crossed grid faces, including both sides of a diagonal corner.
    // The rasterized solid mask is also the pressure/velocity boundary.
    while (Math.min(crossingX, crossingY) <= 1) {
      const crossing = Math.min(crossingX, crossingY);
      const crossesX = crossingX <= crossingY + 1e-12;
      const crossesY = crossingY <= crossingX + 1e-12;
      const nextI = i + (crossesX ? stepX : 0);
      const nextJ = j + (crossesY ? stepY : 0);
      const blocked = cellType(nextI, nextJ) === 2
        || (crossesX && cellType(nextI, j) === 2)
        || (crossesY && cellType(i, nextJ) === 2);
      if (blocked) {
        fraction = Math.max(0, crossing - 1e-5 * h / Math.max(Math.abs(dx), Math.abs(dy), h * 1e-5));
        break;
      }
      i = nextI;
      j = nextJ;
      if (crossesX) crossingX += crossingIntervalX;
      if (crossesY) crossingY += crossingIntervalY;
    }
    particle.x += dx * fraction;
    particle.y += dy * fraction;
  }

  function moveMarkers(dt) {
    const epsilon = 1e-5 * h;
    for (const particle of particles) {
      const first = velocityAt(particle.x, particle.y);
      const middle = velocityAt(particle.x + dt * first.u / 2, particle.y + dt * first.v / 2);
      const x = Math.max(epsilon, Math.min(width - epsilon, particle.x + dt * middle.u));
      const y = Math.max(epsilon, Math.min(height - epsilon, particle.y + dt * middle.v));
      stopAtSolidFace(particle, x, y);
    }
  }

  function updateLoads() {
    state.wallPressure = 0;
    state.forceX = 0;
    if (obstacle) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const index = j * nx + i;
          if (!solid[index]) continue;
          // Pressure traction on each exposed vertical solid face, per metre span.
          if (i > 0 && mask[index - 1]) {
            const front = pressure[index - 1];
            state.wallPressure = Math.max(state.wallPressure, front);
            state.forceX += front * h;
          }
          if (i + 1 < nx && mask[index + 1]) state.forceX -= pressure[index + 1] * h;
        }
      }
    }
    state.maxSpeed = 0;
    state.kineticEnergy = 0;
    for (const index of active) {
      const i = index % nx;
      const j = Math.floor(index / nx);
      const centerU = (u[j * (nx + 1) + i] + u[j * (nx + 1) + i + 1]) / 2;
      const centerV = (v[index] + v[index + nx]) / 2;
      const speed = Math.hypot(centerU, centerV);
      state.maxSpeed = Math.max(state.maxSpeed, speed);
      state.kineticEnergy += density * h * h * speed * speed / 2;
    }
  }

  function substep(dt) {
    extrapolateVelocity();
    advectComponent(u, nextU, nx + 1, ny, 0, 0.5, dt);
    advectComponent(v, nextV, nx, ny + 1, 0.5, 0, dt);
    u.set(nextU);
    v.set(nextV);
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (cellType(i, j - 1) === 1 || cellType(i, j) === 1) v[j * nx + i] -= gravity * dt;
      }
    }
    enforceWalls();
    project(dt);
    if (state.failed) return;
    updateLoads();
    extrapolateVelocity();
    moveMarkers(dt);
    classify();
    state.time += dt;
    state.dt = dt;
  }

  function step(frameDt = 1 / 60) {
    if (state.failed) return state;
    let remaining = Math.max(0, Math.min(0.1, Number(frameDt) || 0));
    while (remaining > 1e-9 && !state.failed) {
      let maximum = 0;
      for (const value of u) maximum = Math.max(maximum, Math.abs(value));
      for (const value of v) maximum = Math.max(maximum, Math.abs(value));
      const stableDt = Math.min(1 / 60, 0.35 * h / (maximum + Math.sqrt(gravity * h)), 0.2 * h * h / Math.max(viscosity, 1e-12));
      const dt = remaining / Math.ceil(remaining / stableDt);
      if (!Number.isFinite(dt) || dt < 1e-6 || maximum > 30) {
        state.failed = true;
        state.message = '流速超过当前网格的演示范围，计算已暂停。';
        break;
      }
      substep(dt);
      remaining -= dt;
    }
    return state;
  }

  function reset() {
    u.fill(0); v.fill(0); pressure.fill(0); solid.fill(0);
    particles.length = 0;
    state.time = 0; state.failed = false; state.message = '';
    state.dt = 0; initialGridVolume = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const index = j * nx + i;
        solid[index] = insideObstacle((i + 0.5) * h, (j + 0.5) * h) ? 1 : 0;
        if (solid[index]) continue;
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const x = (i + (sx + 0.5) / 2) * h;
            const y = (j + (sy + 0.5) / 2) * h;
            let surface = depth;
            if (scenario === 'pulse') surface += amplitude * Math.exp(-(((x - 0.85) / 0.35) ** 2));
            if (scenario === 'dam-break') surface = x < 1.25 ? 0.95 + amplitude : 0.25;
            if (y < surface) particles.push({ x, y });
          }
        }
      }
    }
    if (scenario === 'pulse') {
      const c = Math.sqrt(gravity * depth);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const eta = amplitude * Math.exp(-(((i * h - 0.85) / 0.35) ** 2));
          u[j * (nx + 1) + i] = c * eta / depth;
        }
      }
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = (i + 0.5) * h;
          const eta = amplitude * Math.exp(-(((x - 0.85) / 0.35) ** 2));
          const derivative = -2 * (x - 0.85) * eta / (0.35 ** 2);
          v[j * nx + i] = -Math.min(j * h, depth) * c * derivative / depth;
        }
      }
    }
    initialVolume = particles.length * markerVolume;
    state.initialVolume = initialVolume;
    classify();
    initialGridVolume = state.gridVolume;
    enforceWalls();
    // First make the prescribed velocity discretely solenoidal.
    project(1);
    extrapolateVelocity();
    const initialU = u.slice();
    const initialV = v.slice();

    // At t=0 solve L(p/rho)=div(acceleration), without interpreting the
    // initialization velocity correction as a physical pressure impulse.
    // The short difference estimates the same advection/viscosity operator
    // used during stepping. Subtracting the original velocity first avoids
    // dividing its small remaining divergence by an arbitrary initial dt.
    const accelerationInterval = 0.001;
    advectComponent(u, nextU, nx + 1, ny, 0, 0.5, accelerationInterval);
    advectComponent(v, nextV, nx, ny + 1, 0.5, 0, accelerationInterval);
    for (let index = 0; index < u.length; index++) {
      u[index] = (nextU[index] - initialU[index]) / accelerationInterval;
    }
    for (let index = 0; index < v.length; index++) {
      v[index] = (nextV[index] - initialV[index]) / accelerationInterval;
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (cellType(i, j - 1) === 1 || cellType(i, j) === 1) v[j * nx + i] -= gravity;
      }
    }
    enforceWalls();
    pressure.fill(0);
    project(1);
    u.set(initialU);
    v.set(initialV);
    // No physical time step has occurred. Divergence describes initial
    // velocity; pressureResidual describes the acceleration-pressure solve.
    state.projectionDt = 0;
    state.maxDivergence = 0;
    for (const index of active) state.maxDivergence = Math.max(state.maxDivergence, Math.abs(divergence(index)));
    updateLoads();
  }

  reset();
  return { nx, ny, h, width, height, density, gravity, viscosity, depth, obstacle, scenario, amplitude, state, step, reset, velocityAt };
}
