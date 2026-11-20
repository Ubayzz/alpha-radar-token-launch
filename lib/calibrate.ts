// Empirical calibration from the snapshot's own token-bearing protocols (original code).
//
// Model E (log-log TVL): log(mcap) = intercept + slope * log(tvl). The coefficients are the audit's
// full fit on the sealed snapshot (intercept 8.998, slope 0.405). The residual band is measured in log
// space: low = implied * exp(P25(residual)), high = implied * exp(P75(residual)).
//
// The leave-one-out ratio statistics are retained separately as an out-of-sample evaluation of the
// baseline ratio model; they are reported on the dashboard but no longer drive any row's value.
import type { SnapshotProtocol } from './model.ts';

export interface Calibration {
  n: number; // token-bearing protocols used to fit Model E
  intercept: number; // Model E intercept on log(TVL)
  slope: number; // Model E slope on log(TVL)
  residual_p25: number; // P25 of log(mcap) - (intercept + slope * log(tvl)), log space
  residual_p75: number; // P75 of the same residuals, log space
  low_factor: number; // exp(residual_p25)
  high_factor: number; // exp(residual_p75)
  // Out-of-sample baseline ratio evaluation, kept separate from Model E's fit.
  q25: number;
  median: number;
  q75: number;
  loo_coverage_pct: number; // share of protocols whose true ratio fell inside the LOO P25-P75 band
  loo_within_2x_pct: number; // share whose true ratio was within 2x of the LOO median
  loo_median_abs_log_err: number;
}

const EXCLUDED = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** The audit's coefficients, also the fallback when too few token-bearing protocols exist. */
export const E_INTERCEPT = 8.998;
export const E_SLOPE = 0.405;
const FALLBACK_RESIDUAL_P25 = -1.1731;
const FALLBACK_RESIDUAL_P75 = 1.3665;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Fit the Model E residual band from the snapshot's token-bearing protocols and evaluate the baseline
 * ratio model out of sample. Residuals are measured against the published coefficients so the band and
 * the ranking use the same arithmetic; the audit's 8.998 / 0.405 are used as-is.
 */
export function calibrate(protocols: SnapshotProtocol[], intercept: number = E_INTERCEPT, slope: number = E_SLOPE): Calibration {
  const usable = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !EXCLUDED.has(p.category ?? ''),
  );
  const ratios = usable.map((p) => p.mcap_usd! / p.tvl_usd);
  const sorted = [...ratios].sort((a, b) => a - b);

  // Residual band in log space, against the published Model E coefficients.
  const residuals = usable
    .map((p) => Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd)))
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => a - b);
  const residualP25 = residuals.length >= 10 ? quantile(residuals, 0.25) : FALLBACK_RESIDUAL_P25;
  const residualP75 = residuals.length >= 10 ? quantile(residuals, 0.75) : FALLBACK_RESIDUAL_P75;

  if (sorted.length < 10) {
    return {
      n: sorted.length,
      intercept,
      slope,
      residual_p25: residualP25,
      residual_p75: residualP75,
      low_factor: Math.exp(residualP25),
      high_factor: Math.exp(residualP75),
      q25: 0.05,
      median: 0.2,
      q75: 1,
      loo_coverage_pct: 0,
      loo_within_2x_pct: 0,
      loo_median_abs_log_err: 0,
    };
  }

  // Baseline ratio model, evaluated leave-one-out and kept separate from Model E.
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
    intercept,
    slope,
    residual_p25: Math.round(residualP25 * 1e4) / 1e4,
    residual_p75: Math.round(residualP75 * 1e4) / 1e4,
    low_factor: Math.exp(residualP25),
    high_factor: Math.exp(residualP75),
    q25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q75: quantile(sorted, 0.75),
    loo_coverage_pct: pct(cover),
    loo_within_2x_pct: pct(within),
    loo_median_abs_log_err: Math.round(quantile(errs, 0.5) * 1000) / 1000,
  };
}
