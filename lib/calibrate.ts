// Empirical calibration from the snapshot's own token-bearing protocols (original code).
// ratio = mcap_usd / tvl_usd over protocols that record a market cap. Quantiles give the value band;
// leave-one-out (LOO) measures how well that band would have covered each protocol it excluded.
import type { SnapshotProtocol } from './model.ts';

export interface Calibration {
  n: number;
  q25: number;
  median: number;
  q75: number;
  loo_coverage_pct: number; // share of protocols whose true ratio fell inside the LOO P25-P75 band
  loo_within_2x_pct: number; // share whose true ratio was within 2x of the LOO median
  loo_median_abs_log_err: number;
}

const EXCLUDED = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function calibrate(protocols: SnapshotProtocol[]): Calibration {
  const ratios = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !EXCLUDED.has(p.category ?? ''))
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const sorted = [...ratios].sort((a, b) => a - b);
  if (sorted.length < 10) return { n: sorted.length, q25: 0.05, median: 0.2, q75: 1, loo_coverage_pct: 0, loo_within_2x_pct: 0, loo_median_abs_log_err: 0 };
  let cover = 0;
  let within = 0;
  const errs: number[] = [];
  for (let i = 0; i < ratios.length; i++) {
    const rest = ratios.filter((_, j) => j !== i).sort((a, b) => a - b);
    const lo = quantile(rest, 0.25);
    const mid = quantile(rest, 0.5);
    const hi = quantile(rest, 0.75);
    const r = ratios[i]!;
    if (r >= lo && r <= hi) cover++;
    const e = Math.abs(Math.log(r / mid));
    errs.push(e);
    if (e < Math.log(2)) within++;
  }
  errs.sort((a, b) => a - b);
  const pct = (x: number) => Math.round((x / ratios.length) * 1000) / 10;
  return {
    n: sorted.length,
    q25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q75: quantile(sorted, 0.75),
    loo_coverage_pct: pct(cover),
    loo_within_2x_pct: pct(within),
    loo_median_abs_log_err: Math.round(quantile(errs, 0.5) * 1000) / 1000,
  };
}
