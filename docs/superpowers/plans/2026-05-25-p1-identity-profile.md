# P1 — Identity, Profile & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Build **on top of** the P0 tables (`profiles`, `profiles_private`, `verifications`, `cities`) — reference them, never recreate them.

**Goal:** Make the user a real, accountable, revealable person. Define the **profile** object that is revealed at offer (photos incl. blurred + clear, name, age, bio, prompts); capture **preferences** (orientation, age range, distance, dealbreakers) that feed the Phase-4 compatibility pre-filter; build identity **verification** (phone OTP + a selfie/liveness vendor) writing to P0's `verifications` + `profiles.verification`; enforce a real **18+ age gate**; and light up the **"Verified · New"** badge with a derivation that is true at launch.

**Architecture:** Backend-first on Supabase. Verification is a state machine `pending → verified | failed | appeal` persisted in P0's `verifications` rows; the aggregate is rolled up into `profiles.verification` by a trigger so the feed pre-filter and badge can read one column. The selfie/liveness step is delegated to **Persona** (justified in Task 6) and reconciled into the DB **only** via a service-role webhook Edge Function (`persona-webhook`) — the client never writes `verification='verified'`. Phone OTP rides Supabase Auth's native phone provider (Twilio). The age gate is computed from `profiles_private.birthdate` (private, owner-only) and gates `profiles.dating_enabled` via a DB trigger so a minor can never flip dating on. All reveal/eligibility logic lives in shared packages (`@after5/validators`, `@after5/business`, `@after5/api-client`) so the native client reuses it (spec §10).

**Tech Stack:** Supabase Postgres + RLS + SQL migrations (`supabase/migrations/`); Supabase Auth phone OTP (Twilio provider, already configured in `config.toml`); Persona (hosted Inquiry flow + webhook) for selfie/liveness + government-ID age verification; Supabase Edge Functions in Deno (`Deno.test` for tests); **vitest** for all JS/TS packages (P1 establishes the harness the whole monorepo will use); Zod schemas in `@after5/validators`; Supabase Storage private bucket `profile-photos` for blurred/clear photos; psql `DO $$ … END $$` invariant tests in `supabase/tests/`.

**Source documents:**
- Core-loop spec: `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 pre-filter, §7.2 reveal-at-offer, §8 verification + "Verified · New")
- Roadmap (this phase's scope + Closes): `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 1)
- Schema to reconcile: `docs/superpowers/specs/2026-04-23-date-engine-v2-architecture-design.md` §4.3 (`profiles`, `profiles_private`, payment/age/preference fields, trust_level)
- Phase the schema lands in: `docs/superpowers/plans/2026-05-25-p0-data-model.md` (Tasks 2–3 create `profiles` dating columns, `profiles_private`, `verifications`, the `verification_state` enum)

**Depends on:** **P0** (must be applied first). P1 assumes P0 Task 2 added `profiles.{dating_enabled, age, age_pref int4range, gender, gender_preferences text[], distance_pref_km, blurred_photo_url, clear_photo_url, reliability_score, primary_city_id, verification verification_state, vibe_tags}`, P0 Task 2 created `profiles_private` (with `birthdate`, `full_name`, `bio`, `emergency_contact`), and P0 Task 3 created `verifications(kind in ('phone','selfie','age'), state verification_state, provider, provider_ref, failure_reason, verified_at)`.

**Reconciliation notes (read before writing code):**
- P0's `verification_state` enum is `('unverified','pending','verified','failed')`. The spec's verify flow needs an **`appeal`** state. P1 **extends** that enum with `ADD VALUE 'appeal'` (Task 2) rather than redefining it.
- `date-engine-v2` §4.3 calls the orientation field `gender_preferences text[]` and the age field `age_preferences int4range`. **P0 actually shipped `gender_preferences text[]` and `age_pref int4range`.** P1 uses the **P0 names** (`age_pref`, `gender_preferences`) everywhere — they are the source of truth. Dealbreakers are net-new (Task 4 adds `profiles.dealbreakers text[]`).
- "Verified · New" (spec §8): a profile is **Verified** when `profiles.verification='verified'` and **New** when it has fewer than `MIN_RATINGS_FOR_ESTABLISHED` (=3) completed ratings (`profiles.reliability_score IS NULL`). At launch every verified user is "New" — the badge is true, not dead.
- P1 does **not** build the feed query (P4), the offer/reveal RPC (P5), or notifications (P2). P1 provides the data + eligibility predicates those phases consume.

---

## File Structure

```
supabase/
  migrations/
    20260525130000_p1_test_harness_marker.sql          # (no-op marker; harness task is JS — see Task 0)
    20260525130100_p1_verification_appeal_state.sql     # extend verification_state enum
    20260525130200_p1_profile_prompts.sql               # profile_prompts table + profile fields (bio/prompts/dealbreakers/onboarding)
    20260525130300_p1_preferences_constraints.sql        # preference columns CHECKs + onboarding_completed
    20260525130400_p1_age_gate_trigger.sql               # 18+ gate trigger on profiles.dating_enabled
    20260525130500_p1_verification_rollup_trigger.sql    # verifications → profiles.verification rollup
    20260525130600_p1_profile_photos_bucket.sql          # private storage bucket + RLS for blurred/clear photos
    20260525130700_p1_badge_and_reveal_views.sql         # public_profile_card (badge) + offer_reveal (full reveal) views/fn
  tests/
    p1_appeal_state.sql
    p1_age_gate.sql
    p1_verification_rollup.sql
    p1_reveal_rls.sql
    p1_badge_view.sql
  functions/
    persona-webhook/index.ts                             # service-role webhook: Persona → verifications + profiles
    _shared/
      cors.ts                                            # (exists — reuse)

packages/
  validators/src/
    profile.ts                                           # Zod: ProfileInput, PreferencesInput, OnboardingStep, PromptAnswer
    verification.ts                                       # Zod: PersonaWebhookEvent, VerificationKind, VerificationState
    index.ts                                             # re-export
  business/src/
    age.ts                                               # ageFromBirthdate(), isAdult()
    eligibility.ts                                       # canEnableDating(), badgeFor(), compatibilityPrefilterInputs()
    index.ts                                             # re-export
  api-client/src/
    profile.ts                                           # getMyProfile, upsertProfile, savePreferences, startVerification
    index.ts                                             # re-export

vitest.config.ts                                         # repo-root vitest (workspace projects)
package.json                                             # + "test": "vitest run", + devDeps
packages/validators/package.json                         # + test script
packages/business/package.json                           # + test script
packages/api-client/package.json                         # + test script
```

Test-loop conventions (inherited from P0):
- **SQL:** `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`. A `DO $$ … RAISE EXCEPTION … END $$;` block = clean exit is PASS, any raise is FAIL.
- **JS/TS:** `pnpm test` (vitest) from repo root, or `pnpm --filter @after5/business test` per package.
- **Deno (Edge Function):** `deno test --allow-env --allow-net supabase/functions/persona-webhook/`.

---

## Task 0: Establish the vitest test harness (repo-wide)

**P1 owns the JS/TS test runner. The repo currently has no JS test runner; later phases assume vitest exists.** This task adds vitest at the workspace root, wires a `test` script, and proves it with one passing sample test.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (root)
- Modify: `packages/business/package.json`, `packages/validators/package.json`, `packages/api-client/package.json`
- Create (sample): `packages/business/src/__tests__/harness.smoke.test.ts`

- [ ] **Step 1: Write the failing sample test**

```ts
// packages/business/src/__tests__/harness.smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs and asserts', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm test`
Expected: FAIL — `vitest: command not found` / `Missing script: "test"` (no runner installed yet).

- [ ] **Step 3: Install vitest + wire scripts**

Run (root):
```bash
pnpm add -D -w vitest@^2.1.8
```

Create `vitest.config.ts` (root) — a workspace config so each package's `src/**/*.test.ts` is discovered:
```ts
// vitest.config.ts — repo-wide test runner (P1 establishes this; later phases extend it)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment — packages are pure TS (no DOM). The web app can add
    // its own jsdom project later without changing this root config.
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/__tests__/**/*.test.ts'],
    // Edge Functions are Deno and tested with `deno test`, not vitest.
    exclude: ['**/node_modules/**', 'supabase/functions/**', 'apps/web/.next/**'],
    passWithNoTests: false,
  },
});
```

Modify root `package.json` scripts (add `test`; keep all existing):
```json
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff -f",
    "db:push": "supabase db push",
    "db:types": "supabase gen types typescript --local > packages/types/src/database.ts",
    "functions:serve": "supabase functions serve",
    "functions:deploy": "supabase functions deploy"
  }
}
```

Add a per-package `test` script to each package so `turbo`/`--filter` can target them. For `packages/business/package.json` (repeat for `validators`, `api-client`):
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Add a `test` task to `turbo.json` so `turbo run test` works:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm test`
Expected: PASS — `1 passed` in `packages/business/src/__tests__/harness.smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json turbo.json \
  packages/business/package.json packages/validators/package.json packages/api-client/package.json \
  packages/business/src/__tests__/harness.smoke.test.ts pnpm-lock.yaml
git commit -m "P1: establish vitest test harness (root config + package scripts + smoke test)"
```

---

## Task 1: Validators — profile, preferences & verification Zod schemas

Single source of truth for the profile/preference/verification shapes, shared by the web form, Edge Functions, and (later) native. No I/O.

**Files:**
- Create: `packages/validators/src/profile.ts`
- Create: `packages/validators/src/verification.ts`
- Modify: `packages/validators/src/index.ts`
- Create (test): `packages/validators/src/__tests__/profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/validators/src/__tests__/profile.test.ts
import { describe, it, expect } from 'vitest';
import {
  PreferencesInputSchema,
  ProfileInputSchema,
  PromptAnswerSchema,
  PersonaWebhookEventSchema,
  GenderSchema,
} from '../index';

describe('PreferencesInputSchema', () => {
  it('accepts a valid preferences payload', () => {
    const parsed = PreferencesInputSchema.parse({
      gender: 'woman',
      gender_preferences: ['man', 'nonbinary'],
      age_min: 25,
      age_max: 40,
      distance_pref_km: 35,
      dealbreakers: ['smoking'],
    });
    expect(parsed.age_min).toBe(25);
  });
  it('rejects age_min below 18 (age gate at the type boundary)', () => {
    expect(() =>
      PreferencesInputSchema.parse({
        gender: 'woman', gender_preferences: ['man'],
        age_min: 17, age_max: 30, distance_pref_km: 20, dealbreakers: [],
      }),
    ).toThrow();
  });
  it('rejects age_max < age_min', () => {
    expect(() =>
      PreferencesInputSchema.parse({
        gender: 'man', gender_preferences: ['woman'],
        age_min: 40, age_max: 30, distance_pref_km: 20, dealbreakers: [],
      }),
    ).toThrow();
  });
});

describe('ProfileInputSchema', () => {
  it('caps bio length and prompt count', () => {
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'x'.repeat(501), prompts: [] })).toThrow();
    const tooMany = Array.from({ length: 4 }, () => ({ prompt_id: 'two_truths', answer: 'a' }));
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'hi', prompts: tooMany })).toThrow();
  });
});

describe('PromptAnswerSchema', () => {
  it('requires a known prompt id', () => {
    expect(() => PromptAnswerSchema.parse({ prompt_id: 'not_a_prompt', answer: 'a' })).toThrow();
  });
});

describe('PersonaWebhookEventSchema', () => {
  it('parses an inquiry.approved event', () => {
    const ev = PersonaWebhookEventSchema.parse({
      data: {
        type: 'event',
        attributes: {
          name: 'inquiry.approved',
          payload: { data: { id: 'inq_123', attributes: { 'reference-id': '00000000-0000-0000-0000-000000000001' } } },
        },
      },
    });
    expect(ev.data.attributes.name).toBe('inquiry.approved');
  });
});

describe('GenderSchema', () => {
  it('enumerates the allowed identities', () => {
    expect(() => GenderSchema.parse('woman')).not.toThrow();
    expect(() => GenderSchema.parse('alien')).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/validators test`
Expected: FAIL — `Cannot find module '../index'` exports (`PreferencesInputSchema` undefined).

- [ ] **Step 3: Implement the schemas**

```ts
// packages/validators/src/profile.ts
import { z } from 'zod';

// Orientation vocab — kept small and stable; the DB stores plain text[] so
// new values are additive without a migration. Mirrors spec §5 pre-filter inputs.
export const GenderSchema = z.enum(['woman', 'man', 'nonbinary']);
export type Gender = z.infer<typeof GenderSchema>;

// 18+ is enforced at the type boundary AND in the DB (Task 3). Belt and braces.
export const MIN_AGE = 18;
export const MAX_AGE = 99;

// Known dealbreaker tags. text[] in the DB; this enum keeps the UI/contract honest.
export const DealbreakerSchema = z.enum([
  'smoking', 'wants_kids', 'no_kids', 'drinks_alcohol', 'no_alcohol', 'has_pets', 'no_pets',
]);

export const PreferencesInputSchema = z
  .object({
    gender: GenderSchema,
    gender_preferences: z.array(GenderSchema).min(1).max(3),
    age_min: z.number().int().min(MIN_AGE).max(MAX_AGE),
    age_max: z.number().int().min(MIN_AGE).max(MAX_AGE),
    distance_pref_km: z.number().int().min(1).max(150),
    dealbreakers: z.array(DealbreakerSchema).max(8).default([]),
  })
  .refine((p) => p.age_max >= p.age_min, {
    message: 'age_max must be >= age_min',
    path: ['age_max'],
  });
export type PreferencesInput = z.infer<typeof PreferencesInputSchema>;

// The set of profile prompts a creator can answer. Stable ids → DB rows (Task 2).
export const PROMPT_IDS = [
  'two_truths', 'my_ideal_first_date', 'unusual_skill', 'best_kelowna_spot', 'a_perfect_sunday',
] as const;
export const PromptIdSchema = z.enum(PROMPT_IDS);

export const PromptAnswerSchema = z.object({
  prompt_id: PromptIdSchema,
  answer: z.string().min(1).max(200),
});
export type PromptAnswer = z.infer<typeof PromptAnswerSchema>;

export const ProfileInputSchema = z.object({
  first_name: z.string().min(1).max(40),
  bio: z.string().max(500).default(''),
  vibe_tags: z.array(z.string().max(24)).max(8).default([]),
  prompts: z.array(PromptAnswerSchema).max(3).default([]),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

// Onboarding is a linear set of steps; the server stores the furthest completed.
export const OnboardingStepSchema = z.enum([
  'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
]);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
```

```ts
// packages/validators/src/verification.ts
import { z } from 'zod';

export const VerificationKindSchema = z.enum(['phone', 'selfie', 'age']);
export type VerificationKind = z.infer<typeof VerificationKindSchema>;

// Mirrors the DB verification_state enum AFTER P1 Task 2 adds 'appeal'.
export const VerificationStateSchema = z.enum(['unverified', 'pending', 'verified', 'failed', 'appeal']);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

// Persona webhook envelope (subset we depend on). reference-id carries our
// profiles.id so the webhook can map the Inquiry back to the user.
export const PersonaWebhookEventSchema = z.object({
  data: z.object({
    type: z.literal('event'),
    attributes: z.object({
      name: z.string(), // e.g. 'inquiry.approved' | 'inquiry.declined' | 'inquiry.marked-for-review'
      payload: z.object({
        data: z.object({
          id: z.string(), // inquiry id → provider_ref
          attributes: z.object({
            'reference-id': z.string().uuid().nullable().optional(),
          }),
        }),
      }),
    }),
  }),
});
export type PersonaWebhookEvent = z.infer<typeof PersonaWebhookEventSchema>;
```

```ts
// packages/validators/src/index.ts  (APPEND these re-exports; keep existing content)
export * from './profile';
export * from './verification';
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/validators test`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/profile.ts packages/validators/src/verification.ts \
  packages/validators/src/index.ts packages/validators/src/__tests__/profile.test.ts
git commit -m "P1: profile/preferences/verification Zod schemas in @after5/validators"
```

---

## Task 2: Migration — `appeal` state + profile prompts/bio/dealbreakers/onboarding columns

Extend P0's `verification_state` enum with `appeal`, add the prompts table, and add the profile columns P0 did not (bio is on `profiles_private` in P0; prompts/dealbreakers/onboarding are net-new).

**Files:**
- Create: `supabase/migrations/20260525130100_p1_verification_appeal_state.sql`
- Create: `supabase/migrations/20260525130200_p1_profile_prompts.sql`
- Test: `supabase/tests/p1_appeal_state.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_appeal_state.sql
DO $$
BEGIN
  -- 'appeal' must be a member of the verification_state enum.
  PERFORM 1
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'verification_state' AND e.enumlabel = 'appeal';
  IF NOT FOUND THEN RAISE EXCEPTION 'verification_state is missing the appeal value'; END IF;

  -- profile_prompts seed must include the known prompt ids.
  PERFORM 1 FROM profile_prompts WHERE id = 'two_truths';
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_prompts seed missing two_truths'; END IF;

  -- profiles must carry dealbreakers + onboarding tracking + prompt answers.
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='dealbreakers';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.dealbreakers missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='onboarding_step';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.onboarding_step missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='prompt_answers';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.prompt_answers missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p1_appeal_state.sql`
Expected: FAIL — enum missing `appeal` (or `relation "profile_prompts" does not exist`).

- [ ] **Step 3: Write the migrations**

```sql
-- supabase/migrations/20260525130100_p1_verification_appeal_state.sql
-- Extend P0's verification_state enum with the spec's appeal state (§8).
-- ALTER TYPE ... ADD VALUE cannot run inside a txn block that also uses the new
-- value, so it lives alone in its own migration (Supabase wraps each file in its
-- own transaction; ADD VALUE IF NOT EXISTS is committed before any later file uses it).
alter type verification_state add value if not exists 'appeal';
```

```sql
-- supabase/migrations/20260525130200_p1_profile_prompts.sql
-- The library of profile prompts a creator can answer (revealed at offer).
create table if not exists profile_prompts (
  id          text primary key,         -- matches validators PROMPT_IDS
  label       text not null,
  placeholder text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table profile_prompts enable row level security;
do $$ begin
  create policy "profile_prompts_public_read" on profile_prompts for select using (is_active = true);
exception when duplicate_object then null; end $$;

insert into profile_prompts (id, label, placeholder, sort_order) values
  ('two_truths',        'Two truths and a lie',     'Make me guess…',                 1),
  ('my_ideal_first_date','My ideal first date is…', 'Keep it real, not Pinterest…',   2),
  ('unusual_skill',     'An unusual skill I have',  'Surprise me…',                   3),
  ('best_kelowna_spot', 'My favourite Kelowna spot','Where would you take me?',       4),
  ('a_perfect_sunday',  'A perfect Sunday looks like','Paint the picture…',           5)
on conflict (id) do nothing;

-- Profile columns P0 did not create. bio lives on profiles_private in P0 (PII);
-- prompt_answers/dealbreakers/onboarding live on the public profiles row because
-- prompts + dealbreaker tags are part of the at-offer reveal / pre-filter, not PII.
alter table profiles
  add column if not exists dealbreakers text[] not null default '{}',
  add column if not exists prompt_answers jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_step text not null default 'age_gate'
    check (onboarding_step in ('age_gate','basics','photos','preferences','phone_verify','selfie_verify','done')),
  add column if not exists onboarding_completed_at timestamptz;
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p1_appeal_state.sql`
Expected: PASS (no output, exit 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130100_p1_verification_appeal_state.sql \
  supabase/migrations/20260525130200_p1_profile_prompts.sql supabase/tests/p1_appeal_state.sql
git commit -m "P1: verification 'appeal' state + profile_prompts + dealbreakers/onboarding columns"
```

---

## Task 3: Migration — real 18+ age gate (DB trigger)

A minor must never be able to enable dating. Compute age from `profiles_private.birthdate` and **reject** any attempt to set `profiles.dating_enabled=true` unless the user is ≥18.

**Files:**
- Create: `supabase/migrations/20260525130400_p1_age_gate_trigger.sql`
- Test: `supabase/tests/p1_age_gate.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_age_gate.sql
DO $$
DECLARE minor uuid; adult uuid; blocked boolean := false;
BEGIN
  -- Direct profile inserts (FKs point at profiles; constraint test bypasses auth.users).
  insert into profiles (id, first_name) values (gen_random_uuid(),'minor') returning id into minor;
  insert into profiles (id, first_name) values (gen_random_uuid(),'adult') returning id into adult;
  insert into profiles_private (user_id, birthdate) values (minor, current_date - interval '16 years');
  insert into profiles_private (user_id, birthdate) values (adult, current_date - interval '25 years');

  -- Minor flipping dating_enabled on must be rejected.
  BEGIN
    update profiles set dating_enabled = true where id = minor;
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'AGE GATE FAILED: a 16-year-old enabled dating'; END IF;

  -- Adult flipping dating_enabled on must succeed.
  update profiles set dating_enabled = true where id = adult;
  PERFORM 1 FROM profiles WHERE id = adult AND dating_enabled = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGE GATE FAILED: a 25-year-old was blocked'; END IF;

  RAISE NOTICE 'age gate OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql … -f supabase/tests/p1_age_gate.sql`
Expected: FAIL — `AGE GATE FAILED: a 16-year-old enabled dating` (no gate yet).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p1_age_gate_trigger.sql
-- Hard 18+ gate. profiles.age (cached) AND profiles_private.birthdate (source)
-- are both consulted; birthdate wins because it cannot be self-set to a lie
-- without also lying to verification (Task 6 cross-checks the ID DOB).

create or replace function enforce_age_gate() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare bd date; yrs numeric;
begin
  -- Only police the transition INTO dating_enabled = true.
  if new.dating_enabled is true and (tg_op = 'INSERT' or old.dating_enabled is distinct from true) then
    select birthdate into bd from profiles_private where user_id = new.id;
    if bd is null then
      raise exception 'age gate: birthdate required before enabling dating';
    end if;
    yrs := extract(year from age(bd));
    if yrs < 18 then
      raise exception 'age gate: must be 18+ to enable dating (got % years)', yrs;
    end if;
    -- Keep the cached public age column in sync with the verified birthdate.
    new.age := floor(yrs)::int;
  end if;
  return new;
end $fn$;

create trigger profiles_age_gate
  before insert or update on profiles
  for each row execute function enforce_age_gate();
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql … -f supabase/tests/p1_age_gate.sql`
Expected: PASS (prints `age gate OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p1_age_gate_trigger.sql supabase/tests/p1_age_gate.sql
git commit -m "P1: hard 18+ age gate trigger on profiles.dating_enabled (birthdate-derived)"
```

---

## Task 4: Migration — preference constraints (pre-filter inputs are well-defined)

The Phase-4 pre-filter reads `gender`, `gender_preferences`, `age_pref`, `distance_pref_km`, `dealbreakers`. P0 created these columns loosely; P1 adds the CHECKs that make the inputs trustworthy so an out-of-range preference can never poison the feed filter.

**Files:**
- Create: `supabase/migrations/20260525130300_p1_preferences_constraints.sql`
- Test: `supabase/tests/p1_preferences.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_preferences.sql
DO $$
DECLARE u uuid; bad boolean := false;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'p') returning id into u;

  -- age_pref must be bounded to 18..99; a lower bound < 18 must be rejected.
  BEGIN
    update profiles set age_pref = int4range(17, 30) where id = u;
  EXCEPTION WHEN check_violation THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'PREF CHECK FAILED: age_pref accepted lower bound 17'; END IF;

  -- distance_pref_km must be 1..150.
  bad := false;
  BEGIN
    update profiles set distance_pref_km = 0 where id = u;
  EXCEPTION WHEN check_violation THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'PREF CHECK FAILED: distance 0 accepted'; END IF;

  -- A valid set must be accepted.
  update profiles set gender='woman', gender_preferences='{man,nonbinary}',
                      age_pref=int4range(25,40), distance_pref_km=35, dealbreakers='{smoking}'
   where id = u;
  PERFORM 1 FROM profiles WHERE id=u AND lower(age_pref)=25;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREF CHECK FAILED: valid prefs rejected'; END IF;

  RAISE NOTICE 'preferences OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql … -f supabase/tests/p1_preferences.sql`
Expected: FAIL — `PREF CHECK FAILED: age_pref accepted lower bound 17` (no constraint yet).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130300_p1_preferences_constraints.sql
-- Pre-filter input integrity. These bound the values the Phase-4 feed query
-- reads, so a malformed preference can never silently widen or empty a feed.

-- gender is a constrained text value (text[] preferences mirror it).
alter table profiles
  add constraint profiles_gender_chk
    check (gender is null or gender in ('woman','man','nonbinary')) not valid;
alter table profiles validate constraint profiles_gender_chk;

alter table profiles
  add constraint profiles_gender_prefs_chk
    check (gender_preferences <@ array['woman','man','nonbinary']::text[]) not valid;
alter table profiles validate constraint profiles_gender_prefs_chk;

-- age_pref bounded to 18..99 and well-ordered (lower <= upper). Empty/null allowed
-- (treated as "no preference" by the pre-filter).
alter table profiles
  add constraint profiles_age_pref_chk
    check (
      age_pref is null
      or (lower(age_pref) >= 18 and coalesce(upper(age_pref),99) <= 100
          and lower(age_pref) <= coalesce(upper(age_pref),99))
    ) not valid;
alter table profiles validate constraint profiles_age_pref_chk;

alter table profiles
  add constraint profiles_distance_pref_chk
    check (distance_pref_km between 1 and 150) not valid;
alter table profiles validate constraint profiles_distance_pref_chk;

alter table profiles
  add constraint profiles_dealbreakers_chk
    check (
      dealbreakers <@ array['smoking','wants_kids','no_kids','drinks_alcohol',
                            'no_alcohol','has_pets','no_pets']::text[]
    ) not valid;
alter table profiles validate constraint profiles_dealbreakers_chk;
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql … -f supabase/tests/p1_preferences.sql`
Expected: PASS (prints `preferences OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130300_p1_preferences_constraints.sql supabase/tests/p1_preferences.sql
git commit -m "P1: preference CHECK constraints (well-defined pre-filter inputs)"
```

---

## Task 5: Migration — verification rollup trigger (`verifications` → `profiles.verification`)

The feed pre-filter and badge read **one** column (`profiles.verification`). A trigger rolls the per-kind `verifications` rows up into that aggregate: a user is `verified` only when **both** `phone` AND `age` are verified (selfie is part of the `age` Inquiry — see Task 6 — so age-verified implies a passed liveness selfie). `failed`/`appeal` on any required kind propagates.

**Files:**
- Create: `supabase/migrations/20260525130500_p1_verification_rollup_trigger.sql`
- Test: `supabase/tests/p1_verification_rollup.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_verification_rollup.sql
DO $$
DECLARE u uuid; v text;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'v') returning id into u;

  -- phone verified alone → still pending (age not done).
  insert into verifications (user_id, kind, state, verified_at)
    values (u, 'phone', 'verified', now());
  select verification::text into v from profiles where id = u;
  IF v <> 'pending' THEN RAISE EXCEPTION 'rollup wrong after phone-only: got %', v; END IF;

  -- age verified too → profile becomes verified.
  insert into verifications (user_id, kind, state, verified_at)
    values (u, 'age', 'verified', now());
  select verification::text into v from profiles where id = u;
  IF v <> 'verified' THEN RAISE EXCEPTION 'rollup did not promote to verified: got %', v; END IF;

  -- a later failed age check demotes the profile.
  update verifications set state='failed', failure_reason='id_expired'
    where user_id=u and kind='age';
  select verification::text into v from profiles where id = u;
  IF v <> 'failed' THEN RAISE EXCEPTION 'rollup did not demote on failure: got %', v; END IF;

  RAISE NOTICE 'verification rollup OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql … -f supabase/tests/p1_verification_rollup.sql`
Expected: FAIL — `rollup wrong after phone-only` (no rollup trigger; `profiles.verification` stays `unverified`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p1_verification_rollup_trigger.sql
-- Roll per-kind verifications up into profiles.verification so feed + badge read
-- a single column. Required kinds for a "verified" profile: phone AND age.
-- (The age Inquiry includes the liveness selfie; selfie rows are informational.)

create or replace function recompute_profile_verification(p_user uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  phone_state verification_state;
  age_state   verification_state;
  result      verification_state;
begin
  -- Latest state per required kind (most recent row wins).
  select state into phone_state from verifications
    where user_id = p_user and kind = 'phone' order by updated_at desc limit 1;
  select state into age_state from verifications
    where user_id = p_user and kind = 'age' order by updated_at desc limit 1;

  phone_state := coalesce(phone_state, 'unverified');
  age_state   := coalesce(age_state, 'unverified');

  if phone_state = 'failed' or age_state = 'failed' then
    result := 'failed';
  elsif phone_state = 'appeal' or age_state = 'appeal' then
    result := 'appeal';
  elsif phone_state = 'verified' and age_state = 'verified' then
    result := 'verified';
  elsif phone_state = 'pending' or age_state = 'pending'
        or phone_state = 'verified' or age_state = 'verified' then
    result := 'pending';   -- at least one kind underway/done but not all
  else
    result := 'unverified';
  end if;

  update profiles set verification = result where id = p_user;
end $fn$;

create or replace function verifications_rollup() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform recompute_profile_verification(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end $fn$;

create trigger verifications_rollup_trg
  after insert or update or delete on verifications
  for each row execute function verifications_rollup();
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql … -f supabase/tests/p1_verification_rollup.sql`
Expected: PASS (prints `verification rollup OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130500_p1_verification_rollup_trigger.sql supabase/tests/p1_verification_rollup.sql
git commit -m "P1: verification rollup trigger (verifications -> profiles.verification: phone+age)"
```

---

## Task 6: Persona webhook Edge Function (selfie/liveness + government-ID age verification)

**Vendor choice — Persona (decision locked).** The spec needs (a) a selfie matched to the profile with liveness, and (b) a *real* age check (the roadmap explicitly flags "selfie ≠ age verification / minors"). A pure-selfie vendor cannot prove ≥18. **Persona** is chosen over Stripe Identity because:
1. **One Inquiry does both jobs** — Persona's Government ID + Selfie template returns a parsed `birthdate` (real age proof) *and* a liveness selfie-to-ID match, closing the "selfie isn't age verification" gap in a single flow. Stripe Identity verifies ID + selfie but is positioned as identity, and its DOB/age extraction is less first-class for a standalone age gate.
2. **Hosted flow + native SDK** — Persona ships a hosted web flow (web today) and iOS/Android SDKs (native later, spec §10) behind the same Inquiry/Template model, so the verify flow we design now is reused on native without rework.
3. **Reference-ID + webhook model** fits our hub-and-spoke exactly: we pass `profiles.id` as the Inquiry `reference-id`; Persona calls our webhook with the verdict; the webhook (and only the webhook, with service-role) writes the result. The client never self-certifies.

The client opens a Persona-hosted Inquiry (config/embed handled in the web onboarding UI, Task 8) with `reference-id = <profiles.id>`. Persona posts `inquiry.approved | inquiry.declined | inquiry.marked-for-review` to this function. The function verifies the HMAC signature, then upserts `verifications` rows for kinds `age` and `selfie` and lets the Task-5 rollup update `profiles.verification`.

**Files:**
- Create: `supabase/functions/persona-webhook/index.ts`
- Modify: `supabase/config.toml` (register the function, `verify_jwt = false`)
- Test: `supabase/functions/persona-webhook/index_test.ts`

- [ ] **Step 1: Write the failing test (Deno)**

```ts
// supabase/functions/persona-webhook/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { mapInquiryToVerification, verifyPersonaSignature } from './index.ts';

Deno.test('maps inquiry.approved → verified for age+selfie', () => {
  const rows = mapInquiryToVerification('inquiry.approved', 'inq_1', 'user-uuid');
  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.state === 'verified'), true);
  assertEquals(new Set(rows.map((r) => r.kind)), new Set(['age', 'selfie']));
});

Deno.test('maps inquiry.declined → failed', () => {
  const rows = mapInquiryToVerification('inquiry.declined', 'inq_2', 'user-uuid');
  assertEquals(rows.every((r) => r.state === 'failed'), true);
});

Deno.test('maps inquiry.marked-for-review → pending', () => {
  const rows = mapInquiryToVerification('inquiry.marked-for-review', 'inq_3', 'user-uuid');
  assertEquals(rows.every((r) => r.state === 'pending'), true);
});

Deno.test('HMAC signature verification accepts a correct signature', async () => {
  const secret = 'whsec_test';
  const body = '{"hello":"world"}';
  const t = '1700000000';
  // Persona signs `${t}.${body}` with HMAC-SHA256, hex digest, header:
  //   Persona-Signature: t=<t>,v1=<hex>
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const header = `t=${t},v1=${hex}`;
  assertEquals(await verifyPersonaSignature(body, header, secret), true);
  assertEquals(await verifyPersonaSignature(body, `t=${t},v1=deadbeef`, secret), false);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/`
Expected: FAIL — `Module not found "./index.ts"` (function not written).

- [ ] **Step 3: Write the function**

```ts
// supabase/functions/persona-webhook/index.ts
// Persona Inquiry webhook → verifications rows. Service-role only; the client
// never writes a verified state. We verify Persona's HMAC signature, map the
// inquiry verdict to verification rows for kinds 'age' (real DOB/ID check) and
// 'selfie' (liveness match), and upsert them. The Task-5 DB trigger rolls these
// up into profiles.verification.
//
// Deploy: verify_jwt is OFF (Persona is not a Supabase user). We authenticate
// via the Persona-Signature HMAC header instead.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

export type VState = 'unverified' | 'pending' | 'verified' | 'failed' | 'appeal';
export interface VerificationRow {
  user_id: string;
  kind: 'age' | 'selfie';
  state: VState;
  provider: 'persona';
  provider_ref: string;
  failure_reason: string | null;
  verified_at: string | null;
}

// Pure mapping — unit-tested without network or DB.
export function mapInquiryToVerification(
  eventName: string,
  inquiryId: string,
  userId: string,
): VerificationRow[] {
  let state: VState;
  let failure: string | null = null;
  switch (eventName) {
    case 'inquiry.approved': state = 'verified'; break;
    case 'inquiry.declined': state = 'failed'; failure = 'persona_declined'; break;
    case 'inquiry.marked-for-review': state = 'pending'; break;
    default: state = 'pending'; break;
  }
  const verifiedAt = state === 'verified' ? new Date().toISOString() : null;
  const base = { user_id: userId, provider: 'persona' as const, provider_ref: inquiryId, failure_reason: failure, verified_at: verifiedAt, state };
  return [
    { ...base, kind: 'age' },
    { ...base, kind: 'selfie' },
  ];
}

// Verify Persona's HMAC-SHA256 signature header: `t=<ts>,v1=<hexdigest>`.
export async function verifyPersonaSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=')));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const rawBody = await req.text();
  const secret = Deno.env.get('PERSONA_WEBHOOK_SECRET') ?? '';
  const ok = await verifyPersonaSignature(rawBody, req.headers.get('Persona-Signature'), secret);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'bad_signature' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  let event: {
    data?: { attributes?: { name?: string; payload?: { data?: { id?: string; attributes?: Record<string, unknown> } } } };
  };
  try { event = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const name = event.data?.attributes?.name ?? '';
  const inquiry = event.data?.attributes?.payload?.data;
  const inquiryId = inquiry?.id ?? '';
  const refId = (inquiry?.attributes?.['reference-id'] as string | undefined) ?? '';
  if (!name.startsWith('inquiry.') || !inquiryId || !refId) {
    // Ignore unrelated events (e.g. account.*) with 200 so Persona stops retrying.
    return new Response(JSON.stringify({ ignored: true }), {
      status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const rows = mapInquiryToVerification(name, inquiryId, refId);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Upsert one row per (user, kind). Latest verdict overwrites.
  for (const row of rows) {
    const { error } = await supabase.from('verifications').upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,kind' },
    );
    if (error) {
      console.error('persona-webhook upsert error', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, mapped: rows.length }), {
    status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
});
```

Add a unique constraint the upsert relies on (the webhook upserts on `(user_id, kind)`), appended in this task's migration partner:

```sql
-- supabase/migrations/20260525130550_p1_verifications_user_kind_unique.sql
-- The Persona webhook upserts on (user_id, kind); enforce one row per user per kind.
create unique index if not exists verifications_user_kind_ukey on verifications (user_id, kind);
```

Register the function in `config.toml` (append near the existing `[functions.generate-plan]` block):

```toml
[functions.persona-webhook]
verify_jwt = false
```

- [ ] **Step 4: Run it, expect PASS**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/`
Expected: PASS (all four `Deno.test` cases). Then `supabase db reset` to apply the unique-index migration (expect clean).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/persona-webhook/index.ts supabase/functions/persona-webhook/index_test.ts \
  supabase/migrations/20260525130550_p1_verifications_user_kind_unique.sql supabase/config.toml
git commit -m "P1: persona-webhook Edge Function (HMAC-verified) + (user,kind) unique on verifications"
```

---

## Task 7: Business logic — age, eligibility, badge & pre-filter inputs (pure functions)

Pure, runtime-agnostic predicates the web app, the Phase-4 feed, and native all reuse (spec §10 — keep loop logic in shared packages).

**Files:**
- Create: `packages/business/src/age.ts`
- Create: `packages/business/src/eligibility.ts`
- Modify: `packages/business/src/index.ts`
- Create (test): `packages/business/src/__tests__/eligibility.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest';
import { ageFromBirthdate, isAdult } from '../age';
import { canEnableDating, badgeFor, compatibilityPrefilterInputs } from '../eligibility';

describe('age', () => {
  it('computes age from birthdate at a reference date', () => {
    expect(ageFromBirthdate('2000-05-25', new Date('2026-05-25'))).toBe(26);
    expect(ageFromBirthdate('2000-05-26', new Date('2026-05-25'))).toBe(25); // birthday tomorrow
  });
  it('isAdult is true at exactly 18', () => {
    expect(isAdult('2008-05-25', new Date('2026-05-25'))).toBe(true);
    expect(isAdult('2008-05-26', new Date('2026-05-25'))).toBe(false);
  });
});

describe('canEnableDating', () => {
  it('requires adult + verified + onboarding done', () => {
    const adult = { birthdate: '2000-01-01', verification: 'verified', onboarding_step: 'done' } as const;
    expect(canEnableDating(adult, new Date('2026-05-25')).ok).toBe(true);
    expect(canEnableDating({ ...adult, verification: 'pending' }, new Date('2026-05-25')).ok).toBe(false);
    expect(canEnableDating({ ...adult, birthdate: '2010-01-01' }, new Date('2026-05-25')).ok).toBe(false);
  });
});

describe('badgeFor', () => {
  it('Verified · New for a verified user with no established score', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: null })).toEqual({ verified: true, isNew: true });
  });
  it('Verified (not New) once a reliability score exists', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: 4.6 })).toEqual({ verified: true, isNew: false });
  });
  it('no badge for unverified', () => {
    expect(badgeFor({ verification: 'unverified', reliability_score: null })).toEqual({ verified: false, isNew: false });
  });
});

describe('compatibilityPrefilterInputs', () => {
  it('extracts exactly the inputs the Phase-4 feed needs', () => {
    const out = compatibilityPrefilterInputs({
      gender: 'woman', gender_preferences: ['man'],
      age_pref_lower: 25, age_pref_upper: 40, distance_pref_km: 35,
      dealbreakers: ['smoking'], primary_city_id: 'city-1',
    });
    expect(out).toEqual({
      viewerGender: 'woman', wantsGenders: ['man'],
      ageMin: 25, ageMax: 40, maxDistanceKm: 35, dealbreakers: ['smoking'], cityId: 'city-1',
    });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/business test`
Expected: FAIL — `Cannot find module '../age'`.

- [ ] **Step 3: Implement**

```ts
// packages/business/src/age.ts
export function ageFromBirthdate(birthdate: string, at: Date = new Date()): number {
  const bd = new Date(birthdate + 'T00:00:00Z');
  let age = at.getUTCFullYear() - bd.getUTCFullYear();
  const m = at.getUTCMonth() - bd.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < bd.getUTCDate())) age--;
  return age;
}

export const MIN_DATING_AGE = 18;
export function isAdult(birthdate: string, at: Date = new Date()): boolean {
  return ageFromBirthdate(birthdate, at) >= MIN_DATING_AGE;
}
```

```ts
// packages/business/src/eligibility.ts
import { isAdult } from './age';

export type VerificationState = 'unverified' | 'pending' | 'verified' | 'failed' | 'appeal';

// Below this many completed ratings, a profile reads as "New" (reliability_score
// is NULL until enough ratings accumulate — see P7). True at launch by design.
export const MIN_RATINGS_FOR_ESTABLISHED = 3;

export interface DatingGateInput {
  birthdate: string | null;
  verification: VerificationState;
  onboarding_step: string;
}
export function canEnableDating(p: DatingGateInput, at: Date = new Date()): { ok: boolean; reason?: string } {
  if (!p.birthdate) return { ok: false, reason: 'birthdate_missing' };
  if (!isAdult(p.birthdate, at)) return { ok: false, reason: 'under_18' };
  if (p.verification !== 'verified') return { ok: false, reason: 'not_verified' };
  if (p.onboarding_step !== 'done') return { ok: false, reason: 'onboarding_incomplete' };
  return { ok: true };
}

// "Verified · New" badge (spec §8). verified = passed verification; isNew = no
// established reliability score yet.
export interface BadgeInput { verification: VerificationState; reliability_score: number | null; }
export function badgeFor(p: BadgeInput): { verified: boolean; isNew: boolean } {
  const verified = p.verification === 'verified';
  return { verified, isNew: verified && (p.reliability_score == null) };
}

// The exact, well-defined inputs the Phase-4 compatibility pre-filter consumes
// (spec §5: orientation, age range, distance, dealbreakers). Reshaped from the
// flat profile row into the feed query's vocabulary.
export interface PrefilterRow {
  gender: string | null;
  gender_preferences: string[];
  age_pref_lower: number | null;
  age_pref_upper: number | null;
  distance_pref_km: number;
  dealbreakers: string[];
  primary_city_id: string | null;
}
export function compatibilityPrefilterInputs(row: PrefilterRow) {
  return {
    viewerGender: row.gender,
    wantsGenders: row.gender_preferences,
    ageMin: row.age_pref_lower,
    ageMax: row.age_pref_upper,
    maxDistanceKm: row.distance_pref_km,
    dealbreakers: row.dealbreakers,
    cityId: row.primary_city_id,
  };
}
```

```ts
// packages/business/src/index.ts  (APPEND; keep existing content)
export * from './age';
export * from './eligibility';
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/business test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/age.ts packages/business/src/eligibility.ts \
  packages/business/src/index.ts packages/business/src/__tests__/eligibility.test.ts
git commit -m "P1: business logic — age gate, dating eligibility, Verified·New badge, pre-filter inputs"
```

---

## Task 8: Migration — profile-photos storage bucket + reveal/badge views (RLS)

The profile object that gets revealed at offer. `blurred_photo_url` is visible to anyone browsing; `clear_photo_url` (+ full name) is revealed **only** at offer (spec §7.2). P5 owns the offer state, so P1 ships: (a) a **private** `profile-photos` bucket where the blurred derivative is world-readable and the clear original is owner-only, and (b) a `public_profile_card` view (badge + blurred + first name + age + prompts — what a browser/shortlist sees) and an `offer_reveal(target uuid)` SECURITY DEFINER function that returns the full reveal **only if the caller currently holds an active offer** against the target (joins P0's `offers`).

**Files:**
- Create: `supabase/migrations/20260525130600_p1_profile_photos_bucket.sql`
- Create: `supabase/migrations/20260525130700_p1_badge_and_reveal_views.sql`
- Test: `supabase/tests/p1_reveal_rls.sql`
- Test: `supabase/tests/p1_badge_view.sql`

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p1_badge_view.sql
DO $$
BEGIN
  -- public_profile_card must NOT expose clear_photo_url or full name (no reveal leak).
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='clear_photo_url';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes clear_photo_url'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='badge_verified';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_verified'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='badge_is_new';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_is_new'; END IF;
END $$;
```

```sql
-- supabase/tests/p1_reveal_rls.sql
-- offer_reveal(target) returns full reveal ONLY when caller holds an active offer
-- against target. We exercise the SQL predicate directly (auth.uid() is simulated
-- via the function's caller filter using a passed-in viewer for the test path).
DO $$
DECLARE creator uuid; candidate uuid; cid uuid; inst uuid; rows int;
BEGIN
  insert into profiles (id, first_name, clear_photo_url, verification)
    values (gen_random_uuid(),'Creator','https://x/clear.jpg','verified') returning id into creator;
  insert into profiles (id, first_name) values (gen_random_uuid(),'Candidate') returning id into candidate;
  insert into profiles_private (user_id, full_name, bio) values (creator,'Creator Full','my bio');
  insert into cities (slug,name,timezone,is_active) values ('rv','rv','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='rv';
  insert into itineraries (id,user_id) values (gen_random_uuid(),creator);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,creator,cid,now()+interval '2 days' from itineraries i where i.user_id=creator limit 1
    returning id into inst;

  -- No active offer yet → reveal must return 0 rows.
  select count(*) into rows from offer_reveal_for(candidate, creator);
  IF rows <> 0 THEN RAISE EXCEPTION 'REVEAL LEAK: revealed without an active offer'; END IF;

  -- Create an active offer for the candidate → reveal returns the full row.
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, candidate, creator, 'active', now()+interval '1 day');
  select count(*) into rows from offer_reveal_for(candidate, creator);
  IF rows <> 1 THEN RAISE EXCEPTION 'REVEAL FAILED: active offer did not reveal'; END IF;

  RAISE NOTICE 'reveal RLS OK';
  ROLLBACK;
END $$;
```

> Note: the production function is `offer_reveal(target uuid)` keyed on `auth.uid()`. For DB-level testing without an auth session, we also expose an internal `offer_reveal_for(viewer uuid, target uuid)` with the same predicate; `offer_reveal` is a thin wrapper passing `auth.uid()`. This keeps the predicate testable in psql.

- [ ] **Step 2: Run them, expect FAIL**

Run: `psql … -f supabase/tests/p1_badge_view.sql` then `psql … -f supabase/tests/p1_reveal_rls.sql`
Expected: FAIL — `relation "public_profile_card" does not exist` / `function offer_reveal_for(...) does not exist`.

- [ ] **Step 3: Write the migrations**

```sql
-- supabase/migrations/20260525130600_p1_profile_photos_bucket.sql
-- Private bucket for profile photos. Two object-name conventions:
--   <user_id>/blurred.jpg  → readable by any authenticated user (browse/shortlist)
--   <user_id>/clear.jpg    → readable ONLY by the owner via storage RLS; the
--                            clear photo is surfaced to an offer-holder through a
--                            signed URL minted server-side by P5 (the offer RPC),
--                            never via a blanket storage policy.
insert into storage.buckets (id, name, public)
  values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

-- Owner may write/replace their own photos (path prefixed with their uid).
do $$ begin
  create policy "profile_photos_owner_write" on storage.objects for all
    using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

-- Any authenticated user may read the BLURRED derivative only.
do $$ begin
  create policy "profile_photos_blurred_read" on storage.objects for select
    using (
      bucket_id = 'profile-photos'
      and right(name, 11) = 'blurred.jpg'
      and auth.role() = 'authenticated'
    );
exception when duplicate_object then null; end $$;
-- No blanket policy exposes clear.jpg; the offer RPC mints a signed URL for it.
```

```sql
-- supabase/migrations/20260525130700_p1_badge_and_reveal_views.sql
-- public_profile_card: what a browser / shortlisted candidate sees about a
-- creator BEFORE an offer — blurred photo, first name, age, prompts, badge.
-- NO clear photo, NO full name, NO PII. (Pre-lock reveal privacy, spec §7.2.)
create or replace view public_profile_card
with (security_invoker = true) as
select
  p.id                                            as profile_id,
  p.first_name,
  p.age,
  p.vibe_tags,
  p.prompt_answers,
  p.blurred_photo_url,
  p.reliability_score,
  (p.verification = 'verified')                   as badge_verified,
  (p.verification = 'verified' and p.reliability_score is null) as badge_is_new
from profiles p
where p.dating_enabled = true;

grant select on public_profile_card to authenticated;

-- Internal predicate: full reveal IFF viewer holds an active offer vs target.
create or replace function offer_reveal_for(p_viewer uuid, p_target uuid)
returns table (
  profile_id uuid, first_name text, full_name text, age int, bio text,
  clear_photo_url text, blurred_photo_url text, vibe_tags text[], prompt_answers jsonb,
  badge_verified boolean, badge_is_new boolean
)
language sql security definer set search_path = public stable as $fn$
  select
    p.id, p.first_name, pp.full_name, p.age, pp.bio,
    p.clear_photo_url, p.blurred_photo_url, p.vibe_tags, p.prompt_answers,
    (p.verification = 'verified'),
    (p.verification = 'verified' and p.reliability_score is null)
  from profiles p
  left join profiles_private pp on pp.user_id = p.id
  where p.id = p_target
    and exists (
      select 1 from offers o
       where o.creator_id = p_target
         and o.candidate_id = p_viewer
         and o.status = 'active'
    );
$fn$;

-- Public wrapper: the candidate (auth.uid()) reveals the creator they have an
-- active offer from. P5's offer RPC also mints a signed clear-photo URL; this
-- function returns the structured reveal fields.
create or replace function offer_reveal(p_target uuid)
returns table (
  profile_id uuid, first_name text, full_name text, age int, bio text,
  clear_photo_url text, blurred_photo_url text, vibe_tags text[], prompt_answers jsonb,
  badge_verified boolean, badge_is_new boolean
)
language sql security definer set search_path = public stable as $fn$
  select * from offer_reveal_for(auth.uid(), p_target);
$fn$;

grant execute on function offer_reveal(uuid) to authenticated;
```

- [ ] **Step 4: Apply + run tests, expect PASS**

Run:
```bash
supabase db reset \
 && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p1_badge_view.sql \
 && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p1_reveal_rls.sql
```
Expected: PASS (`reveal RLS OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p1_profile_photos_bucket.sql \
  supabase/migrations/20260525130700_p1_badge_and_reveal_views.sql \
  supabase/tests/p1_reveal_rls.sql supabase/tests/p1_badge_view.sql
git commit -m "P1: profile-photos bucket + public_profile_card (badge) + offer_reveal (at-offer-only) RLS"
```

---

## Task 9: api-client — typed profile/preferences/verification helpers

Thin, typed wrappers so the web app (and later native) call one shared API surface rather than hand-rolling Supabase queries. Mirrors the existing `@after5/api-client` style.

**Files:**
- Create: `packages/api-client/src/profile.ts`
- Modify: `packages/api-client/src/index.ts`
- Create (test): `packages/api-client/src/__tests__/profile.test.ts`

- [ ] **Step 1: Write the failing test (validates the call shapes against a fake client)**

```ts
// packages/api-client/src/__tests__/profile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { savePreferences, getMyBadge } from '../profile';
import type { After5Client } from '../index';

function fakeClient(rows: unknown) {
  const single = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ single, maybeSingle: single }));
  const update = vi.fn(() => ({ eq }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update, select }));
  return { client: { from } as unknown as After5Client, from, update };
}

describe('savePreferences', () => {
  it('writes the mapped preference columns to profiles', async () => {
    const { client, from, update } = fakeClient({});
    await savePreferences(client, 'user-1', {
      gender: 'woman', gender_preferences: ['man'],
      age_min: 25, age_max: 40, distance_pref_km: 35, dealbreakers: ['smoking'],
    });
    expect(from).toHaveBeenCalledWith('profiles');
    const patch = update.mock.calls[0][0];
    expect(patch.gender).toBe('woman');
    expect(patch.distance_pref_km).toBe(35);
    // age_min/age_max collapse into an int4range string for the DB.
    expect(patch.age_pref).toBe('[25,40]');
  });
});

describe('getMyBadge', () => {
  it('derives the badge from the fetched profile row', async () => {
    const { client } = fakeClient({ verification: 'verified', reliability_score: null });
    const badge = await getMyBadge(client, 'user-1');
    expect(badge).toEqual({ verified: true, isNew: true });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/api-client test`
Expected: FAIL — `Cannot find module '../profile'`.

- [ ] **Step 3: Implement**

```ts
// packages/api-client/src/profile.ts
import type { After5Client } from './index';
import type { PreferencesInput, ProfileInput } from '@after5/validators';
import { badgeFor } from '@after5/business';

// Persist preferences → the flat profiles columns the Phase-4 pre-filter reads.
// age_min/age_max collapse into an int4range literal ('[lo,hi]').
export async function savePreferences(client: After5Client, userId: string, prefs: PreferencesInput): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({
      gender: prefs.gender,
      gender_preferences: prefs.gender_preferences,
      age_pref: `[${prefs.age_min},${prefs.age_max}]`,
      distance_pref_km: prefs.distance_pref_km,
      dealbreakers: prefs.dealbreakers,
    })
    .eq('id', userId);
  if (error) throw error;
}

// Persist the public profile object (name, bio→private, vibe tags, prompts).
export async function upsertProfile(client: After5Client, userId: string, input: ProfileInput): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({ first_name: input.first_name, vibe_tags: input.vibe_tags, prompt_answers: input.prompts })
    .eq('id', userId);
  if (error) throw error;
  // bio is PII → profiles_private (owner-only RLS).
  const { error: bioErr } = await client.from('profiles_private').update({ bio: input.bio }).eq('user_id', userId);
  if (bioErr) throw bioErr;
}

// Read the caller's badge state for the "Verified · New" chip.
export async function getMyBadge(client: After5Client, userId: string): Promise<{ verified: boolean; isNew: boolean }> {
  const { data, error } = await client
    .from('profiles')
    .select('verification, reliability_score')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return badgeFor({ verification: data.verification, reliability_score: data.reliability_score });
}

// Reveal a creator's full profile — succeeds only if the caller holds an active
// offer (DB enforces via offer_reveal SECURITY DEFINER fn).
export async function revealCreator(client: After5Client, creatorId: string) {
  const { data, error } = await client.rpc('offer_reveal', { p_target: creatorId });
  if (error) throw error;
  return data;
}
```

```ts
// packages/api-client/src/index.ts  (APPEND; keep existing exports)
export * from './profile';
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/api-client test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/profile.ts packages/api-client/src/index.ts \
  packages/api-client/src/__tests__/profile.test.ts
git commit -m "P1: api-client profile/preferences helpers + offer_reveal RPC wrapper"
```

---

## Task 10: Full verification + types regen + green-suite gate

End-to-end check that every P1 migration applies cleanly, all SQL invariant tests pass, all vitest suites pass, the Deno function tests pass, and the generated types include the new columns/views.

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full DB reset (applies P0 + every P1 migration in order)**

Run: `supabase db reset`
Expected: completes with no error; P0 migrations apply first, then `20260525130100…130700` P1 migrations.

- [ ] **Step 2: Run all P1 SQL tests**

Run:
```bash
for f in supabase/tests/p1_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run all JS + Deno tests**

Run:
```bash
pnpm test
deno test --allow-env --allow-net supabase/functions/persona-webhook/
```
Expected: vitest `passed` across `validators`, `business`, `api-client`, and the harness smoke test; Deno `ok` across the four webhook tests.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` updates to include the new `profiles` columns (`dealbreakers`, `prompt_answers`, `onboarding_step`, `onboarding_completed_at`), `profile_prompts`, the `appeal` enum value on `verification_state`, the `public_profile_card` view, and the `offer_reveal`/`offer_reveal_for` functions.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P1: regenerate database types for identity/profile/onboarding schema"
```

---

## Self-Review

**Coverage vs this phase's `Closes` list (roadmap Phase 1):**
- **Critical #4 — profile black hole** → Task 2 (prompts table + `prompt_answers`/`vibe_tags`), Task 8 (`public_profile_card` browse view + `offer_reveal` full reveal), Task 9 (`upsertProfile`). The profile object — blurred + clear photos, first name, age, bio, prompts — is now defined, stored, and revealed at the right moment. ✅
- **Critical #6 — verification named-not-built** → Task 6 (Persona webhook actually writes `verifications`), Task 5 (rollup → `profiles.verification`), Task 1/7 (`VerificationState` incl. `appeal`; eligibility). States `pending/verified/failed/appeal` exist and transition. ✅
- **"selfie ≠ age verification / minors"** → Persona's Government-ID+Selfie Inquiry yields a real DOB (kind `age`), and the rollup requires `age='verified'`; Task 3's birthdate-derived 18+ trigger blocks `dating_enabled` regardless of client claims. ✅
- **No age gate** → Task 3 (DB trigger, birthdate source of truth) + Task 1 (`MIN_AGE` in Zod) + Task 7 (`isAdult`/`canEnableDating`). Defence in depth: type boundary, business logic, and hard DB constraint. ✅
- **Pre-filter inputs undefined** → Task 4 (CHECK constraints bounding `gender`/`gender_preferences`/`age_pref`/`distance_pref_km`/`dealbreakers`) + Task 7 (`compatibilityPrefilterInputs` reshapes the row into the exact vocabulary the Phase-4 feed consumes). Orientation, age range, distance, dealbreakers are now well-defined and validated. ✅
- **Dead "Verified · New" badge** → Task 7 (`badgeFor`) + Task 8 (`public_profile_card.badge_verified`/`badge_is_new`). The badge is derived from real columns and is true at launch (every verified user is "New" until `reliability_score` exists in P7). ✅
- **Required: establish vitest harness** → Task 0 (root `vitest.config.ts`, `test` scripts, turbo task, passing smoke test). Later phases can assume `pnpm test` works. ✅

**Builds on P0 (does not recreate):** references `profiles` (extends with `dealbreakers`/`prompt_answers`/`onboarding_*`), `profiles_private` (writes `bio`/reads `birthdate`), `verifications` (adds `appeal` enum value, `(user_id,kind)` unique, rollup trigger), `cities`/`itineraries`/`date_instances`/`offers` (read-only joins in tests + `offer_reveal`). No P0 table is redefined.

**Placeholder scan:** none — every step has runnable SQL/TS/Deno and exact commands. The Persona Inquiry **embed/config** (template id, environment keys) is intentionally handled in the web onboarding UI layer (a later UI task) and is not faked here; the backend contract (webhook → `verifications`) is fully implemented and tested.

**Type/name consistency:**
- Verification states identical across layers: DB `verification_state ('unverified','pending','verified','failed','appeal')` = `VerificationStateSchema` = `VState` in the Edge Function = `VerificationState` in business.
- Preference column names match P0 exactly (`age_pref int4range`, `gender_preferences text[]`, `distance_pref_km`) — not the `date-engine-v2` draft names (`age_preferences`); reconciliation noted in the header.
- Badge fields (`badge_verified`/`badge_is_new`) match `badgeFor()`'s `{verified, isNew}` output.
- `offer_reveal`/`offer_reveal_for` predicate keys on P0's `offers (creator_id, candidate_id, status='active')` — consistent with P0 Task 7.
- Prompt ids identical in `PROMPT_IDS` (validators) and the `profile_prompts` seed (Task 2).

**Assumptions locked:**
1. **Vendor = Persona** (single Inquiry does liveness selfie + real government-ID DOB; hosted web + native SDK; reference-id/webhook fits hub-and-spoke). Stripe Identity rejected for weaker standalone age/DOB positioning.
2. **Required verification kinds for a "verified" profile = phone + age** (age Inquiry subsumes the selfie/liveness match). Phone rides Supabase Auth's existing Twilio provider; no new phone-OTP table needed (P0 `verifications` kind `phone` records the outcome; a small web/edge step writes it on successful `auth.verifyOtp` — that thin write lives in the onboarding UI task, contract already in place via the `(user_id,kind)` upsert).
3. **Photos:** private `profile-photos` bucket; `blurred.jpg` authenticated-readable, `clear.jpg` owner-only + signed URL minted by P5's offer RPC. Blur derivative generation (Sharp) happens at upload time in the web/edge layer (a later UI/media task); P1 owns the storage + RLS contract.
4. **"New" threshold:** `reliability_score IS NULL` ⇒ New (P7 populates the score after `MIN_RATINGS_FOR_ESTABLISHED=3` ratings).
5. **Deferred to later phases (intentionally NOT in P1):** the onboarding UI screens + Persona embed (web UI task), phone-OTP write-back glue (web UI task), blur image generation (media task, P3-adjacent), the feed query that *consumes* `compatibilityPrefilterInputs` (P4), the offer state + signed-clear-photo URL minting (P5), reliability score computation (P7).
```
