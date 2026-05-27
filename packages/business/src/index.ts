// After5 — pure business logic
//
// This package holds NO I/O. No HTTP, no DB, no fs. Just functions that
// take data and return data. That's what makes it portable across the
// Edge Function (Deno) and the Next.js app (Node) and any future runtime.
//
// Real implementations land in Phase 1 (TECH_PLAN). This file is a placeholder
// describing the intended API.

import type { PlanInputs } from '@after5/types';

// ─── Filter ───────────────────────────────────────────────────────────
// Build a Postgres query (as a structured object the caller can pass to
// supabase-js) that returns candidate places matching user inputs.
// Implemented in: src/filter.ts

// ─── Templates ────────────────────────────────────────────────────────
// Score each template against user inputs, return top 3.
// Implemented in: src/templates.ts

// ─── Combinations ─────────────────────────────────────────────────────
// Given a template and candidate places, generate scored combinations.
// Implemented in: src/combinations.ts

// ─── Prompt ───────────────────────────────────────────────────────────
// Build the Anthropic prompt for the writing pass and parse the response.
// Implemented in: src/prompt.ts

export type Stub = { phase: 'placeholder'; inputs: PlanInputs };

// ─── Phase 1: identity / dating eligibility ────────────────────────────
export * from './age';
export * from './eligibility';

// ─── Phase 5a: feed cold-start tier ────────────────────────────────────
export { feedColdStartTier, type FeedTier, type FeedCounts } from './feedColdStart';
