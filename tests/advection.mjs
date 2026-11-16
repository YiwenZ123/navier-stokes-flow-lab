import assert from 'node:assert/strict';
import { SCHEMES, PROFILES, createSimulation, initialValue } from '../dist/advection-solver.js';
const near=(a,b,tol=1e-11,message='values differ')=>assert.ok(Math.abs(a-b)<=tol,`${message}: ${a} vs ${b}`);
const norm=u=>Math.sqrt(u.reduce((sum,v)=>sum+v*v,0)/u.length);
const distance=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const mass=s=>s.dx*s.u.reduce((sum,v)=>sum+v,0);
const evolve=(s,n)=>{for(let i=0;i<n;i++)s.step();return s;};
assert.equal(SCHEMES.length,10);
assert.equal(PROFILES.length,6);

// Every stencil and cyclic implicit solve must preserve a constant state.
for(const {id} of SCHEMES) for(const a of [1,-1]) {
 const s=createSimulation({scheme:id,profile:'sine',N:80,a,cfl:.5});
 s.u.fill(.73); s.g.fill(0); evolve(s,6);
 assert.ok(distance(s.u,new Float64Array(s.N).fill(.73))<2e-14,`constant: ${id}, a=${a}`);
}

// At C=1 the explicit transporting schemes shift exactly by one grid cell.
for(const id of ['upwind','lax','lax-wendroff','leapfrog','maccormack','beam-warming','cip']) for(const a of [1,-1]) {
 const s=createSimulation({scheme:id,profile:'composite',N:80,a,cfl:1}),before=s.u.slice(),beforeG=s.g.slice();
 evolve(s,13);
 assert.ok(distance(s.u,Float64Array.from({length:80},(_,i)=>before[(i-13*a+80)%80]))<3e-13,`integer transport ${id}, ${a}`);
 assert.ok(s.metrics().l2<3e-13,`exact reference aligns at jumps: ${id}`);
 if(id==='cip') assert.ok(distance(s.g,Float64Array.from({length:80},(_,i)=>beforeG[(i-13*a+80)%80]))<1e-11);
}

// Reflection symmetry tests every sign-aware stencil, including implicit/CIP.
for(const {id} of SCHEMES) {
 const pos=createSimulation({scheme:id,profile:'sine',N:80,a:1,cfl:.4});
 const neg=createSimulation({scheme:id,profile:'sine',N:80,a:-1,cfl:.4});
 for(let i=0;i<80;i++) {pos.u[i]=.5+.25*Math.sin(2*Math.PI*i/80)+.1*Math.cos(6*Math.PI*i/80);pos.g[i]=0;}
 for(let i=0;i<80;i++) {neg.u[i]=pos.u[(80-i)%80];neg.g[i]=-pos.g[(80-i)%80];}
 evolve(pos,20);evolve(neg,20);
 assert.ok(distance(neg.u,Float64Array.from({length:80},(_,i)=>pos.u[(80-i)%80]))<1e-11,`velocity reflection: ${id}`);
}

// Periodic mass conservation. CIP uses centered initial slopes whose sum is 0;
// for this uniform, constant-speed periodic case it also preserves total mass.
for(const {id} of SCHEMES) {
 const s=createSimulation({scheme:id,profile:'composite',N:100,cfl:.5}); const m=mass(s);
 evolve(s,id==='ftcs'?12:100);
 near(mass(s),m,2e-11,`periodic mass: ${id}`);
 assert.ok(s.metrics().massError<2e-11);
}

// Independent Fourier amplification factors validate the implicit cyclic solves
// at C=2 (including phase, not just boundedness).
for(const id of ['implicit-upwind','crank-nicolson']) for(const a of [1,-1]) {
 const s=createSimulation({scheme:id,profile:'sine',N:64,a,cfl:2}),theta=10*Math.PI/64;
 for(let i=0;i<s.N;i++) s.u[i]=Math.cos(theta*i);
 let dr,di;
 if(id==='implicit-upwind') {dr=1+2*(1-Math.cos(theta));di=2*a*Math.sin(theta);}
 else {dr=1;di=a*Math.sin(theta);}
 let gr=dr/(dr*dr+di*di),gi=-di/(dr*dr+di*di);
 if(id==='crank-nicolson') {const nr=1,ni=-di;[gr,gi]=[nr*gr-ni*gi,nr*gi+ni*gr];}
 s.step();
 const target=Float64Array.from({length:64},(_,i)=>gr*Math.cos(theta*i)-gi*Math.sin(theta*i));
 assert.ok(distance(s.u,target)<1e-13,`Fourier mode: ${id}, ${a}`);
}

// CN is nondissipative at any tested CFL; implicit upwind damps the L2 norm.
for(const id of ['implicit-upwind','crank-nicolson']) {
 const s=createSimulation({scheme:id,profile:'composite',N:100,cfl:2});const before=norm(s.u);
 evolve(s,300);assert.ok(!s.failed);
 if(id==='crank-nicolson') near(norm(s.u),before,1e-12,'CN discrete L2 norm');
 else assert.ok(norm(s.u)<before);
}

// Order of accuracy against exact translation after one full circuit.
for(const id of ['upwind','implicit-upwind','lax','lax-wendroff','leapfrog','crank-nicolson','maccormack','beam-warming','cip']) {
 const errors=[80,160].map(N=>evolve(createSimulation({scheme:id,profile:'sine',N,cfl:.5}),2*N).metrics().l2);
 const order=Math.log2(errors[0]/errors[1]);
 const minimum=['upwind','implicit-upwind','lax'].includes(id)?.8:id==='cip'?2.8:1.9;
 assert.ok(order>minimum&&order<minimum+.5,`${id} observed order ${order}`);
}

// MacCormack must match LW exactly for a constant-speed scalar linear PDE.
for(const a of [1,-1]) {
 const left=evolve(createSimulation({scheme:'lax-wendroff',N:100,profile:'composite',a,cfl:.7}),40);
 const right=evolve(createSimulation({scheme:'maccormack',N:100,profile:'composite',a,cfl:.7}),40);
 assert.ok(distance(left.u,right.u)<2e-14);
}

// FTCS's high-frequency mode grows by |G|=sqrt(1+C² sin² θ).
{
 const s=createSimulation({scheme:'ftcs',profile:'sine',N:64,cfl:.5});
 for(let i=0;i<s.N;i++) s.u[i]=Math.cos(Math.PI*i/2);
 const before=norm(s.u); evolve(s,20);
 near(norm(s.u)/before,Math.pow(1.25,10),2e-12,'FTCS amplification');
}
// Outside the admissible range an unstable method really grows; no hidden dt.
{
 const s=createSimulation({scheme:'upwind',profile:'square',N:64,cfl:1.5});const dt=s.dt;
 evolve(s,200);assert.ok(s.failed);near(s.dt,dt,0);
 const frozen=s.u.slice(),time=s.t,steps=s.steps;s.step();
 assert.deepEqual(s.u,frozen);assert.equal(s.t,time);assert.equal(s.steps,steps);
 // The shared comparison may request the exact solution beyond this frozen t.
 assert.deepEqual(s.exact(2),createSimulation({scheme:'upwind',profile:'square',N:64}).u);
}

// CIP exactly reproduces a cubic within an interior upwind interval and updates
// its derivative consistently (tested separately for both velocity signs).
for(const a of [1,-1]) {
 const s=createSimulation({scheme:'cip',profile:'sine',N:80,a,cfl:.6});
 const f=x=>x*x*x+2*x*x-3*x+.4, df=x=>3*x*x+4*x-3;
 for(let i=0;i<s.N;i++){s.u[i]=f(s.x[i]);s.g[i]=df(s.x[i]);}
 s.step();const i=40,departure=s.x[i]-a*s.dt;
 near(s.u[i],f(departure),1e-14,'CIP cubic');near(s.g[i],df(departure),1e-13,'CIP derivative');
}

// Validate the actual course composite, including its printed base-10 log.
{
 const d=.005,b=Math.log10(2)/(36*d*d);
 near(initialValue('composite',-.7),(2*Math.exp(-b*d*d)+4)/6,1e-14);
 near(initialValue('composite',-.3),1); near(initialValue('composite',.1),1);
 near(initialValue('composite',.5),(2*Math.sqrt(1-100*d*d)+4)/6,1e-14);
 near(initialValue('composite',-.5),0); near(initialValue('composite',.3),0);
 for(const p of PROFILES) for(const x of [-.97,-.63,-.3,.03,.52,.91]) near(initialValue(p.id,x),initialValue(p.id,x+2),1e-13);
}
// Closed endpoints in the course's piecewise initial data must survive both
// periodic normalisation and floating-point grid construction (N=200).
{
 const delta=.005,beta=Math.log10(2)/(36*delta*delta);
 const gaussian=x=>{const g=z=>Math.exp(-beta*(x-z)**2);return (g(-.7-delta)+g(-.7+delta)+4*g(-.7))/6;};
 const semicircle=x=>{const f=b=>Math.sqrt(Math.max(1-100*(x-b)**2,0));return (f(.5-delta)+f(.5+delta)+4*f(.5))/6;};
 const endpoints=[[-.8,gaussian(-.8)],[-.6,gaussian(-.6)],[-.4,1],[-.2,1],[0,0],[.2,0],[.4,semicircle(.4)],[.6,semicircle(.6)]];
 const sim=createSimulation({scheme:'upwind',profile:'composite',N:200});
 for(const [edge,value] of endpoints) {
   for(const offset of [-2,0,2]) near(initialValue('composite',edge+offset),value,1e-13,`closed endpoint ${edge}, offset ${offset}`);
   const index=Math.round((edge+1)/sim.dx);
   near(sim.u[index],value,1e-13,`N=200 endpoint i=${index}`);
 }
 assert.ok(initialValue('composite',.4)>.05&&initialValue('composite',.6)>.05);
 // Square uses a closed left and open right endpoint; normalisation preserves it.
 for(const offset of [-2,0,2]) {near(initialValue('square',-.5+offset),1);near(initialValue('square',offset),0);}
}
for(const params of [{N:1},{cfl:0},{cfl:2.1},{a:0},{scheme:'missing'},{profile:'missing'}]) assert.throws(()=>createSimulation(params),RangeError);
console.log('PASS: 10 schemes; constants, exact shifts, signed transport, mass, implicit Fourier phase/L², convergence, instability, CIP derivative and course initial data.');
