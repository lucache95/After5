#!/usr/bin/env vite-node
// @after5/date-quality — CLI entry for the date-quality eval.
//
// Loads the Kelowna-v0 fixtures, runs the eval (dry mode by default — no
// network), diffs against the committed baseline, writes the JSON + Markdown
// reports, and exits NONZERO on any regression so CI fails loudly.
//
// Usage (from repo root):
//   pnpm --filter @after5/date-quality eval
//   pnpm --filter @after5/date-quality eval:update   # rewrite the baseline
//
// Flags:
//   --update-baseline   write the fresh report as the new baseline (no regression check)
//   --no-baseline       skip the baseline diff entirely
//   --live              run against real LLMs (requires generate/judge wiring; not dry)

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
  loadFixtures,
  runEval,
  renderJson,
  renderMarkdown,
  type EvalReport,
} from '../src/runEval';
import type { Fixture, GateSeverity, WrittenStop } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// Live anti-fabrication: noHallucinatedVenue (Area 3, T-09-09).
//
// Dry mode CANNOT hallucinate — the house writer only writes copy over the
// fixture's FROZEN place_ids. The teeth are in --live: a generated place_id
// that does not resolve against a pinned `places.snapshot.json` per city is a
// CRITICAL failure. We pin a JSON snapshot (not a live DB call) so the eval
// stays OFFLINE and reproducible (Open Question 3).
// ─────────────────────────────────────────────────────────────────────────

/** Result of the live noHallucinatedVenue resolution. */
export interface NoHallucinatedVenueResult {
  /** Stable check id. */
  gate: 'noHallucinatedVenue';
  /** true = every emitted place_id resolved in the snapshot. */
  pass: boolean;
  /** Always critical — a fabricated venue is a hard trust failure. */
  severity: GateSeverity;
  /** place_ids that did NOT resolve in the snapshot. */
  unresolved: string[];
  /** Human-readable evidence (one line per unresolved place). */
  evidence: string[];
}

/**
 * Resolve every emitted place_id against a pinned places-snapshot id set. Pure
 * (no fs / no network) so it is unit-testable; the snapshot is loaded by
 * {@link loadPlacesSnapshot}. An empty stop set passes vacuously.
 */
export function noHallucinatedVenue(
  stops: Pick<WrittenStop, 'place_id' | 'place_name'>[],
  snapshotIds: ReadonlySet<string>,
): NoHallucinatedVenueResult {
  const unresolved: string[] = [];
  const evidence: string[] = [];
  for (const s of stops) {
    if (!snapshotIds.has(s.place_id)) {
      unresolved.push(s.place_id);
      evidence.push(
        `place_id ${s.place_id} ("${s.place_name}") does not resolve in the pinned places snapshot`,
      );
    }
  }
  return {
    gate: 'noHallucinatedVenue',
    pass: unresolved.length === 0,
    severity: 'critical',
    unresolved,
    evidence,
  };
}

/**
 * Load a pinned `places.snapshot.json` for a fixture directory and return the
 * set of known place_ids. The snapshot is an array of `{ place_id }` records
 * (extra fields ignored). Missing file → empty set (so live mode flags every
 * emitted id, which is the safe failure direction for anti-fabrication).
 */
export async function loadPlacesSnapshot(dir: string): Promise<Set<string>> {
  const file = path.join(dir, 'places.snapshot.json');
  try {
    const raw = await readFile(file, 'utf8');
    const rows = JSON.parse(raw) as Array<{ place_id: string }>;
    return new Set(rows.map((r) => r.place_id));
  } catch {
    return new Set<string>();
  }
}

/**
 * Run the live no-hallucination resolution across a fixture set: for each
 * fixture, resolve its frozen stops against the snapshot for its directory.
 * Returns the per-fixture findings (critical failures only matter to the CLI).
 */
export function resolveLiveVenues(
  fixtures: Fixture[],
  snapshotIds: ReadonlySet<string>,
): Array<{ fixture_id: string; result: NoHallucinatedVenueResult }> {
  return fixtures.map((f) => ({
    fixture_id: f.id,
    result: noHallucinatedVenue(
      f.stops.map((s) => ({ place_id: s.place_id, place_name: s.place_name })),
      snapshotIds,
    ),
  }));
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

const SUITE = 'dategen/gate-v0';
const KELOWNA_DIR = path.join(PKG_ROOT, 'fixtures', 'dategen', 'kelowna-v0');
const COLDCITY_DIR = path.join(PKG_ROOT, 'fixtures', 'dategen', 'coldcity-v0');
const BASELINE_PATH = path.join(
  PKG_ROOT,
  'baselines',
  'dategen',
  'baseline-v0.json',
);
const OUT_DIR = path.join(PKG_ROOT, 'eval-results', 'dategen');
const OUT_JSON = path.join(OUT_DIR, 'latest.json');
const OUT_MD = path.join(OUT_DIR, 'latest.md');

async function loadBaseline(): Promise<EvalReport | null> {
  try {
    const raw = await readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(raw) as EvalReport;
  } catch {
    return null;
  }
}

/**
 * The CLI GATING suite: the full Kelowna golden set plus the USABLE cold city.
 * The deliberately-thin cold-city fixtures (`coldcity-thin-*`) are anti-vacuous-
 * green NEGATIVE cases — by design they trip the absolute `unverified_rate`
 * regression and so would fail the suite forever; they are exercised in the
 * unit tests (runEval.test.ts), not in the green CI gate. Including the usable
 * cold city keeps the baseline cold-city-aware (the `cities` map carries both
 * kelowna and coldcity) while the gate stays legitimately green.
 */
async function loadGateFixtures() {
  const kelowna = await loadFixtures(KELOWNA_DIR);
  const cold = await loadFixtures(COLDCITY_DIR);
  const usableCold = cold.filter((f) => !f.id.includes('thin'));
  return [...kelowna, ...usableCold];
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const updateBaseline = args.has('--update-baseline');
  const noBaseline = args.has('--no-baseline');
  const live = args.has('--live');

  const fixtures = await loadGateFixtures();
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${KELOWNA_DIR} / ${COLDCITY_DIR}`);
    process.exit(2);
  }

  const baseline =
    noBaseline || updateBaseline ? null : await loadBaseline();

  const comparison = await runEval(fixtures, {
    suite: SUITE,
    dry: !live,
    baseline,
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, renderJson(comparison.report), 'utf8');
  await writeFile(OUT_MD, renderMarkdown(comparison), 'utf8');

  console.log(renderMarkdown(comparison));
  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);

  // Live anti-fabrication: resolve every emitted place_id against the pinned
  // per-city places snapshot. Critical — a fabricated venue fails CI hard. Dry
  // mode skips this (the house writer only writes over frozen ids).
  let liveHallucination = false;
  if (live) {
    const snapshot = new Set<string>();
    for (const dir of [KELOWNA_DIR, COLDCITY_DIR]) {
      for (const id of await loadPlacesSnapshot(dir)) snapshot.add(id);
    }
    const findings = resolveLiveVenues(fixtures, snapshot);
    for (const { fixture_id, result } of findings) {
      if (!result.pass) {
        liveHallucination = true;
        console.error(`\nHALLUCINATED VENUE [${fixture_id}]:`);
        for (const e of result.evidence) console.error(`  - ${e}`);
      }
    }
  }

  if (updateBaseline) {
    await mkdir(path.dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, renderJson(comparison.report), 'utf8');
    console.log(`\nUpdated baseline ${BASELINE_PATH}`);
    return;
  }

  if (!comparison.passed || liveHallucination) {
    const n = comparison.regressions.length + (liveHallucination ? 1 : 0);
    console.error(`\nREGRESSION: ${n} finding(s). See report above.`);
    process.exit(1);
  }

  console.log('\nPASS: no regressions.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
