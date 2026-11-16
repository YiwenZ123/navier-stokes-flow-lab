import { metadata, frames } from './assets/home-wave-data.js?v=c6775c3af025';

// These frames come from the lesson's MAC solver. Playback avoids running the
// 120 × 60 pressure solve on the homepage's main thread (especially on phones).
export function mountHomeWave(root = document) {
  const canvas = root.querySelector('#home-wave');
  const doc = root.ownerDocument || root;
  const win = doc.defaultView || window;
  const context = canvas.getContext('2d', { alpha: false });
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const decoded = frames.map(frame => Uint8Array.from(atob(frame), character => character.charCodeAt(0)));
  const { nx, ny, width: domainWidth, height: domainHeight } = metadata;
  const obstacle = metadata.options.obstacle;
  const startHold = 0.8, endHold = 1.1, playbackSpeed = 0.55;
  const cycleDuration = startHold + metadata.duration / playbackSpeed + endHold;
  let paused = reducedMotion.matches, destroyed = false, visible = false;
  let frameRequest = 0, previousTime = null, elapsed = 0, lastFrame = -1;
  let width = 0, height = 0, ratio = 1;

  function paint(index) {
    if (!width || !height || !context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    // Use one scale for both axes: a physical square remains a square.
    const scale = Math.min(width / domainWidth, height / domainHeight);
    const left = (width - domainWidth * scale) / 2;
    const bottom = (height + domainHeight * scale) / 2;
    const cell = metadata.h * scale;
    const bits = decoded[index];
    const occupied = index => (bits[index >> 3] >> (index & 7)) & 1;
    context.fillStyle = '#60b6e6';
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        if (!occupied(j * nx + i)) { i++; continue; }
        const start = i++;
        while (i < nx && occupied(j * nx + i)) i++;
        context.fillRect(left + start * cell, bottom - (j + 1) * cell, (i - start) * cell + 0.25, cell + 0.25);
      }
    }
    const x = left + (obstacle.centerX - obstacle.size / 2) * scale;
    const y = bottom - (obstacle.bottomY + obstacle.size) * scale;
    const side = obstacle.size * scale;
    context.fillStyle = '#f5f5f5';
    context.fillRect(x, y, side, side);
    context.save();
    context.beginPath(); context.rect(x, y, side, side); context.clip();
    context.beginPath();
    for (let offset = -side; offset <= side; offset += 12) {
      context.moveTo(x + offset, y + side);
      context.lineTo(x + offset + side, y);
    }
    context.strokeStyle = '#e3e3e3'; context.lineWidth = 1;
    context.stroke(); context.restore();
    context.strokeStyle = '#303030'; context.lineWidth = 1.25;
    context.strokeRect(x, y, side, side);
    lastFrame = index;
  }

  function currentFrame() {
    const time = Math.max(0, Math.min(metadata.duration, (elapsed - startHold) * playbackSpeed));
    return Math.min(frames.length - 1, Math.floor(time * metadata.fps + 1e-8));
  }
  function fit() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    ratio = Math.min(win.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint(currentFrame());
  }
  const active = () => !destroyed && !paused && !doc.hidden && visible && width && height;
  function tick(timestamp) {
    frameRequest = 0;
    if (!active()) return;
    if (previousTime !== null) elapsed = (elapsed + Math.min((timestamp - previousTime) / 1000, 0.1)) % cycleDuration;
    previousTime = timestamp;
    const index = currentFrame();
    if (index !== lastFrame) paint(index);
    frameRequest = win.requestAnimationFrame(tick);
  }
  function synchronize() {
    if (!active()) {
      if (frameRequest) win.cancelAnimationFrame(frameRequest);
      frameRequest = 0; previousTime = null;
    } else if (!frameRequest) {
      previousTime = null;
      frameRequest = win.requestAnimationFrame(tick);
    }
  }
  function updateVisibility() {
    const rect = canvas.getBoundingClientRect();
    visible = rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth;
    synchronize();
  }
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; synchronize();
  }) : null;
  const resize = win.ResizeObserver ? new win.ResizeObserver(() => { fit(); synchronize(); }) : null;
  const handleResize = () => { fit(); updateVisibility(); };
  doc.addEventListener('visibilitychange', synchronize);
  win.addEventListener('resize', handleResize, { passive: true });
  if (!intersection) win.addEventListener('scroll', updateVisibility, { passive: true });
  fit(); updateVisibility(); intersection?.observe(canvas); resize?.observe(canvas);
  return {
    setPaused(value) { paused = Boolean(value); synchronize(); },
    isPaused() { return paused; },
    destroy() {
      destroyed = true; synchronize(); intersection?.disconnect(); resize?.disconnect();
      doc.removeEventListener('visibilitychange', synchronize);
      win.removeEventListener('resize', handleResize); win.removeEventListener('scroll', updateVisibility);
    }
  };
}
