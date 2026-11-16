import { DEFAULT_CURVE, normalizeCurve, makeSlopes, interpolate } from './custom-profile.js?v=341dbc61d218';
import { t } from './i18n.js?v=14';

const presets = {
  peaks: [[-1,.15],[-.65,.22],[-.35,.82],[.05,.25],[.45,.62],[.78,.21],[1,.15]],
  pulse: [[-1,.05],[-.6,.05],[-.25,.45],[0,.9],[.25,.45],[.6,.05],[1,.05]],
  plateau: [[-1,.1],[-.55,.1],[-.3,.8],[.3,.8],[.55,.1],[1,.1]],
  flat: [[-1,.25],[0,.25],[1,.25]]
};
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const gap = .035, maximum = 18;

/** A point editor; only mathematical curve changes invoke onChange. */
export function mountCurveEditor(root, { value = DEFAULT_CURVE, onChange = () => {}, sampleCount = 200 } = {}) {
  const initial = normalizeCurve(value);
  let state = { ...initial, selected: Math.floor(initial.points.length / 2), samples: false, preset: 'custom' };
  let undo = [], redo = [], drag = null, geometry = null;
  let gridCount = validateCount(sampleCount);
  const getValue = () => normalizeCurve({ points: state.points, mode: state.mode, periodic: state.periodic });
  let lastNotified = JSON.stringify(getValue());
  root.setAttribute('data-i18n-ignore', '');
  root.innerHTML = `
    <section class="ce-editor" data-ce="section">
      <header class="ce-heading"><h3 data-ce="title"></h3><p data-ce="hint"></p></header>
      <div class="ce-toolbar">
        <label class="ce-field"><span data-ce="preset-label"></span><select data-ce="preset"><option value="custom" hidden></option><option value="peaks"></option><option value="pulse"></option><option value="plateau"></option><option value="flat"></option></select></label>
        <div class="ce-group" role="group" data-ce="modes"><button type="button" data-mode="smooth" aria-pressed="true"></button><button type="button" data-mode="linear" aria-pressed="false"></button></div>
      </div>
      <div class="ce-caption"><span data-ce="quantity"></span><span>x ∈ [−1, 1] · u₀ ∈ [0, 1]</span></div>
      <div class="ce-plot" data-ce="plot">
        <svg data-ce="svg" role="img"></svg><div class="ce-handles" data-ce="handles"></div>
      </div>
      <div class="ce-edit-row">
        <div class="ce-coordinates"><span class="ce-point-name" data-ce="point-name"></span><label>x <input data-ce="x" type="number" min="-1" max="1" step="0.01"></label><label>u₀ <input data-ce="y" type="number" min="0" max="1" step="0.01"></label></div>
        <div class="ce-ops"><button type="button" data-ce="add"></button><button type="button" data-ce="delete"></button><button type="button" data-ce="undo" disabled></button><button type="button" data-ce="redo" disabled></button></div>
      </div>
      <div class="ce-options"><label class="ce-check"><input data-ce="periodic" type="checkbox"><span data-ce="periodic-label"></span></label><label class="ce-check"><input data-ce="samples" type="checkbox"><span data-ce="samples-label"></span></label></div>
      <p class="ce-status" data-ce="status" role="status" aria-live="polite"></p>
      <details data-ce="periodic-details"><summary data-ce="periodic-summary"></summary><div class="ce-continuation" data-ce="continuation"><svg data-ce="continuation-svg" role="img"></svg></div><p class="ce-note" data-ce="boundary-note"></p></details>
      <details><summary data-ce="help-summary"></summary><p class="ce-note" data-ce="help"></p></details>
    </section>`;
  const find = name => root.querySelector(`[data-ce="${name}"]`);
  const snapshot = () => clone(state);
  function validateCount(count) { return Number.isInteger(count) && count >= 8 && count <= 1000 ? count : 200; }
  function notify() {
    const curve = getValue(), signature = JSON.stringify(curve);
    if (signature === lastNotified) return;
    lastNotified = signature;
    onChange(curve);
  }
  function commit(before, preserveCoordinates = false) {
    if (JSON.stringify(before) === JSON.stringify(state)) return;
    // Selection-only actions never create numerical history or notify the parent.
    const beforeCurve = JSON.stringify({ points: before.points, mode: before.mode, periodic: before.periodic });
    if (beforeCurve !== JSON.stringify(getValue())) {
      undo.push(before); if (undo.length > 60) undo.shift(); redo = [];
    }
    render(preserveCoordinates); notify();
  }
  function svgNode(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes || {}).forEach(([key, val]) => node.setAttribute(key, val));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function dimensions() {
    const w = find('plot').clientWidth, h = find('plot').clientHeight;
    return { w, h, l: 34, r: 16, t: 14, b: 34, pw: w - 50, ph: h - 48 };
  }
  function pathFor(slopes, mapX, mapY, count = 400) {
    let path = '';
    for (let k = 0; k <= count; k++) {
      const x = -1 + 2 * k / count;
      path += (k ? 'L' : 'M') + mapX(x).toFixed(2) + ',' + mapY(interpolate(state.points, slopes, x, state.mode)).toFixed(2);
    }
    return path;
  }
  function draw() {
    geometry = dimensions(); const g = geometry;
    if (g.w < 50 || !g.h) return;
    const svg = find('svg'); svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
    svg.replaceChildren(svgNode('title', {}, t('Click to add a point; drag a point to shape the initial condition.', '点击空白处添加点，拖动控制点调整初始条件。')));
    const X = x => g.l + (x + 1) * g.pw / 2, Y = y => g.t + (1 - y) * g.ph;
    const ticks = g.w < 400 ? [-1,0,1] : [-1,-.5,0,.5,1];
    for (const y of [0,.25,.5,.75,1]) {
      svg.append(svgNode('line', {x1:g.l,y1:Y(y),x2:g.w-g.r,y2:Y(y),class:'ce-grid'}));
      svg.append(svgNode('text', {x:g.l-8,y:Y(y)+4,'text-anchor':'end',class:'ce-text'}, String(y)));
    }
    for (const x of ticks) {
      svg.append(svgNode('line', {x1:X(x),y1:g.t,x2:X(x),y2:g.h-g.b,class:'ce-grid'}));
      svg.append(svgNode('text', {x:X(x),y:g.h-12,'text-anchor':'middle',class:'ce-text'}, String(x)));
    }
    svg.append(svgNode('text', {x:g.w-2,y:g.h-12,'text-anchor':'end',class:'ce-text'}, 'x'));
    const slopes = makeSlopes(state.points, state.periodic), path = pathFor(slopes, X, Y);
    svg.append(svgNode('path', {d:path+`L${X(1)},${Y(0)}L${X(-1)},${Y(0)}Z`,class:'ce-area'}));
    const selected = state.points[state.selected];
    svg.append(svgNode('line', {x1:X(selected[0]),y1:g.t,x2:X(selected[0]),y2:Y(0),class:'ce-cross'}));
    svg.append(svgNode('line', {x1:g.l,y1:Y(selected[1]),x2:X(1),y2:Y(selected[1]),class:'ce-cross'}));
    svg.append(svgNode('path', {d:path,class:'ce-path'}));
    if (state.samples) {
      for (let i = 0; i < gridCount; i++) {
        const x = -1 + 2 * i / gridCount;
        svg.append(svgNode('circle', {cx:X(x),cy:Y(interpolate(state.points,slopes,x,state.mode)),r:1.6,class:'ce-sample'}));
      }
    }
    const holder = find('handles');
    while (holder.children.length > state.points.length) holder.lastChild.remove();
    while (holder.children.length < state.points.length) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ce-handle'; holder.append(button);
    }
    [...holder.children].forEach((button, i) => {
      const point = state.points[i];
      button.dataset.index = String(i); button.dataset.selected = String(i === state.selected);
      button.dataset.endpoint = String(i === 0 || i === state.points.length - 1);
      button.style.left = X(point[0]) + 'px'; button.style.top = Y(point[1]) + 'px';
      button.setAttribute('aria-label', t(`Control point ${i+1}, x ${point[0].toFixed(3)}, initial value ${point[1].toFixed(3)}`, `控制点 ${i+1}，x ${point[0].toFixed(3)}，初始值 ${point[1].toFixed(3)}`));
      button.setAttribute('aria-pressed', String(i === state.selected));
    });
    drawPeriodic(slopes);
  }
  function drawPeriodic(slopes = makeSlopes(state.points, state.periodic)) {
    const box = find('continuation'), w = box.clientWidth, h = box.clientHeight;
    if (!w) return;
    const svg = find('continuation-svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.replaceChildren();
    const X = x => 34 + (x + 3) * (w - 50) / 6, Y = y => 10 + (1 - y) * (h - 35);
    for (const x of [-3,-1,1,3]) {
      svg.append(svgNode('line', {x1:X(x),y1:8,x2:X(x),y2:h-25,class:'ce-grid','stroke-dasharray':'3 4'}));
      svg.append(svgNode('text', {x:X(x),y:h-7,class:'ce-text','text-anchor':'middle'}, String(x)));
    }
    svg.append(svgNode('text', {x:4,y:17,class:'ce-text'}, 'u₀'), svgNode('text', {x:w-2,y:h-7,class:'ce-text','text-anchor':'end'}, 'x'));
    for (const offset of [-2,0,2]) {
      svg.append(svgNode('path', {d:pathFor(slopes,x=>X(x+offset),Y,180),class:offset?'ce-repeated':'ce-path'}));
    }
  }
  function refreshLanguage() {
    const labels = {
      title: ['Initial-condition curve','初始条件曲线'], hint: ['Click to add · drag to reshape','点击加点 · 拖动调形'],
      'preset-label': ['Starting shape','起始波形'], quantity: ['Initial value u₀(x)','初始值 u₀(x)'],
      add: ['Add point','加点'], delete: ['Delete point','删除点'], undo: ['Undo','撤销'], redo: ['Redo','重做'],
      'periodic-label': ['Link endpoints','首尾联动'], 'periodic-summary': ['Periodic connection preview','周期连接预览'],
      'help-summary': ['How to edit','操作说明'],
      help: ['Drag round points to reshape the curve; square points have fixed x coordinates. Use arrow keys for fine adjustments (Shift for larger steps), or Delete to remove an interior point. Smooth mode uses shape-preserving interpolation; linear mode creates corners. Changing the curve restarts both schemes at t = 0.', '拖动圆点调整波形；方点为横坐标固定的端点。选中点后用方向键微调（Shift 加大步幅），Delete 删除内点。平滑模式采用保形插值，折线用于构造尖角。修改曲线后，两种格式会同时从 t = 0 重算。']
    };
    for (const [key, words] of Object.entries(labels)) find(key).textContent = t(...words);
    const presetNames = { custom:['Custom','自定义'], peaks:['Two peaks','双峰'], pulse:['Single pulse','单峰'], plateau:['Plateau','平顶'], flat:['Flat','平直'] };
    for (const option of find('preset').options) option.textContent = t(...presetNames[option.value]);
    root.querySelector('[data-mode="smooth"]').textContent = t('Smooth','平滑');
    root.querySelector('[data-mode="linear"]').textContent = t('Linear','折线');
    find('section').setAttribute('aria-label', t('Custom initial-condition curve editor','自定义初始条件曲线编辑器'));
    find('preset').setAttribute('aria-label', t('Starting shape','起始波形'));
    find('modes').setAttribute('aria-label', t('Interpolation mode','插值方式'));
    find('x').setAttribute('aria-label', t('Control point x coordinate','控制点横坐标x'));
    find('y').setAttribute('aria-label', t('Control point initial value','控制点初始值u0'));
    find('svg').setAttribute('aria-label', t('Editable initial-condition curve. Horizontal axis: x; vertical axis: dimensionless u0.','可编辑的初始条件曲线，横轴为空间位置x，纵轴为无量纲初始值u0。'));
    find('continuation-svg').setAttribute('aria-label', t('Three periodic copies of the curve; dashed lines mark the domain seams.','初始条件向左右延拓三个周期，虚线标出区间接缝。'));
    render();
  }
  function render(preserveCoordinates = false) {
    const point = state.points[state.selected], endpoint = state.selected === 0 || state.selected === state.points.length - 1;
    find('point-name').textContent = `${endpoint ? t('Endpoint','端点') : t('Point','控制点')} ${state.selected+1} / ${state.points.length}`;
    if (!preserveCoordinates) { find('x').value = point[0].toFixed(3); find('y').value = point[1].toFixed(3); }
    find('x').disabled = endpoint;
    find('x').min = endpoint ? -1 : state.points[state.selected-1][0] + gap;
    find('x').max = endpoint ? 1 : state.points[state.selected+1][0] - gap;
    find('delete').disabled = endpoint; find('undo').disabled = !undo.length; find('redo').disabled = !redo.length;
    find('add').disabled = state.points.length >= maximum;
    find('periodic').checked = state.periodic; find('samples').checked = state.samples; find('preset').value = state.preset;
    root.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    find('samples-label').textContent = t(`Show ${gridCount} grid samples`, `显示 ${gridCount} 个网格采样点`);
    const difference = Math.abs(state.points[0][1] - state.points.at(-1)[1]);
    const connection = state.periodic
      ? (state.mode === 'smooth' ? t('Periodic values and slopes match','周期首尾值与斜率连续') : t('Periodic endpoint values match','周期首尾值连续'))
      : t(`Endpoint gap ${difference.toFixed(3)}`, `首尾高度差 ${difference.toFixed(3)}`);
    find('status').textContent = t(`${state.points.length} control points · ${gridCount} grid samples · ${connection}`, `${state.points.length} 个控制点 · ${gridCount} 个网格点 · ${connection}`);
    find('boundary-note').textContent = state.periodic
      ? (state.mode === 'smooth' ? t('Smooth mode matches both endpoint values and slopes.','平滑模式同时匹配首尾高度与斜率。') : t('Endpoint values match; linear segments may have different slopes.','首尾高度相同，折线连接允许斜率跳变。'))
      : t('Endpoints are independent. A height difference produces a jump where the curve repeats periodically.','首尾可独立编辑；延拓到下一周期时，高度差会形成间断。');
    draw();
  }
  function movePoint(index, x, y) {
    const endpoint = index === 0 || index === state.points.length - 1;
    if (!endpoint) state.points[index][0] = clamp(x, state.points[index-1][0]+gap, state.points[index+1][0]-gap);
    state.points[index][1] = clamp(y,0,1);
    if (endpoint && state.periodic) state.points[0][1] = state.points.at(-1)[1] = state.points[index][1];
    state.preset = 'custom';
  }
  function pointerPosition(event) {
    const rectangle = find('plot').getBoundingClientRect(), g = geometry;
    return {x:-1+2*(event.clientX-rectangle.left-g.l)/g.pw,y:1-(event.clientY-rectangle.top-g.t)/g.ph};
  }
  function addAt(x, y) {
    if (state.points.length >= maximum) return false;
    x = clamp(x,-1,1); let index = 1;
    while (index < state.points.length && state.points[index][0] < x) index++;
    if (index >= state.points.length || x-state.points[index-1][0] < gap || state.points[index][0]-x < gap) return false;
    state.points.splice(index,0,[x,clamp(y,0,1)]); state.selected = index; state.preset = 'custom'; return true;
  }
  function beginDrag(event) {
    if (event.button !== 0 || drag || !geometry?.pw) return;
    const handle = event.target.closest('.ce-handle'), position = pointerPosition(event), before = snapshot();
    if (handle) state.selected = +handle.dataset.index;
    else if (position.x < -1 || position.x > 1 || position.y < 0 || position.y > 1 || !addAt(position.x,position.y)) return;
    event.preventDefault(); drag = {pointerId:event.pointerId,before,changed:!handle};
    find('plot').setPointerCapture(event.pointerId); render();
    find('handles').children[state.selected]?.focus({preventScroll:true});
    if (!handle) notify();
  }
  find('plot').addEventListener('pointerdown', beginDrag);
  find('plot').addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = pointerPosition(event); movePoint(state.selected,position.x,position.y); drag.changed = true; render(); notify();
  });
  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const active = drag; drag = null;
    if (find('plot').hasPointerCapture(event.pointerId)) find('plot').releasePointerCapture(event.pointerId);
    if (active.changed) commit(active.before); else render();
  }
  function cancelDrag() {
    if (!drag) return;
    const active = drag; drag = null; state = active.before;
    if (find('plot').hasPointerCapture(active.pointerId)) find('plot').releasePointerCapture(active.pointerId);
    render(); notify();
  }
  find('plot').addEventListener('pointerup', endDrag);
  find('plot').addEventListener('pointercancel', cancelDrag);
  find('plot').addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
  function remove() {
    if (state.selected === 0 || state.selected === state.points.length - 1) return;
    const before = snapshot(); state.points.splice(state.selected,1); state.selected = Math.min(state.selected,state.points.length-2); state.preset = 'custom'; commit(before);
    find('handles').children[state.selected]?.focus({preventScroll:true});
  }
  find('handles').addEventListener('click', event => {
    const button = event.target.closest('.ce-handle'); if (button) { state.selected = +button.dataset.index; render(); }
  });
  find('handles').addEventListener('keydown', event => {
    const button = event.target.closest('.ce-handle'); if (!button) return; state.selected = +button.dataset.index;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return; }
    const directions = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowDown:[0,-1],ArrowUp:[0,1]};
    if (!directions[event.key]) return;
    event.preventDefault(); const before = snapshot(), point = state.points[state.selected], step = event.shiftKey ? .05 : .01, direction = directions[event.key];
    movePoint(state.selected,point[0]+direction[0]*step,point[1]+direction[1]*step); commit(before);
  });
  function coordinateChange(axis, preserveCoordinates = false) {
    const number = find(axis).valueAsNumber;
    if (!Number.isFinite(number)) { if (!preserveCoordinates) render(); return; }
    const before = snapshot(), point = state.points[state.selected];
    movePoint(state.selected,axis === 'x' ? number : point[0],axis === 'y' ? number : point[1]);
    commit(before,preserveCoordinates); if (!preserveCoordinates) render();
  }
  for (const axis of ['x','y']) {
    find(axis).addEventListener('input', () => coordinateChange(axis,true));
    find(axis).addEventListener('change', () => coordinateChange(axis));
    find(axis).addEventListener('blur', () => render());
    find(axis).addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); coordinateChange(axis); }
      if (event.key === 'Escape') { render(); find(axis).blur(); }
    });
  }
  find('delete').addEventListener('click', remove);
  find('add').addEventListener('click', () => {
    const before = snapshot(); let index = 0;
    for (let j = 1; j < state.points.length-1; j++) if (state.points[j+1][0]-state.points[j][0] > state.points[index+1][0]-state.points[index][0]) index = j;
    const x = (state.points[index][0]+state.points[index+1][0])/2, y = interpolate(state.points,makeSlopes(state.points,state.periodic),x,state.mode);
    if (addAt(x,y)) { commit(before); find('handles').children[state.selected]?.focus({preventScroll:true}); }
  });
  find('undo').addEventListener('click', () => { if (!undo.length) return; redo.push(snapshot()); state = undo.pop(); render(); notify(); });
  find('redo').addEventListener('click', () => { if (!redo.length) return; undo.push(snapshot()); state = redo.pop(); render(); notify(); });
  find('preset').addEventListener('change', event => {
    if (!presets[event.target.value]) return;
    const before = snapshot(); state.points = clone(presets[event.target.value]); state.selected = Math.floor(state.points.length/2); state.preset = event.target.value; commit(before);
  });
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { const before = snapshot(); state.mode = button.dataset.mode; commit(before); }));
  find('periodic').addEventListener('change', event => {
    const before = snapshot(); state.periodic = event.target.checked;
    if (state.periodic) state.points.at(-1)[1] = state.points[0][1]; commit(before);
  });
  find('samples').addEventListener('change', event => { state.samples = event.target.checked; render(); });
  find('periodic-details').addEventListener('toggle', () => drawPeriodic());
  const resizeObserver = new ResizeObserver(draw); resizeObserver.observe(find('plot'));
  refreshLanguage();
  return {
    getValue,
    setSampleCount(count) { const next = validateCount(count); if (next !== gridCount) { gridCount = next; render(); } },
    refreshLanguage,
    cancelDrag
  };
}
