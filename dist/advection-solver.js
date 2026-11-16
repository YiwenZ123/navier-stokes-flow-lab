import { DEFAULT_CURVE, createCurveProfile } from './custom-profile.js?v=341dbc61d218';

/* Constant-coefficient 1D transport on a periodic [-1, 1) grid.
 * Formulas follow CFD 4; sign-aware stencils support either velocity direction.
 * No filtering, clipping, substepping or artificial stabilisation is applied.
 */
const defaultCustomProfile = createCurveProfile(DEFAULT_CURVE);
const wrap = x => x - 2 * Math.floor((x + 1) / 2);
const mod = (i, n) => (i % n + n) % n;
const common = {
  first: ['First order at fixed CFL', '固定 CFL 下一阶'],
  second: ['Second order in time and space', '时间、空间二阶'],
};
function scheme(id, nameEn, nameZh, order, stability, pages, formula, notes) {
  return { id, nameEn, nameZh, orderEn: order[0], orderZh: order[1], stabilityEn: stability[0], stabilityZh: stability[1], pages, formula, noteEn: notes[0], noteZh: notes[1] };
}
export const SCHEMES = [
  scheme('upwind', 'Upwind', '一阶迎风', common.first, ['|C| ≤ 1', '|C| ≤ 1'], '13–14',
    'uᵢⁿ⁺¹ = uᵢⁿ − r(uᵢⁿ − uᵢ₋ₛⁿ)',
    ['First-order numerical diffusion smooths sharp profiles. Here C = aΔt/Δx, r = |C|, s = sign(a).', '一阶数值耗散会抹平陡峭波形。这里 C = aΔt/Δx，r = |C|，s = sign(a)。']),
  scheme('implicit-upwind', 'Implicit upwind', '隐式迎风', common.first, ['All CFL values (linear stability)', '任意 CFL（线性稳定性）'], '9–10',
    '(1 + r)uᵢⁿ⁺¹ − r uᵢ₋ₛⁿ⁺¹ = uᵢⁿ',
    ['Backward Euler with an upwind spatial difference. A periodic linear system is solved each step. Large steps are stable but very diffusive; this combines the implicit-time and upwind stencils introduced in the course.', '后向欧拉配合迎风空间差分，每步求解周期线性方程组。大时间步稳定，但耗散很强；这是课件隐式时间层与迎风模板的组合。']),
  scheme('ftcs', 'FTCS', 'FTCS 中心差分', ['O(Δt, Δx²)', 'O(Δt, Δx²)'], ['Unstable for nonzero C', 'C ≠ 0 时不稳定'], '15–16',
    'uᵢⁿ⁺¹ = uᵢⁿ − (C/2)(uᵢ₊₁ⁿ − uᵢ₋₁ⁿ)',
    ['An unstable counterexample: forward Euler in time and centered space. A smooth low-frequency wave may take many steps to show growth.', '用于观察失稳的反例：时间前向、空间中心。光滑低频波形可能需要很多步才显出增长。']),
  scheme('lax', 'Lax–Friedrichs', 'Lax–Friedrichs', common.first, ['|C| ≤ 1', '|C| ≤ 1'], '15–16',
    'uᵢⁿ⁺¹ = (uᵢ₊₁ⁿ + uᵢ₋₁ⁿ)/2 − (C/2)(uᵢ₊₁ⁿ − uᵢ₋₁ⁿ)',
    ['The spatial average stabilizes FTCS but introduces diffusion. Error is O(Δt, Δx²/Δt), giving first order when CFL is held fixed.', '用邻点平均替代中心值，使 FTCS 稳定，但引入耗散。误差为 O(Δt, Δx²/Δt)，固定 CFL 时为一阶。']),
  scheme('lax-wendroff', 'Lax–Wendroff', 'Lax–Wendroff', common.second, ['|C| ≤ 1', '|C| ≤ 1'], '18, 21, 29',
    'uᵢⁿ⁺¹ = uᵢⁿ − (C/2)(uᵢ₊₁ⁿ − uᵢ₋₁ⁿ) + (C²/2)(uᵢ₊₁ⁿ − 2uᵢⁿ + uᵢ₋₁ⁿ)',
    ['Less diffusion than first-order upwind, but dispersion causes oscillations near jumps.', '比一阶迎风耗散更小，但色散会在间断附近产生振荡。']),
  scheme('leapfrog', 'Leapfrog', '蛙跳格式', common.second, ['|C| < 1; |C| = 1 is marginal', '|C| < 1；|C| = 1 为临界情形'], '19',
    'uᵢⁿ⁺¹ = uᵢⁿ⁻¹ − C(uᵢ₊₁ⁿ − uᵢ₋₁ⁿ)',
    ['Uses two previous time levels. The first step uses Lax–Wendroff. No time filter is applied, so the computational mode remains visible.', '使用前两个时间层；第一步用 Lax–Wendroff 启动。不加时间滤波，可观察计算模态。']),
  scheme('crank-nicolson', 'Crank–Nicolson', 'Crank–Nicolson', common.second, ['All CFL values (linear stability)', '任意 CFL（线性稳定性）'], '20',
    'uᵢⁿ⁺¹ + (C/4)(uᵢ₊₁ⁿ⁺¹ − uᵢ₋₁ⁿ⁺¹) = uᵢⁿ − (C/4)(uᵢ₊₁ⁿ − uᵢ₋₁ⁿ)',
    ['Centered space with trapezoidal time integration. The periodic solve preserves the discrete L² norm, but a large CFL still creates phase error and oscillations.', '空间中心、时间梯形积分。周期求解保持离散 L² 范数，但大 CFL 仍有相位误差和振荡。']),
  scheme('maccormack', 'MacCormack', 'MacCormack', common.second, ['|C| ≤ 1', '|C| ≤ 1'], '22',
    'ũᵢ = uᵢⁿ − r(uᵢ₊ₛⁿ − uᵢⁿ)\nuᵢⁿ⁺¹ = [uᵢⁿ + ũᵢ − r(ũᵢ − ũᵢ₋ₛ)]/2',
    ['A forward predictor and backward corrector, mirrored for negative velocity. For this linear constant-speed equation it is algebraically equivalent to Lax–Wendroff.', '前向预测、后向校正，负速度时镜像。在本常系数线性方程中，它与 Lax–Wendroff 代数等价。']),
  scheme('beam-warming', 'Beam–Warming', 'Beam–Warming 二阶迎风', common.second, ['|C| ≤ 2', '|C| ≤ 2'], '30',
    'uᵢⁿ⁺¹ = uᵢⁿ − r(uᵢⁿ − uᵢ₋ₛⁿ) − r(1 − r)(uᵢⁿ − 2uᵢ₋ₛⁿ + uᵢ₋₂ₛⁿ)/2',
    ['Uses two upstream neighbors. Although linearly stable through |C| = 2, it is not monotone and can overshoot a discontinuity.', '使用两个上游邻点。虽在线性意义下可稳定到 |C| = 2，但不保持单调，间断附近可能过冲。']),
  scheme('cip', 'CIP', 'CIP 三次插值', ['Cubic Hermite interpolation', '三次 Hermite 插值'], ['Local interpolation: |C| ≤ 1', '局部插值范围：|C| ≤ 1'], '31–32',
    'P(ξ) = Aξ³ + Bξ² + gᵢξ + uᵢ\nuᵢⁿ⁺¹ = P(−aΔt),  gᵢⁿ⁺¹ = P′(−aΔt)\nP(0)=uᵢ, P′(0)=gᵢ; P(−sΔx)=uᵢ₋ₛ, P′(−sΔx)=gᵢ₋ₛ',
    ['Transports both u and its slope g. Initial slopes use periodic centered differences. This is the local two-node CIP formula: |C| > 1 extrapolates that same polynomial, without hidden substeps or a multi-cell extension. CIP evolves point values and slopes rather than using a conservative flux formulation.', '同时输运 u 和斜率 g；初始斜率用周期中心差分。本演示采用局部两节点 CIP：|C| > 1 时仍对该多项式外推，不自动细分时间步，也未扩展为跨多单元回溯。CIP 演化节点值与斜率，不采用守恒通量形式。']),
];
export const PROFILES = [
  { id:'composite', nameEn:'Course composite', nameZh:'课件复合波形', formula:'Gaussian packet + square + triangle + semicircle', noteEn:'CFD 4, p. 38: z = −0.7, b = 0.5, δ = 0.005, α = 10, β = log₁₀(2)/(36δ²), following the printed course parameter.', noteZh:'CFD 4 第 38 页：z = −0.7、b = 0.5、δ = 0.005、α = 10、β = log₁₀(2)/(36δ²)，按课件印出的参数取值。' },
  { id:'sine', nameEn:'Sine wave', nameZh:'正弦波', formula:'u₀(x) = 0.5 + 0.5 sin(πx)', noteEn:'A smooth periodic wave makes amplitude and phase errors easy to compare.', noteZh:'光滑周期波便于比较振幅误差与相位误差。' },
  { id:'gaussian', nameEn:'Gaussian pulse', nameZh:'高斯脉冲', formula:'u₀(x) = exp[−100 d(x, −0.5)²]', noteEn:'d is the shortest periodic distance on the length-2 domain.', noteZh:'d 为长度 2 的周期区域上的最短距离。' },
  { id:'square', nameEn:'Square pulse', nameZh:'方波脉冲', formula:'u₀(x) = 1 for −0.5 ≤ x < 0; otherwise 0', noteEn:'Sharp jumps expose diffusion, overshoot and undershoot.', noteZh:'陡峭间断便于观察耗散、过冲与欠冲。' },
  { id:'triangle', nameEn:'Triangle pulse', nameZh:'三角脉冲', formula:'u₀(x) = max(1 − |d(x, −0.5)|/0.25, 0)', noteEn:'Continuous but not smooth at the corners.', noteZh:'波形连续，但尖角处不光滑。' },
  { id:'custom', nameEn:'Custom initial condition', nameZh:'自定义初始条件', formula:'u₀(x) = interpolation of the shared control points', noteEn:'Both schemes sample the same curve on the selected grid. Exact transport translates this interpolated profile. Linked endpoints match values and, in smooth mode, derivatives; unlinked endpoints create a periodic jump.', noteZh:'两种格式在所选网格上采样同一条曲线；精确解对该插值曲线作平移。首尾联动时高度相同，平滑模式还匹配斜率；解除联动时，周期接缝允许间断。' },
];
export function initialValue(profile, x) {
  if (profile === 'custom') return defaultCustomProfile.value(x);
  x = wrap(x);
  // Normalisation and x_i = -1 + iΔx can round exact jump endpoints
  // to either side. Snap only the prescribed breakpoints, within roundoff.
  const breakpoints = profile === 'composite' ? [-.8, -.6, -.4, -.2, 0, .2, .4, .6]
    : profile === 'square' ? [-.5, 0] : [];
  for (const edge of breakpoints) if (Math.abs(x - edge) < 1e-12) { x = edge; break; }
  switch (profile) {
    case 'sine': return .5 + .5 * Math.sin(Math.PI * x);
    case 'gaussian': return Math.exp(-100 * wrap(x + .5) ** 2);
    case 'square': return x >= -.5 && x < 0 ? 1 : 0;
    case 'triangle': return Math.max(1 - Math.abs(wrap(x + .5)) / .25, 0);
    case 'composite': {
      const delta=.005, beta=Math.log10(2)/(36*delta*delta);
      if (x >= -.8 && x <= -.6) {
        const G=z=>Math.exp(-beta*(x-z)**2);
        return (G(-.7-delta)+G(-.7+delta)+4*G(-.7))/6;
      }
      if (x >= -.4 && x <= -.2) return 1;
      if (x >= 0 && x <= .2) return 1-Math.abs(10*(x-.1));
      if (x >= .4 && x <= .6) {
        const F=b=>Math.sqrt(Math.max(1-100*(x-b)**2,0));
        return (F(.5-delta)+F(.5+delta)+4*F(.5))/6;
      }
      return 0;
    }
    default: throw new RangeError('Unknown initial condition');
  }
}

// Sherman–Morrison correction to a pre-factored tridiagonal system.
// alpha=A[0,N-1], beta=A[N-1,0]; all coefficients are constant here.
function periodicSolver(n, lower, diagonal, upper) {
  const alpha=lower, beta=upper, gamma=-diagonal;
  const inv=new Float64Array(n), cp=new Float64Array(n);
  inv[0]=1/(diagonal-gamma); cp[0]=upper*inv[0];
  for(let i=1;i<n;i++) {
    const d=i===n-1 ? diagonal-alpha*beta/gamma : diagonal;
    inv[i]=1/(d-lower*cp[i-1]); cp[i]=upper*inv[i];
  }
  function triangular(rhs) {
    const out=new Float64Array(n); out[0]=rhs[0]*inv[0];
    for(let i=1;i<n;i++) out[i]=(rhs[i]-lower*out[i-1])*inv[i];
    for(let i=n-2;i>=0;i--) out[i]-=cp[i]*out[i+1];
    return out;
  }
  const rankOne=new Float64Array(n); rankOne[0]=gamma; rankOne[n-1]=beta;
  const z=triangular(rankOne), denominator=1+z[0]+alpha*z[n-1]/gamma;
  return rhs => {
    const out=triangular(rhs), factor=(out[0]+alpha*out[n-1]/gamma)/denominator;
    for(let i=0;i<n;i++) out[i]-=factor*z[i];
    return out;
  };
}

export function createSimulation({scheme='upwind',profile='composite',N=200,a=1,cfl=.5,customCurve}={}) {
  if (!SCHEMES.some(s=>s.id===scheme)) throw new RangeError('Unknown difference scheme');
  if (!PROFILES.some(p=>p.id===profile)) throw new RangeError('Unknown initial condition');
  if (!Number.isInteger(N)||N<8||N>1000) throw new RangeError('N must be an integer from 8 to 1000');
  if (!Number.isFinite(a)||a===0) throw new RangeError('Velocity must be finite and nonzero');
  if (!Number.isFinite(cfl)||cfl<=0||cfl>2) throw new RangeError('CFL must be in (0, 2]');
  const dx=2/N, dt=cfl*dx/Math.abs(a), C=Math.sign(a)*cfl, r=cfl, s=Math.sign(a);
  const x=Float64Array.from({length:N},(_,i)=>-1+i*dx);
  const curveProfile = profile === 'custom' ? createCurveProfile(customCurve ?? DEFAULT_CURVE) : null;
  const valueAt = curveProfile ? curveProfile.value : xi => initialValue(profile, xi);
  const initial=Float64Array.from(x,valueAt);
  const initialMass=initial.reduce((v,w)=>v+w,0)*dx;
  let previous=null;
  const implicit = scheme==='crank-nicolson' ? periodicSolver(N,-C/4,1,C/4)
    : scheme==='implicit-upwind' ? periodicSolver(N,s>0?-r:0,1+r,s<0?-r:0) : null;
  const sim={scheme,profile,N,a,cfl,dx,dt,x,initialCurve:curveProfile?.curve ?? null,u:initial.slice(),g:new Float64Array(N),t:0,steps:0,failed:false,failureReason:'',
    step() {
      if(this.failed) return;
      const u=this.u; let next=new Float64Array(N), nextG=null;
      if(scheme==='implicit-upwind') next=implicit(u);
      else if(scheme==='crank-nicolson') {
        for(let i=0;i<N;i++) next[i]=u[i]-C/4*(u[(i+1)%N]-u[(i+N-1)%N]);
        next=implicit(next);
      } else if(scheme==='maccormack') {
        const predicted=new Float64Array(N);
        for(let i=0;i<N;i++) predicted[i]=u[i]-r*(u[mod(i+s,N)]-u[i]);
        for(let i=0;i<N;i++) next[i]=.5*(u[i]+predicted[i]-r*(predicted[i]-predicted[mod(i-s,N)]));
      } else if(scheme==='cip') {
        nextG=new Float64Array(N);
        const ell=-s*dx, q=r, q2=q*q, q3=q2*q;
        const h00=2*q3-3*q2+1,h10=q3-2*q2+q,h01=-2*q3+3*q2,h11=q3-q2;
        const d00=6*q2-6*q,d10=3*q2-4*q+1,d01=-6*q2+6*q,d11=3*q2-2*q;
        for(let i=0;i<N;i++) {
          const j=mod(i-s,N);
          next[i]=h00*u[i]+h10*ell*this.g[i]+h01*u[j]+h11*ell*this.g[j];
          nextG[i]=(d00*u[i]+d10*ell*this.g[i]+d01*u[j]+d11*ell*this.g[j])/ell;
        }
      } else {
        for(let i=0;i<N;i++) {
          const left=u[(i+N-1)%N], right=u[(i+1)%N], upstream=u[mod(i-s,N)];
          switch(scheme) {
            case 'upwind': next[i]=u[i]-r*(u[i]-upstream); break;
            case 'ftcs': next[i]=u[i]-.5*C*(right-left); break;
            case 'lax': next[i]=.5*(left+right)-.5*C*(right-left); break;
            case 'lax-wendroff': next[i]=u[i]-.5*C*(right-left)+.5*C*C*(right-2*u[i]+left); break;
            case 'leapfrog': next[i]=previous ? previous[i]-C*(right-left) : u[i]-.5*C*(right-left)+.5*C*C*(right-2*u[i]+left); break;
            case 'beam-warming': next[i]=u[i]-r*(u[i]-upstream)-.5*r*(1-r)*(u[i]-2*upstream+u[mod(i-2*s,N)]); break;
          }
        }
      }
      const bad=next.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6) || (nextG && nextG.some(v=>!Number.isFinite(v)||Math.abs(v)*dx>1e6));
      if(bad) { this.failed=true; this.failureReason='Non-finite value or growth beyond the display safety threshold (10⁶).'; return; }
      if(scheme==='leapfrog') previous=u;
      this.u=next; if(nextG) this.g=nextG;
      this.steps++; this.t=this.steps*dt;
    },
    exact(time = this.t) {
      const shift=a*time/dx, nearest=Math.round(shift);
      // Grid-aligned departures must return exactly the sampled initial data,
      // especially at square-pulse jumps; avoid floating-point boundary flips.
      if(Math.abs(shift-nearest)<1e-9) return Float64Array.from({length:N},(_,i)=>initial[mod(i-nearest,N)]);
      return Float64Array.from(x,xi=>valueAt(xi-a*time));
    },
    metrics() {
      const exact=this.exact(); let abs=0,square=0,linf=0,min=Infinity,max=-Infinity,sum=0,totalVariation=0;
      for(let i=0;i<N;i++) {
        const v=this.u[i], e=Math.abs(v-exact[i]); abs+=e; square+=e*e; linf=Math.max(linf,e);
        min=Math.min(min,v); max=Math.max(max,v); sum+=v; totalVariation+=Math.abs(v-this.u[(i+N-1)%N]);
      }
      return {l1:abs/N,l2:Math.sqrt(square/N),linf,min,max,massError:Math.abs(sum*dx-initialMass),totalVariation};
    },
  };
  for(let i=0;i<N;i++) sim.g[i]=(initial[(i+1)%N]-initial[(i+N-1)%N])/(2*dx);
  return sim;
}
