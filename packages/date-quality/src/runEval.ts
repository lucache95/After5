// @after5/date-quality — the eval runner.
//
// Orchestrates one full pass over a fixture set:
//   1. writing pass   — runWritingPass(fixture, { invokeLLM })           (writingPass.ts)
//   2. gates          — runGates(fixture, writtenDate)                   (gates.ts)
//   3. judge          — judge(writtenDate, fixture, { invokeLLM })       (judge.ts)
//                       ONLY when no CRITICAL gate failed (gates gate the judge call).
//   4. score          — computeScore(judgeScores) → finalScore(gradient, failedGates)
//                                                                        (score.ts)
//   5. compare        — diff each fixture + the aggregate against a baseline JSON.
//   6. emit           — a JSON report + a Markdown report.
//
// DRY MODE: when no real generation/judge LLM is supplied, the runner synthesizes
// a deterministic WrittenDate from the fixture fact-bank (a "house writer") and a
// deterministic judge, so the harness produces a full, reproducible report with
// zero network. A fixture MAY also ship its own `writtenSample` (a WrittenDate)
// which dry mode prefers verbatim. Real runs pass `generateLLM` + `judgeLLM`.

import type { Fixture, GateResult, JudgeScores, WrittenDate } from './types';
import { runWritingPass, type InvokeLLM } from './writingPass';
import { runGates } from './gates';
import { judge, type JudgeResult } from './judge';
import { computeScore, finalScore } from './score';

// ─────────────────────────────────────────────────────────────────────────
// Report shapes — the on-disk contract a future run diffs against.
// ─────────────────────────────────────────────────────────────────────────

/** Per-fixture result captured in the report (and the baseline). */
export interface FixtureResult {
  fixture_id: string;
  /** Final overall score 0..100 (gradient capped by failed gates). */
  final_score: number;
  /** The pre-cap gradient score (judge weighted-average ×20), or null if no judge ran. */
  gradient_score: number | null;
  /** True when the judge ran (no critical gate failed and a judge was available). */
  judged: boolean;
  /** Ids of every gate that FAILED. */
  failed_gates: string[];
  /** Ids of failed gates whose severity is `critical`. */
  failed_critical_gates: string[];
  /** Whether the truthfulness (unsupported_concrete_claim) gate failed. */
  unsupported_claim: boolean;
  /** Whether the banned-copy (no_banned_words) gate failed. */
  banned_copy: boolean;
  /** Judge per-dimension scores, if the judge ran. */
  judge_scores: JudgeScores | null;
}

/** The full eval report. Shape is stable so baselines diff cleanly. */
export interface EvalReport {
  /** ISO timestamp of the run. */
  generated_at: string;
  /** Which fixture set was graded. */
  suite: string;
  /** "dry" (deterministic, offline) or "live" (real LLM calls). */
  mode: 'dry' | 'live';
  /** Mean of all fixtures' final_score. */
  mean_score: number;
  /** Per-fixture results, sorted by fixture_id. */
  fixtures: FixtureResult[];
}

/** A single regression finding. */
export interface Regression {
  kind:
    | 'critical_gate'
    | 'mean_drop'
    | 'fixture_drop'
    | 'unsupported_claim'
    | 'banned_copy';
  fixture_id?: string;
  message: string;
}

/** Outcome of comparing a fresh report against a baseline. */
export interface ComparisonResult {
  report: EvalReport;
  baseline: EvalReport | null;
  regressions: Regression[];
  /** True iff there are zero regressions. */
  passed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Regression thresholds (per the runner spec).
// ─────────────────────────────────────────────────────────────────────────

/** Mean final-score drop (baseline − current) that counts as a regression. */
export const MEAN_DROP_THRESHOLD = 3;
/** Per-fixture final-score drop (baseline − current) that counts as a regression. */
export const FIXTURE_DROP_THRESHOLD = 10;

// ─────────────────────────────────────────────────────────────────────────
// Dry-mode deterministic LLMs.
// ─────────────────────────────────────────────────────────────────────────

/** Round to 2 decimals to keep report numbers stable across platforms. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic "house writer" used in dry mode. Returns the JSON array the
 * writing pass parser expects (length 1), with grounded, gate-clean copy
 * synthesized from the fixture fact-bank: each what_to_do names its place and
 * cites an allowed claim, so truthfulness + grounding gates pass. No banned
 * words, no emoji, no time-of-day in the title. Pure + offline.
 */
export function dryGenerateLLM(): InvokeLLM {
  return async (_args) => 'IGNORED'; // replaced by buildDryWritten below.
}

/**
 * Build a deterministic WrittenDate directly from a fixture (the house writer).
 * Used by dry mode instead of the LLM seam so the copy is fully reproducible.
 * Prefers a fixture-shipped `writtenSample` when present.
 */
export function buildDryWritten(fixture: Fixture): WrittenDate {
  if (fixture.writtenSample) return fixture.writtenSample;

  const firstName = fixture.stops[0]?.place_name ?? 'the night';
  const title = shorten(`${firstName} and More`, 8);
  const hook = shorten('A grounded local night, built around what you asked for', 12);
  const why_it_works =
    'Each stop earns its place in the sequence. The pacing gives the night room to breathe.';

  const stops = fixture.stops.map((s) => {
    const claim = s.facts.allowed_claims[0];
    const sensory = s.facts.sensory_tags[0];
    const detail = claim
      ? `known for its ${claim}`
      : sensory
        ? `worth it for the ${sensory}`
        : 'a solid local pick';
    return {
      place_id: s.place_id,
      place_name: s.place_name,
      what_to_do: `Start at ${s.place_name}, ${detail}. Take your time before moving on.`,
    };
  });

  return {
    template_id: fixture.id,
    title,
    hook,
    why_it_works,
    stops,
  };
}

/** Truncate a phrase to at most `maxWords` words. */
function shorten(s: string, maxWords: number): string {
  const words = s.trim().split(/\s+/);
  return words.length <= maxWords ? s : words.slice(0, maxWords).join(' ');
}

/**
 * Deterministic dry-mode judge: returns a fixed, valid JSON judge response so
 * the runner produces a reproducible gradient score offline. Scores are a flat
 * mid-high baseline (4/5) — the real signal in dry mode comes from the gates.
 */
export function dryJudgeLLM(): InvokeLLM {
  const body = {
    scores: {
      desirability: 4,
      arc: 4,
      vibe_coherence: 4,
      city_context_fit: 4,
      specificity_taste: 4,
      hook: 4,
    },
    evidence: {
      desirability: 'dry-mode deterministic judge baseline',
      arc: 'dry-mode deterministic judge baseline',
      vibe_coherence: 'dry-mode deterministic judge baseline',
      city_context_fit: 'dry-mode deterministic judge baseline',
      specificity_taste: 'dry-mode deterministic judge baseline',
      hook: 'dry-mode deterministic judge baseline',
    },
  };
  const text = JSON.stringify(body);
  return async (_args) => text;
}

// ─────────────────────────────────────────────────────────────────────────
// Loading fixtures.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load + sort fixtures from a directory of `*.json` files. Node-only (uses
 * fs); kept out of the pure modules so the rest stays environment-free.
 */
export async function loadFixtures(dir: string): Promise<Fixture[]> {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  const fixtures: Fixture[] = [];
  for (const f of files) {
    const raw = await readFile(path.join(dir, f), 'utf8');
    fixtures.push(JSON.parse(raw) as Fixture);
  }
  return fixtures;
}

// ─────────────────────────────────────────────────────────────────────────
// Core: grade one fixture.
// ─────────────────────────────────────────────────────────────────────────

/** Options controlling a run. In dry mode both LLMs are synthesized. */
export interface RunEvalOptions {
  suite?: string;
  /** When true (default when no LLMs given), synthesize deterministic copy + judge. */
  dry?: boolean;
  /** Real generation LLM (live mode). */
  generateLLM?: InvokeLLM;
  /** Real judge LLM (live mode). */
  judgeLLM?: InvokeLLM;
  /** Baseline report to diff against (null/undefined skips comparison). */
  baseline?: EvalReport | null;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => Date;
}

/** Grade a single fixture end-to-end and return its FixtureResult. */
export async function gradeFixture(
  fixture: Fixture,
  opts: { dry: boolean; generateLLM: InvokeLLM; judgeLLM: InvokeLLM },
): Promise<FixtureResult> {
  // 1. Writing pass. In dry mode use the deterministic house writer directly so
  //    the copy is reproducible; otherwise run the real injected generator.
  let written: WrittenDate;
  if (opts.dry) {
    written = buildDryWritten(fixture);
  } else {
    const result = await runWritingPass(fixture, { invokeLLM: opts.generateLLM });
    const first = result.itineraries[0];
    if (!first) {
      throw new Error(`writing pass produced no itinerary for ${fixture.id}`);
    }
    written = first;
  }

  // 2. Gates.
  const gateResults: GateResult[] = runGates(fixture, written);
  const failed = gateResults.filter((g) => !g.pass);
  const failedCritical = failed.filter((g) => g.severity === 'critical');

  const unsupported_claim = failed.some(
    (g) => g.gate === 'unsupported_concrete_claim',
  );
  const banned_copy = failed.some((g) => g.gate === 'no_banned_words');

  // 3. Judge — ONLY when no critical gate failed.
  let judgeResult: JudgeResult | null = null;
  if (failedCritical.length === 0) {
    judgeResult = await judge(written, fixture, { invokeLLM: opts.judgeLLM });
  }

  // 4. Score.
  const gradient = judgeResult ? computeScore(judgeResult.scores) : null;
  // With no judge, the gradient baseline is the worst critical cap (40) — the
  // date never earns a taste score, so it is capped at the failed-gate floor.
  const gradientForFinal = gradient ?? 100;
  const final = round2(finalScore(gradientForFinal, failed));

  return {
    fixture_id: fixture.id,
    final_score: final,
    gradient_score: gradient === null ? null : round2(gradient),
    judged: judgeResult !== null,
    failed_gates: failed.map((g) => g.gate),
    failed_critical_gates: failedCritical.map((g) => g.gate),
    unsupported_claim,
    banned_copy,
    judge_scores: judgeResult ? judgeResult.scores : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Core: run the whole suite + compare to baseline.
// ─────────────────────────────────────────────────────────────────────────

/** Run the eval over a fixture set and produce a report + regression diff. */
export async function runEval(
  fixtures: Fixture[],
  options: RunEvalOptions = {},
): Promise<ComparisonResult> {
  const dry =
    options.dry ?? (!options.generateLLM && !options.judgeLLM);
  const generateLLM = options.generateLLM ?? dryGenerateLLM();
  const judgeLLM = options.judgeLLM ?? dryJudgeLLM();
  const now = options.now ?? (() => new Date());

  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    results.push(await gradeFixture(fixture, { dry, generateLLM, judgeLLM }));
  }
  results.sort((a, b) => a.fixture_id.localeCompare(b.fixture_id));

  const mean =
    results.length === 0
      ? 0
      : round2(
          results.reduce((s, r) => s + r.final_score, 0) / results.length,
        );

  const report: EvalReport = {
    generated_at: now().toISOString(),
    suite: options.suite ?? 'dategen/kelowna-v0',
    mode: dry ? 'dry' : 'live',
    mean_score: mean,
    fixtures: results,
  };

  const baseline = options.baseline ?? null;
  const regressions = baseline ? compareToBaseline(report, baseline) : [];

  return {
    report,
    baseline,
    regressions,
    passed: regressions.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Comparison.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Diff a fresh report against a baseline. A regression is ANY of:
 *   - critical_gate:      a fixture newly fails a critical gate it passed in baseline.
 *   - unsupported_claim:  a fixture newly fails the truthfulness gate.
 *   - banned_copy:        a fixture newly fails the banned-copy gate.
 *   - mean_drop:          mean final score drops by more than MEAN_DROP_THRESHOLD.
 *   - fixture_drop:       any fixture's final score drops by more than FIXTURE_DROP_THRESHOLD.
 */
export function compareToBaseline(
  report: EvalReport,
  baseline: EvalReport,
): Regression[] {
  const regressions: Regression[] = [];
  const baseById = new Map(baseline.fixtures.map((f) => [f.fixture_id, f]));

  for (const cur of report.fixtures) {
    const prev = baseById.get(cur.fixture_id);

    // New critical-gate failures (gates failing now that passed before).
    const prevCritical = new Set(prev?.failed_critical_gates ?? []);
    for (const g of cur.failed_critical_gates) {
      if (!prevCritical.has(g)) {
        regressions.push({
          kind: 'critical_gate',
          fixture_id: cur.fixture_id,
          message: `${cur.fixture_id}: newly fails critical gate "${g}"`,
        });
      }
    }

    // Newly unsupported claim.
    if (cur.unsupported_claim && !(prev?.unsupported_claim ?? false)) {
      regressions.push({
        kind: 'unsupported_claim',
        fixture_id: cur.fixture_id,
        message: `${cur.fixture_id}: newly fails truthfulness (unsupported_concrete_claim)`,
      });
    }

    // Newly banned copy.
    if (cur.banned_copy && !(prev?.banned_copy ?? false)) {
      regressions.push({
        kind: 'banned_copy',
        fixture_id: cur.fixture_id,
        message: `${cur.fixture_id}: newly fails banned-copy (no_banned_words)`,
      });
    }

    // Per-fixture score drop.
    if (prev) {
      const drop = prev.final_score - cur.final_score;
      if (drop > FIXTURE_DROP_THRESHOLD) {
        regressions.push({
          kind: 'fixture_drop',
          fixture_id: cur.fixture_id,
          message: `${cur.fixture_id}: score dropped ${round2(drop)} (${prev.final_score} → ${cur.final_score}), > ${FIXTURE_DROP_THRESHOLD}`,
        });
      }
    }
  }

  // Mean drop.
  const meanDrop = baseline.mean_score - report.mean_score;
  if (meanDrop > MEAN_DROP_THRESHOLD) {
    regressions.push({
      kind: 'mean_drop',
      message: `mean score dropped ${round2(meanDrop)} (${baseline.mean_score} → ${report.mean_score}), > ${MEAN_DROP_THRESHOLD}`,
    });
  }

  return regressions;
}

// ─────────────────────────────────────────────────────────────────────────
// Rendering.
// ─────────────────────────────────────────────────────────────────────────

/** Render the report + regressions as Markdown. */
export function renderMarkdown(comparison: ComparisonResult): string {
  const { report, baseline, regressions, passed } = comparison;
  const lines: string[] = [];

  lines.push(`# Date-quality eval — ${report.suite}`);
  lines.push('');
  lines.push(`- Generated: ${report.generated_at}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Fixtures: ${report.fixtures.length}`);
  lines.push(`- Mean score: ${report.mean_score}`);
  if (baseline) {
    const delta = round2(report.mean_score - baseline.mean_score);
    const sign = delta >= 0 ? '+' : '';
    lines.push(`- Baseline mean: ${baseline.mean_score} (${sign}${delta})`);
  }
  lines.push(`- Result: ${passed ? 'PASS' : 'REGRESSION'}`);
  lines.push('');

  if (regressions.length > 0) {
    lines.push('## Regressions');
    lines.push('');
    for (const r of regressions) {
      lines.push(`- [${r.kind}] ${r.message}`);
    }
    lines.push('');
  }

  lines.push('## Per-fixture');
  lines.push('');
  lines.push('| Fixture | Final | Gradient | Judged | Failed gates |');
  lines.push('| --- | ---: | ---: | :---: | --- |');
  const baseById = baseline
    ? new Map(baseline.fixtures.map((f) => [f.fixture_id, f]))
    : null;
  for (const f of report.fixtures) {
    const prev = baseById?.get(f.fixture_id);
    const deltaStr = prev
      ? ` (${f.final_score - prev.final_score >= 0 ? '+' : ''}${round2(f.final_score - prev.final_score)})`
      : '';
    const failed = f.failed_gates.length ? f.failed_gates.join(', ') : '—';
    lines.push(
      `| ${f.fixture_id} | ${f.final_score}${deltaStr} | ${f.gradient_score ?? '—'} | ${f.judged ? 'yes' : 'no'} | ${failed} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

/** Serialize the report as pretty JSON (stable for diffing baselines). */
export function renderJson(report: EvalReport): string {
  return JSON.stringify(report, null, 2) + '\n';
}
