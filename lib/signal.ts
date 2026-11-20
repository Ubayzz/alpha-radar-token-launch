// Alpha Radar signal layer (original code). Pure functions over the sealed snapshot's own fields.
//
// Output per protocol:
//   implied_low / implied_mid / implied_high  - value under three sets of base multiples (sensitivity range)
//   signal_score (0-100)                      - transparent heuristic: how many pre-token signals the record shows
//   signal_note                               - which signals fired, in plain words
//
// No historical outcome exists in the snapshot, so nothing here is calibrated. The score is not a
// probability, and no odds are computed. A weight change moves the ranking, and the dashboard says so.

import type { SnapshotProtocol } from './model.ts';

export interface SensitivityBand {
  low: number;
  mid: number;
  high: number;
}

/** Base multiple of TVL, tested at three levels. The mid value is the board's ranking value. */
export const BASE_MULTIPLE_BAND: SensitivityBand = { low: 0.1, mid: 0.25, high: 0.4 };

/** Weights for the heuristic score. They sum to 100 and are shown on the dashboard. */
export const SIGNAL_WEIGHTS = {
  no_token_record: 25, // gecko_id, symbol and mcap all null
  tvl_scale: 25, // TVL on a log scale, $5M to $1B
  growth: 20, // 7-day TVL change, clamped to [-20, +40]
  age: 20, // days since listed, capped at 2 years
  breadth: 10, // number of chains the TVL is counted on
} as const;

export interface SignalResult {
  score: number;
  note: string;
  fired: string[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Heuristic signal score from the record only. Returns 0-100 with the signals that fired. */
export function signalScore(p: SnapshotProtocol, ageDays: number | null): SignalResult {
  const fired: string[] = [];
  let score = 0;

  if (p.gecko_id === null && p.symbol === null && p.mcap_usd === null) {
    score += SIGNAL_WEIGHTS.no_token_record;
    fired.push('no token record');
  }

  // TVL scale: 0 at $5M, full at $1B, log-linear between.
  const tvlFrac = clamp(Math.log10(Math.max(p.tvl_usd, 5e6) / 5e6) / Math.log10(1e9 / 5e6), 0, 1);
  score += tvlFrac * SIGNAL_WEIGHTS.tvl_scale;
  if (tvlFrac > 0.5) fired.push('large TVL');

  if (p.change_7d !== null) {
    const g = clamp(p.change_7d, -20, 40);
    const gFrac = (g + 20) / 60;
    score += gFrac * SIGNAL_WEIGHTS.growth;
    if (p.change_7d > 10) fired.push(`TVL up ${p.change_7d.toFixed(1)}% in 7 days`);
  }

  if (ageDays !== null) {
    const aFrac = clamp(ageDays, 0, 730) / 730;
    score += aFrac * SIGNAL_WEIGHTS.age;
    if (ageDays >= 365) fired.push('running over a year');
  }

  const chainFrac = clamp(p.chains.length, 0, 5) / 5;
  score += chainFrac * SIGNAL_WEIGHTS.breadth;
  if (p.chains.length >= 3) fired.push(`${p.chains.length} chains`);

  const rounded = Math.round(score);
  return {
    score: rounded,
    fired,
    note: fired.length > 0 ? fired.join('; ') : 'no signal above the baseline',
  };
}
