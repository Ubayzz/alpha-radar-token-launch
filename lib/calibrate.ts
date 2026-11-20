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
  // Out-of-sample evaluation of the baseline ratio model, kept separate from Model E.
  q25: number;
  median: number;
  q75: number;
  loo_coverage_pct: number; // baseline ratio: true ratio inside the LOO P25-P75 band
  loo_within_2x_pct: number; // baseline ratio: true ratio within 2x of the LOO median
  loo_median_abs_log_err: number;
  // Out-of-sample evaluation of Model E itself (leave-one-out refit of the log-log fit).
  e_loo_mae_log: number;
  e_loo_med_ae_log: number;
  e_loo_within_2x_pct: number;
  e_loo_p25_p75_cov_pct: number;
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
      e_loo_mae_log: 0,
      e_loo_med_ae_log: 0,
      e_loo_within_2x_pct: 0,
      e_loo_p25_p75_cov_pct: 0,
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

  // Model E evaluated out of sample: leave-one-out refit of the log-log fit on the same protocols,
  // matching the audit's Model E procedure exactly (coefficients refit per fold).
  const pts = usable.map((p) => ({ y: Math.log(p.mcap_usd!), x: Math.log(p.tvl_usd) }));
  const eErrs: number[] = [];
  let eCover = 0;
  let eWithin = 0;
  for (let i = 0; i < pts.length; i++) {
    const tr = pts.filter((_, j) => j !== i);
    const n = tr.length;
    const sx = tr.reduce((s, q) => s + q.x, 0);
    const sy = tr.reduce((s, q) => s + q.y, 0);
    const sxx = tr.reduce((s, q) => s + q.x * q.x, 0);
    const sxy = tr.reduce((s, q) => s + q.x * q.y, 0);
    const den = n * sxx - sx * sx;
    const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    const a = (sy - b * sx) / n;
    const res = tr.map((q) => q.y - (a + b * q.x)).sort((p, q) => p - q);
    const lo = quantile(res, 0.25);
    const hi = quantile(res, 0.75);
    const r = pts[i]!.y - (a + b * pts[i]!.x);
    const e = Math.abs(r);
    eErrs.push(e);
    if (r >= lo && r <= hi) eCover++;
    if (e < Math.log(2)) eWithin++;
  }
  eErrs.sort((a, b) => a - b);
  const ePct = (x: number) => Math.round((x / pts.length) * 1000) / 10;

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
    e_loo_mae_log: Math.round((eErrs.reduce((s, e) => s + e, 0) / eErrs.length) * 1000) / 1000,
    e_loo_med_ae_log: Math.round(quantile(eErrs, 0.5) * 1000) / 1000,
    e_loo_within_2x_pct: ePct(eWithin),
    e_loo_p25_p75_cov_pct: ePct(eCover),
  };
}
