// Valuation audit: baselines vs candidates on token-bearing protocols. Stdlib only. Run: node audit/audit.mjs <snapshot.json>
import { readFileSync, writeFileSync } from 'node:fs';
const snap = JSON.parse(readFileSync(process.argv[2]));
const EXC = new Set(['CEX','Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC']);
const asOf = Date.parse(snap.as_of);
const D = snap.protocols.filter(p => p.mcap_usd > 0 && p.tvl_usd > 0 && !EXC.has(p.category ?? '')).map(p => ({
  ...p, y: Math.log(p.mcap_usd), ltvl: Math.log(p.tvl_usd),
  lage: Math.log1p(p.listed_at ? Math.max(0, (asOf - Date.parse(p.listed_at)) / 864e5) : 0),
  nch: Math.log(Math.max(1, p.chains.length)), listed: p.listed_at ? 1 : 0, g: Math.max(-20, Math.min(40, p.change_7d ?? 0)) / 100,
}));
const q = (a, f) => { a = [...a].sort((x, y) => x - y); const s = (a.length - 1) * f, l = Math.floor(s), h = Math.ceil(s); return a[l] + (a[h] - a[l]) * (s - l); };
const med = a => q(a, .5);
// OLS via normal equations with ridge
function ols(X, y, ridge = 1e-6) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((r, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += r[a] * r[b]; A[a][k] += r[a] * y[i]; } });
  for (let a = 1; a < k; a++) A[a][a] += ridge * X.length;
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } }
  return A.map((r, i) => r[k] / r[i]);
}
const dot = (w, x) => w.reduce((s, v, i) => s + v * x[i], 0);
// A model = fit(train) -> predict(p) returning log mcap point estimate. Band from training residual P25/P75.
const lin = (feat) => (tr) => { const w = ols(tr.map(feat), tr.map(p => p.y)); const f = p => dot(w, feat(p)); const res = tr.map(p => p.y - f(p)); return { f, lo: q(res, .25), hi: q(res, .75) }; };
const models = {
  'A fixed 0.25 x TVL': tr => ({ f: p => p.ltvl + Math.log(.25), lo: q(tr.map(p => p.y - p.ltvl - Math.log(.25)), .25), hi: q(tr.map(p => p.y - p.ltvl - Math.log(.25)), .75) }),
  'B global median ratio': tr => { const m = med(tr.map(p => p.y - p.ltvl)); const r = tr.map(p => p.y - p.ltvl - m); return { f: p => p.ltvl + m, lo: q(r, .25), hi: q(r, .75) }; },
  'C current (median ratio x growth x maturity)': tr => { const m = med(tr.map(p => p.y - p.ltvl)); const age = p => Math.min(p.listed ? Math.exp(p.lage) - 1 : 365, 730) / 730;
    const adj = p => Math.log((1 + p.g * 0.5) * (0.5 + age(p) * 0.5)); const r = tr.map(p => p.y - p.ltvl - m - adj(p)); return { f: p => p.ltvl + m + adj(p), lo: q(r, .25), hi: q(r, .75) }; },
  'D category shrinkage k=5': tr => { const g = med(tr.map(p => p.y - p.ltvl)); const by = {}; tr.forEach(p => (by[p.category] ??= []).push(p.y - p.ltvl));
    const f = p => { const a = by[p.category] ?? []; const w = a.length / (a.length + 5); return p.ltvl + w * (a.length ? med(a) : g) + (1 - w) * g; }; const r = tr.map(p => p.y - f(p)); return { f, lo: q(r, .25), hi: q(r, .75) }; },
  'E log-log: ltvl': lin(p => [1, p.ltvl]),
  'F log-log: ltvl + age + chains': lin(p => [1, p.ltvl, p.lage, p.nch]),
  'G log-log: ltvl + age + chains + growth': lin(p => [1, p.ltvl, p.lage, p.nch, p.g]),
};
function evalCV(folds) {
  const out = {};
  for (const [name, fit] of Object.entries(models)) {
    const e = []; let cov = 0, w2 = 0, n = 0;
    for (const te of folds) { const tr = D.filter(p => !te.includes(p)); const m = fit(tr);
      for (const p of te) { const r = p.y - m.f(p); e.push(Math.abs(r)); n++; if (r >= m.lo && r <= m.hi) cov++; if (Math.abs(r) < Math.log(2)) w2++; } }
    out[name] = { n, mae_log: +(e.reduce((a, b) => a + b) / n).toFixed(3), med_ae_log: +med(e).toFixed(3), within_2x_pct: +(w2 / n * 100).toFixed(1), p25_p75_cov_pct: +(cov / n * 100).toFixed(1) };
  }
  return out;
}
const loo = evalCV(D.map(p => [p]));
// repeated 5-fold, 20 seeds (deterministic LCG)
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const agg = {}; const R = 20;
for (let r = 0; r < R; r++) { const idx = D.map((_, i) => i).sort(() => rnd() - .5); const folds = [0, 1, 2, 3, 4].map(k => idx.filter((_, j) => j % 5 === k).map(i => D[i]));
  const res = evalCV(folds); for (const [k, v] of Object.entries(res)) { const a = (agg[k] ??= { mae_log: 0, med_ae_log: 0, within_2x_pct: 0, p25_p75_cov_pct: 0 }); for (const m of Object.keys(a)) a[m] += v[m] / R; } }
for (const v of Object.values(agg)) for (const m of Object.keys(v)) v[m] = +v[m].toFixed(3);
const full = models['F log-log: ltvl + age + chains'](D);
console.log('n =', D.length, '\n\nLOO'); console.table(loo); console.log('Repeated 5-fold x' + R); console.table(agg);
writeFileSync('audit/results.json', JSON.stringify({ n: D.length, loo, repeated_5fold: agg }, null, 2));
