// Paired bootstrap of LOO abs-log-error: model E (log-log TVL) and F vs baseline A (fixed 0.25). Also E's slope.
import { readFileSync, writeFileSync } from 'node:fs';
const snap = JSON.parse(readFileSync(process.argv[2]));
const EXC = new Set(['CEX','Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC']);
const asOf = Date.parse(snap.as_of);
const D = snap.protocols.filter(p => p.mcap_usd > 0 && p.tvl_usd > 0 && !EXC.has(p.category ?? '')).map(p => ({ y: Math.log(p.mcap_usd), x: Math.log(p.tvl_usd), a: Math.log1p(p.listed_at ? Math.max(0,(asOf-Date.parse(p.listed_at))/864e5) : 0), c: Math.log(Math.max(1,p.chains.length)) }));
function fit(tr, feat) { const k = feat(tr[0]).length, A = Array.from({length:k},()=>Array(k+1).fill(0));
  for (const p of tr) { const f = feat(p); for (let i=0;i<k;i++){ for(let j=0;j<k;j++) A[i][j]+=f[i]*f[j]; A[i][k]+=f[i]*p.y; } }
  for (let i=1;i<k;i++) A[i][i]+=1e-6*tr.length;
  for (let c=0;c<k;c++){ let m=c; for(let r=c+1;r<k;r++) if(Math.abs(A[r][c])>Math.abs(A[m][c])) m=r; [A[c],A[m]]=[A[m],A[c]]; for(let r=0;r<k;r++) if(r!==c){const f=A[r][c]/A[c][c]; for(let j=c;j<=k;j++) A[r][j]-=f*A[c][j];}}
  return A.map((r,i)=>r[k]/r[i]); }
const fE = p => [1, p.x], fF = p => [1, p.x, p.a, p.c];
const errA = [], errE = [], errF = [];
D.forEach((p,i) => { const tr = D.filter((_,j)=>j!==i); errA.push(Math.abs(p.y - p.x - Math.log(.25)));
  const wE = fit(tr,fE), wF = fit(tr,fF); errE.push(Math.abs(p.y - fE(p).reduce((s,v,k)=>s+v*wE[k],0))); errF.push(Math.abs(p.y - fF(p).reduce((s,v,k)=>s+v*wF[k],0))); });
let s = 777; const rnd = () => (s = (s*1664525+1013904223)>>>0)/2**32;
const boot = (e) => { const d = []; for (let b=0;b<5000;b++){ let t=0; for(let i=0;i<D.length;i++){ const j=Math.floor(rnd()*D.length); t += errA[j]-e[j]; } d.push(t/D.length);} d.sort((a,b)=>a-b); return { mean_improvement_mae_log: +(errA.reduce((a,b)=>a+b)/D.length - e.reduce((a,b)=>a+b)/D.length).toFixed(3), ci95: [+d[125].toFixed(3), +d[4875].toFixed(3)] }; };
const w = fit(D, fE);
const out = { n: D.length, E_full_fit: { intercept: +w[0].toFixed(3), slope_on_log_tvl: +w[1].toFixed(3) }, E_vs_A: boot(errE), F_vs_A: boot(errF) };
console.log(JSON.stringify(out, null, 1)); writeFileSync('audit/robust.json', JSON.stringify(out, null, 2));
