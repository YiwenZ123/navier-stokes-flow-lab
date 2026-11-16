import { SCHEMES, PROFILES, createSimulation } from './advection-solver.js?v=6c8206143de0';
import { DEFAULT_CURVE, normalizeCurve } from './custom-profile.js?v=341dbc61d218';
import { mountCurveEditor } from './curve-editor.js?v=c264f6736003';
import { t } from './i18n.js?v=14';

const $ = id => document.getElementById(id);
const control = { profile: $('adv-profile'), N: $('adv-grid'), a: $('adv-speed'), cfl: $('adv-cfl') };
const selectors = [$('adv-scheme-a'), $('adv-scheme-b')];
const names = item => t(item.nameEn, item.nameZh);
const meta = id => SCHEMES.find(item => item.id === id);
const num = (v, digits = 4) => Number.isFinite(v) ? v.toFixed(digits) : '—';
const sci = v => !Number.isFinite(v) ? '—' : Math.abs(v) < 1e-14 ? '0' : v.toExponential(2).replace('e-', 'e−');
const mod = (i, n) => (i % n + n) % n;
let sims = [], snapshots = [], stepNumber = 0, playing = false, frame = 0, lastFrame = 0, accumulator = 0, runningToEnd = false;
let completionToken = 0, parametersValid = true;
const historyMedia = matchMedia('(prefers-color-scheme: dark)');
const curveStorageKey = 'cfd-custom-advection-curve-v1';
function readSavedCurve() {
  try {
    const saved = localStorage.getItem(curveStorageKey);
    if (saved) return normalizeCurve(JSON.parse(saved));
  } catch { /* Invalid or unavailable storage: use the reviewed starting curve. */ }
  return normalizeCurve(DEFAULT_CURVE);
}
function rememberCurve(value) {
  try { localStorage.setItem(curveStorageKey, JSON.stringify(normalizeCurve(value))); } catch { /* Editing also works without storage. */ }
}

function populate(select, items, initial) {
  const selected = select.value || initial;
  select.replaceChildren(...items.map(item => {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = names(item); return option;
  }));
  select.value = selected;
}

function setText(id, text) { $(id).textContent = text; }
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}

function allowed(sim) {
  if (sim.scheme === 'ftcs') return false;
  if (['implicit-upwind', 'crank-nicolson', 'beam-warming'].includes(sim.scheme)) return true;
  if (sim.scheme === 'leapfrog') return sim.cfl < 1;
  return sim.cfl <= 1;
}
function refreshSelectionText() {
  populate(control.profile, PROFILES, 'composite');
  selectors.forEach((select, index) => populate(select, SCHEMES, index ? 'lax-wendroff' : 'upwind'));
  for (let i = 0; i < sims.length; i++) {
    const scheme = meta(sims[i].scheme), node = $('adv-stability-' + (i ? 'b' : 'a'));
    node.textContent = t(scheme.stabilityEn, scheme.stabilityZh);
    if (!allowed(sims[i])) node.textContent += t(' · outside the recommended range', ' · 当前超出建议范围');
    node.dataset.caution = String(!allowed(sims[i]));
  }
  const profile = PROFILES.find(item => item.id === control.profile.value);
  const info = $('adv-profile-info');
  info.replaceChildren(element('div', profile.formula, 'adv-formula-text'), element('p', t(profile.noteEn, profile.noteZh)));
  if (profile.id === 'custom') updateCustomDescription();
  if (profile.id === 'composite') {
    const detail = 'G(x,z) = exp[−β(x − z)²], F(x,b) = √max(1 − α²(x − b)², 0)\n−0.8 ≤ x ≤ −0.6: [G(x,z−δ) + G(x,z+δ) + 4G(x,z)] / 6\n−0.4 ≤ x ≤ −0.2: 1\n0 ≤ x ≤ 0.2: 1 − |10(x − 0.1)|\n0.4 ≤ x ≤ 0.6: [F(x,b−δ) + F(x,b+δ) + 4F(x,b)] / 6';
    info.append(element('div', detail, 'adv-formula-text'), element('p', t('Zero elsewhere; x is wrapped periodically. This reproduces the printed log₁₀ parameter in the handout.', '其余位置为 0，x 按周期回绕；β 使用课件印出的 log₁₀ 参数。')));
  }
  renderFormulas();
}

function updateCustomDescription() {
  const curve = curveEditor.getValue();
  const info = $('adv-profile-info');
  const method = curve.mode === 'smooth' ? t('Shape-preserving cubic interpolation', '保形三次插值') : t('Piecewise linear interpolation', '分段线性插值');
  info.replaceChildren(element('div', 'u₀(x) = P(x),  u(x,t) = P(periodic(x − at))', 'adv-formula-text'));
  info.append(element('p', `${method} · ${curve.points.length} ${t('control points', '个控制点')} · ${curve.periodic ? t('linked endpoints', '首尾联动') : t('independent endpoints; a jump at the periodic seam is allowed', '端点独立，周期接缝允许间断')}`));
}

function renderFormulas() {
  const root = $('adv-formulas'); root.replaceChildren();
  root.append(element('p', 'r = |C|, s = sign(a), g = ∂u/∂x', 'adv-formula-meta'));
  for (const scheme of SCHEMES) {
    const article = element('article', undefined, 'formula'); article.id = 'scheme-' + scheme.id;
    const h = element('h3', names(scheme));
    h.append(element('span', t('CFD 4 · pp. ', 'CFD 4 · 第 ') + scheme.pages + t('', ' 页')));
    article.append(h, element('div', scheme.formula, 'adv-formula-text'));
    const props = element('div', undefined, 'adv-formula-meta');
    props.append(element('span', t(scheme.orderEn, scheme.orderZh)), element('span', t(scheme.stabilityEn, scheme.stabilityZh)));
    const details = element('details', undefined, 'parameter-help');
    details.append(element('summary', t('Interpretation', '如何理解')));
    const body = element('div', undefined, 'parameter-help-body'); body.append(element('p', t(scheme.noteEn, scheme.noteZh))); details.append(body);
    article.append(props, details); root.append(article);
  }
}

function reset(refreshLabels = true) {
  stop(); completionToken++; runningToEnd = false;
  const custom = control.profile.value === 'custom';
  $('adv-custom-panel').hidden = !custom;
  curveEditor.setSampleCount(+control.N.value);
  // Empty or out-of-range values are rejected instead of silently changing CFL.
  parametersValid = control.cfl.checkValidity() && control.cfl.value !== '';
  if (!parametersValid) { render(); if (refreshLabels) control.cfl.reportValidity(); return false; }
  // Snapshot once so both solvers start from the same curve definition.
  const params = { profile: control.profile.value, N: +control.N.value, a: +control.a.value, cfl: +control.cfl.value, ...(custom ? { customCurve: curveEditor.getValue() } : {}) };
  sims = selectors.map(select => createSimulation({ ...params, scheme: select.value }));
  snapshots = [null, null]; stepNumber = 0;
  $('adv-node').max = String(params.N - 1);
  $('adv-node').value = String(Math.min(params.N - 1, Math.max(0, Math.round(+$('adv-node').value) || 0)));
  if (refreshLabels) refreshSelectionText();
  else if (custom) updateCustomDescription();
  render();
  curveEditor.simulationRestarted();
  return true;
}

const targetSteps = () => Math.ceil(2 * +$('adv-circuits').value / (Math.abs(sims[0].a) * sims[0].dt) - 1e-10);
const done = () => stepNumber >= targetSteps() || sims.every(sim => sim.failed);
function advanceOne() {
  if (done()) return;
  sims.forEach((sim, index) => {
    if (sim.failed) return;
    snapshots[index] = { u: sim.u.slice(), t: sim.t };
    sim.step();
  });
  stepNumber++;
}
function stop() {
  playing = false; cancelAnimationFrame(frame); lastFrame = 0; accumulator = 0;
}
function tick(now) {
  if (!playing) return;
  if (lastFrame) accumulator += Math.min(now - lastFrame, 150) * +$('adv-playback').value / 1000;
  lastFrame = now;
  let advanced = false;
  while (accumulator >= 1 && !done()) { advanceOne(); accumulator--; advanced = true; }
  if (done()) stop();
  if (advanced || !playing) render();
  if (playing) frame = requestAnimationFrame(tick);
}
function play() {
  if (runningToEnd || !parametersValid) return;
  if (playing) stop();
  else if (!done()) { playing = true; lastFrame = 0; frame = requestAnimationFrame(tick); }
  render();
}
async function finish() {
  if (runningToEnd || done() || !parametersValid) return;
  stop(); runningToEnd = true; const token = ++completionToken; render();
  // Yield between batches so reset, language and parameter controls remain usable.
  while (token === completionToken && !done()) {
    for (let n = 0; n < 80 && !done(); n++) advanceOne();
    render(); await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (token === completionToken) { runningToEnd = false; render(); }
}

function colors() {
  const dark = historyMedia.matches;
  return { bg: dark ? '#181818' : '#ffffff', ink: dark ? '#ededed' : '#202020', muted: dark ? '#aaaaaa' : '#686868', grid: dark ? '#363636' : '#e4e4e4', lines: dark ? ['#85b9e6','#e9ab76'] : ['#2867a4','#b56524'] };
}
function draw() {
  const canvas = $('adv-plot'), width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height || !sims.length) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  const color = colors(); ctx.clearRect(0,0,width,height); ctx.fillStyle = color.bg; ctx.fillRect(0,0,width,height);
  const margin = { left: 38, right: 14, top: 16, bottom: 32 }, pw = width-margin.left-margin.right, ph = height-margin.top-margin.bottom;
  const yMin = -.25, yMax = 1.25;
  const X = x => margin.left + (x+1) * pw/2;
  const Y = y => margin.top + (yMax-Math.max(-1e4,Math.min(1e4,y))) * ph/(yMax-yMin);
  ctx.font = '11px system-ui'; ctx.lineWidth = 1; ctx.textAlign = 'right';
  for (const y of [0,.5,1]) {
    ctx.strokeStyle = color.grid; ctx.beginPath(); ctx.moveTo(margin.left,Y(y)); ctx.lineTo(width-margin.right,Y(y)); ctx.stroke();
    ctx.fillStyle = color.muted; ctx.fillText(y.toFixed(1),margin.left-7,Y(y)+4);
  }
  ctx.textAlign = 'center';
  for (const x of [-1,-.5,0,.5,1]) { ctx.fillStyle = color.muted; ctx.fillText(String(x),X(x),height-12); }
  ctx.fillText('x',width-8,height-28); ctx.textAlign = 'left'; ctx.fillText('u',8,13);
  ctx.save(); ctx.beginPath(); ctx.rect(margin.left,margin.top,pw,ph); ctx.clip();
  let clipped = false;
  function line(values, stroke, dashed) {
    ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = dashed ? 1.7 : 2; ctx.setLineDash(dashed ? [5,4] : []);
    for (let i = 0; i <= values.length; i++) {
      const v = values[i % values.length]; if (!Number.isFinite(v)) continue;
      if (v<yMin || v>yMax) clipped = true;
      const x = X(i === values.length ? 1 : sims[0].x[i]), y = Y(v);
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  sims.forEach((sim,i) => { if (!sim.failed) line(sim.u,color.lines[i],false); });
  line(sims[0].exact(stepNumber*sims[0].dt),color.ink,true);
  ctx.restore(); ctx.setLineDash([]);
  setText('adv-chart-note', clipped ? t('Some values are outside the fixed plot range. See min/max below; computed values are not clipped.', '部分数值已超出固定纵轴范围，请看下方最小/最大值；计算结果没有截断。') : t('Dashed: exact translation · solid: numerical values · periodic boundaries', '虚线：精确平移解 · 实线：数值解 · 周期边界'));
}

function render() {
  if (!sims.length) return;
  const sim = sims[0], time = stepNumber*sim.dt;
  setText('adv-play', playing ? t('Pause','暂停') : t('Play','播放'));
  // These labels are stateful; leave them outside the static attribute translator.
  $('adv-play').removeAttribute('data-en'); $('adv-play').removeAttribute('data-zh');
  $('adv-play').disabled = runningToEnd || done() || !parametersValid;
  for (const id of ['adv-step','adv-inspect-step','adv-finish']) $(id).disabled = runningToEnd || done() || !parametersValid;
  setText('adv-parameters', `x ∈ [−1, 1) · Δx = ${num(sim.dx)} · Δt = ${num(sim.dt,5)} · C = ${num(Math.sign(sim.a)*sim.cfl,2)}`);
  setText('adv-time', `n = ${stepNumber} · t = ${num(time,4)}`);
  const legend = $('adv-legend'); legend.replaceChildren();
  [t('Exact','精确解'), ...sims.map((s,i) => `${i?'B':'A'} · ${names(meta(s.scheme))}`)].forEach((label,i) => {
    const span = element('span'); span.append(element('i',undefined,i===0?'adv-line-exact':i===2?'adv-line-b':'adv-line-a'),document.createTextNode(label)); legend.append(span);
  });
  const table = $('adv-results'); table.replaceChildren();
  sims.forEach((s,i) => {
    const m = s.metrics(), row = element('tr'), name = element('td', `${i?'B':'A'} · ${names(meta(s.scheme))}`);
    if (s.failed) name.append(element('strong',t('Stopped at t = ','已停算，t = ')+num(s.t)));
    row.append(name,element('td',sci(m.l2)),element('td',sci(m.linf)),element('td',`${num(m.min,3)} / ${num(m.max,3)}`),element('td',sci(m.massError))); table.append(row);
  });
  let status = runningToEnd ? t('Computing…','计算中…') : playing ? t('Running.','正在推进。') : done() ? t('Run complete. Reset to start again.','本次计算结束，重置后可重新开始。') : t('Paused. Step through the calculation or press Play.','已暂停，可单步计算或播放。');
  if (sims.some(s=>s.failed)) status += t(' A stopped scheme is frozen at its last finite step and omitted from the plot. The threshold 10⁶ is a numerical guard, not a stability test.','停算格式保留最后一个有限时间层，并从曲线图移除。10⁶ 阈值仅用于避免数值溢出，不是稳定性判据。');
  if (sims.some(s=>s.scheme==='maccormack') && sims.some(s=>s.scheme==='lax-wendroff')) status += t(' Lax–Wendroff and MacCormack coincide for this linear problem.','本线性问题中 Lax–Wendroff 与 MacCormack 的曲线重合。');
  if (stepNumber >= targetSteps() && Math.abs(time-2*+$('adv-circuits').value/Math.abs(sim.a))>1e-9) status += t(' The run stops at the first full step beyond the requested duration; the exact solution uses the displayed time.','按固定时间步长算至首次达到目标时长的整步；精确解使用显示的实际时间。');
  if (!parametersValid) status = t('Enter a CFL from 0.05 to 2 in increments of 0.05. The previous result remains displayed; stepping is paused until the value is valid.', '请输入 0.05 至 2 范围内、间隔为 0.05 的 CFL。当前保留上次结果，修正输入后才能推进。');
  setText('adv-status',status); draw(); renderStencil();
}

function renderStencil() {
  const k = +$('adv-inspect').value, sim = sims[k]; if (!sim) return;
  const input = +$('adv-node').value, i = Math.min(sim.N-1,Math.max(0,Math.round(input)||0));
  const prior = snapshots[k], values = prior?.u || sim.u, scheme = meta(sim.scheme), root = $('adv-stencil');
  const detailsOpen = root.querySelector('details')?.open || false; root.replaceChildren();
  root.append(element('h3',names(scheme)),element('div',scheme.formula,'adv-formula-text'));
  root.append(element('p', `${t('Input field','输入时间层')}: t = ${num(prior?.t ?? sim.t)} · i = ${i} · xᵢ = ${num(sim.x[i])}`));
  const grid = element('div',undefined,'adv-stencil-grid');
  for(let d=-2;d<=2;d++) { const j = mod(i+d,sim.N), box = element('div',d ? `i ${d<0?'−':'+'} ${Math.abs(d)}` : 'i'); box.dataset.center=String(d===0); box.append(element('strong',Math.abs(values[j])>=10?sci(values[j]):num(values[j],5)),element('small',`j = ${j}`)); grid.append(box); }
  root.append(grid);
  if (prior) root.append(element('p', `${t('Updated center value','更新后的中心值')}: u[${i}] = ${num(sim.u[i],6)} · t = ${num(sim.t)}${sim.failed?t(' · stopped',' · 已停算'):''}`));
  else root.append(element('p',t('Advance one step to see the input neighborhood and the resulting center value.','推进一步后，可对照输入邻点与更新后的中心值。')));
  const details = element('details',undefined,'parameter-help'); details.open = detailsOpen; details.append(element('summary',t('Stencil details','模板说明')));
  const body = element('div',undefined,'parameter-help-body'); body.append(element('p',t(scheme.noteEn,scheme.noteZh)));
  if (['implicit-upwind','crank-nicolson'].includes(sim.scheme)) body.append(element('p',t('These boxes show input values only. Values at n+1 are coupled across the periodic domain and are solved together.','方框仅展示输入值；n+1 层的未知量在整个周期区域中耦合，需要联立求解。')));
  if (sim.scheme==='leapfrog') body.append(element('p',t('The formula also needs uᵢⁿ⁻¹; the boxes show only the current input level n.','该公式还需要 uᵢⁿ⁻¹，方框只展示当前输入层 n。')));
  details.append(body); root.append(details);
}

function exportCSV() {
  const exact = sims[0].exact(stepNumber*sims[0].dt), rows = [['x','exact_at_comparison_time',sims[0].scheme,sims[1].scheme,'comparison_time','scheme_A_time','scheme_B_time']];
  sims[0].x.forEach((x,i)=>rows.push([x,exact[i],sims[0].u[i],sims[1].u[i],stepNumber*sims[0].dt,sims[0].t,sims[1].t]));
  const blob = new Blob([rows.map(row=>row.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href=url; link.download=`advection-${stepNumber}.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const curveEditor = mountCurveEditor($('adv-curve-editor'), {
  value: readSavedCurve(),
  sampleCount: +control.N.value,
  onChange(value) {
    rememberCurve(value);
    if (control.profile.value === 'custom') return reset(false);
  }
});
const requestedProfile = new URL(location.href).searchParams.get('profile');
populate(control.profile,PROFILES,requestedProfile === 'custom' ? 'custom' : 'composite');
selectors.forEach((select,i)=>populate(select,SCHEMES,i?'lax-wendroff':'upwind'));
Object.values(control).forEach(node=>node.addEventListener('change',reset));
control.cfl.addEventListener('input',()=>{
  if (control.cfl.checkValidity() && control.cfl.value !== '') reset();
  else { stop(); completionToken++; runningToEnd=false; parametersValid=false; render(); }
});
selectors.forEach(node=>node.addEventListener('change',reset));
$('adv-play').addEventListener('click',play);
$('adv-step').addEventListener('click',()=>{stop();advanceOne();render();});
$('adv-inspect-step').addEventListener('click',()=>{stop();advanceOne();render();});
$('adv-reset').addEventListener('click',reset);
$('adv-finish').addEventListener('click',finish);
$('adv-export').addEventListener('click',exportCSV);
$('adv-inspect').addEventListener('change',renderStencil);
$('adv-node').addEventListener('change',()=>{ $('adv-node').value=String(Math.min(sims[0].N-1,Math.max(0,Math.round(+$('adv-node').value)||0))); renderStencil(); });
$('adv-circuits').addEventListener('change',()=>{if(done())stop();render();});
document.querySelectorAll('[data-experiment]').forEach(button=>button.addEventListener('click',()=>{
  const presets={diffusion:['square','upwind','lax',.5],oscillation:['square','upwind','lax-wendroff',.5],unstable:['square','lax-wendroff','crank-nicolson',1.2],course:['composite','lax','cip',.5]};
  const [profile,a,b,cfl]=presets[button.dataset.experiment];
  control.profile.value=profile;selectors[0].value=a;selectors[1].value=b;control.cfl.value=String(cfl);control.N.value='200';control.a.value='1';$('adv-circuits').value='1';reset();
}));
window.addEventListener('languagechange',()=>{curveEditor.refreshLanguage();refreshSelectionText();render();});
new ResizeObserver(draw).observe($('adv-plot'));
historyMedia.addEventListener('change',draw);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();render();}});
reset();
