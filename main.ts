// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { crossCheck } from './lib/consistency.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** Stop with a one-line reason and a distinct exit code: 2 input, 1 board or output. */
function fail(code: number, message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (e) {
  fail(2, `cannot read the snapshot at ${inputFile}: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Input integrity. Refuse what would corrupt the ranking (a repeated slug, a watchlist slug the snapshot
 * does not carry, a TVL that is not a positive number); report, without refusing, what only weakens it.
 */
function inputIssues(s: typeof snapshot): { fatal: string[]; notes: string[] } {
  const fatal: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const p of s.protocols) {
    if (seen.has(p.slug)) fatal.push(`slug ${p.slug} appears twice`);
    seen.add(p.slug);
    if (!(p.tvl_usd > 0)) fatal.push(`${p.slug} has TVL ${p.tvl_usd}`);
    if (p.change_7d === null) notes.push(`${p.slug} has no 7-day change`);
  }
  for (const w of s.watchlist) if (!seen.has(w)) fatal.push(`watchlist slug ${w} is not among the protocols`);
  if (new Set(s.watchlist).size !== s.watchlist.length) fatal.push('the watchlist repeats a slug');
  const bearing = s.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).length;
  if (bearing < 30) notes.push(`only ${bearing} token-bearing protocols to calibrate on: the residual band falls back to its published constants`);
  return { fatal, notes };
}
const found = inputIssues(snapshot);
if (found.fatal.length > 0) fail(2, `the snapshot is unusable: ${found.fatal.slice(0, 5).join('; ')}${found.fatal.length > 5 ? ` (and ${found.fatal.length - 5} more)` : ''}`);
if (found.notes.length > 0) process.stderr.write(`token radar: note: ${found.notes.length} input note${found.notes.length === 1 ? '' : 's'}, first: ${found.notes[0]}\n`);

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(1, `the model wrote a board the gate refuses: ${issue}`);

// Cross-check board, dashboard data and formula before anything is written: a disagreement here would
// put a number on the page that board.json does not carry.
const consistency = crossCheck(board, radar, snapshot);
if (consistency.failures.length > 0) {
  fail(1, `board, dashboard data and model disagree (${consistency.failures.length} of ${consistency.checks} checks): ${consistency.failures.slice(0, 3).join('; ')}`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

/**
 * Output verification: read back what was written, not what is in memory, and refuse a hand-in the
 * sealed gate would refuse. Checks the board file against the snapshot, the dashboard for network use,
 * the screenshots' PNG/JPEG signatures and size caps, and that dossier.json equals a fresh build.
 */
function outputIssues(): string[] {
  const bad: string[] = [];
  let written: { rows?: Array<Record<string, unknown>> };
  try {
    written = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  } catch {
    return ['board.json is not valid JSON after writing'];
  }
  const rows = written.rows ?? [];
  if (statSync(join(out, 'board.json')).size > 8 * 1024 * 1024) bad.push('board.json is over 8 MiB');
  if (rows.length < 100 || rows.length > 4000) bad.push(`board.json holds ${rows.length} rows, the gate wants 100 to 4000`);
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of rows) {
    const slug = String(r.slug);
    if (!known.has(slug)) bad.push(`board.json names ${slug}, which the snapshot does not carry`);
    if (slugs.has(slug)) bad.push(`board.json repeats ${slug}`);
    slugs.add(slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') bad.push(`${slug} has no name`);
    if (/\s/.test(slug) || slug.length < 1 || slug.length > 128) bad.push(`${slug} is not a valid slug`);
  }
  for (const w of snapshot.watchlist) if (!slugs.has(w)) bad.push(`the written board misses watchlist slug ${w}`);

  const NETWORK = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}|\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|@import/i;
  for (const name of readdirSync(join(out, 'dashboard'))) {
    const text = readFileSync(join(out, 'dashboard', name), 'utf8');
    const hit = NETWORK.exec(text);
    if (hit !== null) bad.push(`dashboard/${name} reaches for the network: ${hit[0]}`);
  }
  const dataText = readFileSync(join(out, 'data.js'), 'utf8');
  if (!dataText.startsWith('window.RADAR=')) bad.push('data.js does not set window.RADAR');

  for (const name of readdirSync(join(out, 'screenshots'))) {
    const buf = readFileSync(join(out, 'screenshots', name));
    const png = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!png && !jpeg) bad.push(`screenshots/${name} is neither a PNG nor a JPEG`);
    if (buf.length > SCREENSHOT_CAPS.max_bytes) bad.push(`screenshots/${name} is ${buf.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap`);
  }

  const dossierBytes = readFileSync(join(out, 'dossier.json'));
  const fresh = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
  if (Buffer.compare(dossierBytes, Buffer.from(fresh)) !== 0) bad.push('dossier.json differs from a fresh buildDossier of the written output');
  if (dossierBytes.length > 1_572_864) bad.push('dossier.json is over 1.5 MiB');
  return bad;
}
const outputProblems = outputIssues();
if (outputProblems.length > 0) fail(1, `the written output fails verification: ${outputProblems.slice(0, 5).join('; ')}${outputProblems.length > 5 ? ` (and ${outputProblems.length - 5} more)` : ''}`);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside), output verified, ${consistency.checks} consistency checks passed\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
