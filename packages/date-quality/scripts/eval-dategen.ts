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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

const SUITE = 'dategen/kelowna-v0';
const FIXTURES_DIR = path.join(PKG_ROOT, 'fixtures', 'dategen', 'kelowna-v0');
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const updateBaseline = args.has('--update-baseline');
  const noBaseline = args.has('--no-baseline');
  const live = args.has('--live');

  const fixtures = await loadFixtures(FIXTURES_DIR);
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}`);
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

  if (updateBaseline) {
    await mkdir(path.dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, renderJson(comparison.report), 'utf8');
    console.log(`\nUpdated baseline ${BASELINE_PATH}`);
    return;
  }

  if (!comparison.passed) {
    console.error(
      `\nREGRESSION: ${comparison.regressions.length} finding(s). See report above.`,
    );
    process.exit(1);
  }

  console.log('\nPASS: no regressions.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
