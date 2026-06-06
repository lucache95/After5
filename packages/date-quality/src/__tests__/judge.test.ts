// @after5/date-quality — judge.ts tests.
//
// Covers the two EVAL-01 (09-04) behaviours plus the existing parse/validate
// contract:
//   1. Per-fixture JUDGE_CITY: the rubric/system prompt + user message name the
//      fixture's OWN city, not a hard-coded Kelowna. A cold-city fixture is
//      judged against its own locale.
//   2. Strict JSON parse + validation (throws on any defect).
//
// The live noHallucinatedVenue resolution lives in the script layer (it loads a
// pinned snapshot via fs); its pure resolver is unit-tested in
// eval-dategen.test.ts.

import { describe, it, expect } from 'vitest';

import {
  judge,
  buildJudgeUserMessage,
  buildSystemPrompt,
  parseJudgeResponse,
  cityForFixture,
  JUDGE_CITY,
} from '../judge';
import { makeFixture, makeWrittenFor } from './helpers';

const VALID_JSON = JSON.stringify({
  scores: {
    desirability: 4,
    arc: 4,
    vibe_coherence: 5,
    city_context_fit: 3,
    specificity_taste: 4,
    hook: 4,
  },
  evidence: {
    desirability: 'reads like a real night',
    arc: 'builds from cafe to dinner to view',
    vibe_coherence: 'every beat is relaxed',
    city_context_fit: 'names local lakeside detail',
    specificity_taste: 'cites the wood-fired lamb',
    hook: 'the title earns a tap',
  },
});

describe('cityForFixture', () => {
  it('returns Kelowna for kelowna-prefixed fixtures', () => {
    const f = makeFixture({ id: 'kelowna-golden-01-romantic' });
    expect(cityForFixture(f)).toBe('Kelowna, BC');
  });

  it('returns the cold city (not Kelowna) for coldcity-prefixed fixtures', () => {
    const f = makeFixture({ id: 'coldcity-thin-01-foursquare-cold' });
    const city = cityForFixture(f);
    expect(city).not.toMatch(/kelowna/i);
    expect(city.length).toBeGreaterThan(0);
  });
});

describe('buildSystemPrompt — per-fixture locale', () => {
  it('names the passed city in the rubric', () => {
    const prompt = buildSystemPrompt('Cranbrook, BC');
    expect(prompt).toContain('Cranbrook, BC');
    expect(prompt).not.toContain('Kelowna');
  });

  it('JUDGE_CITY remains the Kelowna default constant', () => {
    expect(JUDGE_CITY).toMatch(/kelowna/i);
    expect(buildSystemPrompt(JUDGE_CITY)).toContain('Kelowna');
  });
});

describe('buildJudgeUserMessage — per-fixture locale', () => {
  it('anchors the user message to the fixture city when provided', () => {
    const fixture = makeFixture({ id: 'coldcity-usable-01-verified' });
    const written = makeWrittenFor(fixture);
    const msg = buildJudgeUserMessage(written, fixture, 'Cranbrook, BC');
    expect(msg).toContain('Cranbrook, BC');
  });
});

describe('judge — threads the fixture city into the prompt', () => {
  /** Capture the {system,user} the judge passes to the injected LLM. */
  function captor() {
    let captured: { system: string; user: string } | null = null;
    const invokeLLM = async (args: { system: string; user: string }) => {
      captured = args;
      return VALID_JSON;
    };
    return { invokeLLM, get: () => captured! };
  }

  it('judges a cold-city fixture against its own city, not Kelowna', async () => {
    const fixture = makeFixture({ id: 'coldcity-thin-02-foursquare-cold' });
    const written = makeWrittenFor(fixture);
    const city = cityForFixture(fixture);

    const c = captor();
    const result = await judge(written, fixture, { invokeLLM: c.invokeLLM });

    const call = c.get();
    // The system prompt must name the fixture's own city, never Kelowna.
    expect(call.system).toContain(city);
    expect(call.system).not.toContain('Kelowna');
    expect(call.user).toContain(city);
    expect(result.scores.vibe_coherence).toBe(5);
  });

  it('defaults to the fixture-derived Kelowna locale for kelowna fixtures', async () => {
    const fixture = makeFixture({ id: 'kelowna-normal-01' });
    const written = makeWrittenFor(fixture);

    const c = captor();
    await judge(written, fixture, { invokeLLM: c.invokeLLM });

    expect(c.get().system).toContain('Kelowna, BC');
  });

  it('honours an explicit judgeCity override', async () => {
    const fixture = makeFixture({ id: 'kelowna-normal-01' });
    const written = makeWrittenFor(fixture);

    const c = captor();
    await judge(written, fixture, { invokeLLM: c.invokeLLM, judgeCity: 'Nelson, BC' });

    expect(c.get().system).toContain('Nelson, BC');
    expect(c.get().user).toContain('Nelson, BC');
  });
});

describe('parseJudgeResponse — strict validation', () => {
  it('parses a valid response', () => {
    const r = parseJudgeResponse(VALID_JSON);
    expect(r.scores.desirability).toBe(4);
    expect(r.evidence.hook).toBe('the title earns a tap');
  });

  it('strips markdown fences', () => {
    const r = parseJudgeResponse('```json\n' + VALID_JSON + '\n```');
    expect(r.scores.arc).toBe(4);
  });

  it('throws on non-JSON', () => {
    expect(() => parseJudgeResponse('not json')).toThrow(/not valid JSON/);
  });

  it('throws on a missing dimension', () => {
    const bad = JSON.stringify({
      scores: { desirability: 4, arc: 4, vibe_coherence: 4, city_context_fit: 4, specificity_taste: 4 },
      evidence: { desirability: 'x', arc: 'x', vibe_coherence: 'x', city_context_fit: 'x', specificity_taste: 'x', hook: 'x' },
    });
    expect(() => parseJudgeResponse(bad)).toThrow(/hook/);
  });

  it('throws on an out-of-range score', () => {
    const bad = JSON.stringify({
      scores: { desirability: 6, arc: 4, vibe_coherence: 4, city_context_fit: 4, specificity_taste: 4, hook: 4 },
      evidence: { desirability: 'x', arc: 'x', vibe_coherence: 'x', city_context_fit: 'x', specificity_taste: 'x', hook: 'x' },
    });
    expect(() => parseJudgeResponse(bad)).toThrow(/out of range/);
  });

  it('throws on empty evidence', () => {
    const bad = JSON.stringify({
      scores: { desirability: 4, arc: 4, vibe_coherence: 4, city_context_fit: 4, specificity_taste: 4, hook: 4 },
      evidence: { desirability: '', arc: 'x', vibe_coherence: 'x', city_context_fit: 'x', specificity_taste: 'x', hook: 'x' },
    });
    expect(() => parseJudgeResponse(bad)).toThrow(/non-empty string/);
  });
});
