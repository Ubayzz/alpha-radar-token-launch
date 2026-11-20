// Per-protocol risk profile, from the snapshot's own figures only.
//
// Every flag names the figure that raised it. Nothing here moves Model E's implied value or the rank:
// the profile tells a reader how far to trust one row, and why. It is not an airdrop probability and has
// no outcome data behind it.
import type { SnapshotProtocol } from './model.ts';

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high';

export interface RiskProfile {
  level: RiskLevel;
  flags: string[];
}

/** What the snapshot says about the calibration sample, computed once per run. */
export interface RiskContext {
  /** Token-bearing protocols per category, over the whole snapshot. */
  peersByCategory: Map<string, number>;
  /** TVL (USD) at the 5th and 95th percentile of the token-bearing sample. */
  tvlP05: number;
  tvlP95: number;
  /** Categories the calibration leaves out (bridges, staking wrappers, exchanges). */
  excluded: ReadonlySet<string>;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Build the context from the snapshot's protocols and the calibration's excluded categories. */
export function riskContext(protocols: SnapshotProtocol[], excluded: ReadonlySet<string>): RiskContext {
  const peersByCategory = new Map<string, number>();
  const tvls: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? '';
    peersByCategory.set(key, (peersByCategory.get(key) ?? 0) + 1);
    if (!excluded.has(key)) tvls.push(p.tvl_usd);
  }
  tvls.sort((a, b) => a - b);
  return { peersByCategory, tvlP05: percentile(tvls, 0.05), tvlP95: percentile(tvls, 0.95), excluded };
}

const fmtUsd = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
};

/**
 * Score one protocol. Each flag adds one point; two points is elevated, four or more is high.
 * Flags are ordered from the one that weakens the valuation most to the one that only asks for care.
 */
export function riskProfile(p: SnapshotProtocol, ageDays: number | null, ctx: RiskContext): RiskProfile {
  const flags: string[] = [];
  const cat = p.category ?? '';

  if (ctx.excluded.has(cat)) {
    flags.push(`Category outside the fit: ${cat} protocols are left out of the Model E calibration, so the value is an extrapolation.`);
  }
  const peers = ctx.peersByCategory.get(cat) ?? 0;
  if (peers === 0) {
    flags.push(`No token-bearing peer: none of the snapshot's protocols in ${cat === '' ? 'an unnamed category' : cat} has a market cap to compare with.`);
  } else if (peers < 3) {
    flags.push(`Thin peer group: only ${peers} token-bearing ${peers === 1 ? 'protocol' : 'protocols'} in ${cat} in this snapshot.`);
  }
  if (ctx.tvlP95 > 0 && p.tvl_usd > ctx.tvlP95) {
    flags.push(`TVL ${fmtUsd(p.tvl_usd)} is above the calibration sample's 95th percentile (${fmtUsd(ctx.tvlP95)}); the fit has little data this large.`);
  } else if (ctx.tvlP05 > 0 && p.tvl_usd < ctx.tvlP05) {
    flags.push(`TVL ${fmtUsd(p.tvl_usd)} is below the calibration sample's 5th percentile (${fmtUsd(ctx.tvlP05)}); the fit has little data this small.`);
  }
  if (p.change_7d === null) {
    flags.push('No 7-day TVL change in the record, so the recent trend is unknown.');
  } else if (p.change_7d <= -10) {
    flags.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days; the figure the value rests on may be shrinking.`);
  } else if (p.change_7d >= 40) {
    flags.push(`TVL rose ${p.change_7d.toFixed(1)}% in 7 days; a jump this size is often a temporary incentive and may reverse.`);
  }
  if (ageDays !== null && ageDays < 90) {
    flags.push(`Young record: listed ${ageDays} days ago, too short to show whether the TVL lasts.`);
  } else if (ageDays === null) {
    flags.push('No listing date in the record, so its age is unknown.');
  }
  if (p.chains.length <= 1) {
    flags.push(`Single chain (${p.chains[0] ?? 'none named'}): one outage or exploit on that chain reaches all of its TVL.`);
  }

  const level: RiskLevel = flags.length >= 4 ? 'high' : flags.length >= 2 ? 'elevated' : flags.length === 1 ? 'moderate' : 'low';
  return { level, flags };
}
