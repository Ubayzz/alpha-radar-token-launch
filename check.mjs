import { readFileSync, statSync, readdirSync } from 'node:fs';
const snap = JSON.parse(readFileSync('/home/hermes/.hermes/cache/scratch/token-radar/token-radar-01-kit/input/snapshot.json'));
const b = JSON.parse(readFileSync('out/board.json')); const rows = b.rows;
const slugs = new Set(snap.protocols.map(p => p.slug));
const bad = [];
if (rows.length < 100 || rows.length > 4000) bad.push('row count ' + rows.length);
rows.forEach((r, i) => {
  if (!slugs.has(r.slug)) bad.push('invented ' + r.slug);
  if (r.rank !== i + 1) bad.push('rank ' + r.slug);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) bad.push('value ' + r.slug);
  if (i && r.implied_value_usd > rows[i - 1].implied_value_usd) bad.push('order ' + r.slug);
  if (!Array.isArray(r.farm_steps) || !r.farm_steps.length) bad.push('steps ' + r.slug);
  if (!(r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd)) bad.push('band ' + r.slug);
});
const have = new Set(rows.map(r => r.slug));
const miss = snap.watchlist.filter(s => !have.has(s));
const live = snap.watchlist.filter(s => snap.protocols.find(p => p.slug === s).mcap_usd > 0);
const net = readdirSync('out/dashboard').filter(f => /https?:\/\//.test(readFileSync('out/dashboard/' + f, 'utf8')));
console.log({ rows: rows.length, watchlist: snap.watchlist.length, watchlist_missing: miss, bad: bad.slice(0, 5), badCount: bad.length, filesWithUrl: net,
  distinctValues: new Set(rows.map(r => r.implied_value_usd)).size, boardBytes: statSync('out/board.json').size, dossierBytes: statSync('out/dossier.json').size });
