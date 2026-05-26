SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P1 — Identity, Profile & Onboarding Implementation Plan

> **Position in the build:** this is the **S3** slice of the Reconciled Master Plan (RECONCILED-MASTER-PLAN.md §8, S3 — "Identity, verification, onboarding"). It is subordinate to `INTEGRATION-CONTRACT.md` (v2, incl. C11). The contract reconciliation items for this slice are the master checklist line "P1:" (INTEGRATION-CONTRACT.md, Reconciliation checklist) — every item there is implemented below.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Build **on top of** the P0/S1 tables (`profiles`, `profiles_private`, `verifications`, `cities`) — reference them, never recreate them.
>
> **Depends on (must already exist before this slice runs):**
> - **S1 (P0):** `profiles`, `profiles_private` (incl. `birthdate`, `full_name`, `bio`), `verifications` (`kind in ('phone','selfie','age')`, `state verification_state`, `provider`, `provider_ref`, `failure_reason`, `verified_at`), `cities`, `verification_state` enum, `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` (INTEGRATION-CONTRACT.md C8). **All psql tests below `\i` `supabase/tests/_fixtures.sql` and seed users via `mk_user()` — never bare-insert into `profiles` (C8/CV11).**
> - **S2 (P2):** `register_device(p_token text, p_platform text, p_web_push jsonb default null)`, `devices`, `notifications`/`notification_type`, `notification_preferences`, `dispatch_notification` (INTEGRATION-CONTRACT.md C1, C11.2). **This slice CALLS `register_device`; it does NOT define `devices`/`notifications`/`register_device`.** Verification-failure / appeal user notifications use `dispatch_notification` with `notification_type='account'` (the C1 enum has no verification-specific type; do not invent one without a contract amendment — see "Required contract amendments").
>
> **Reveal predicate:** this slice does **NOT** define a reveal function. The single canonical reveal predicate is `match_reveal_allowed(p_viewer uuid, p_instance uuid) returns bool` (INTEGRATION-CONTRACT.md C2), owned by S6 (P5). P1's former `offer_reveal`/`offer_reveal_for` are **DELETED** (CV6 / DS3). The clear-photo signed URL is minted by S6's offer RPC, not here.
>
> **Migration band (C6):** P1 owns **`122000–1229xx`** on 2026-05-25. All P1 migrations below are renumbered into that band (the old `1301xx`–`1307xx` numbers collided with P2/P5 — STATE#1 in the audit). No P1 migration may use any other band.

**Goal:** Make the user a real, accountable, revealable person. Define the **profile** object that is revealed at offer (photos incl. blurred + clear, age, bio, prompts — **no name in the pre-offer card**, spec §5/§7.2); capture **preferences** (orientation, age range, distance, dealbreakers) that feed the S5 (P4) compatibility pre-filter; build identity **verification** with a real **front door** (start a Persona Inquiry + write the `phone` verification row server-side) writing to S1's `verifications` + `profiles.verification`; enforce a real **18+ age gate from Persona's parsed DOB**; advance onboarding to `done`; produce the **blurred photo** the blind feed needs; register the device for notifications; and light up the **"Verified · New"** badge with a derivation that is true at launch.

**Architecture:** Backend-first on Supabase. Verification is a state machine `pending → verified | failed | appeal` persisted in S1's `verifications` rows; the aggregate is rolled up into `profiles.verification` by a trigger so the feed pre-filter and badge can read one column. The selfie/liveness + government-ID step is delegated to **Persona** (justified in Task 6). **A `start-verification` Edge Function (the FRONT DOOR)** creates/embeds the Persona Inquiry with `reference-id = profiles.id` and seeds `verifications(kind='age', state='pending')`; the verdict is reconciled into the DB **only** via the service-role webhook Edge Function (`persona-webhook`) — the client never writes `verification='verified'`. **Persona's parsed government-ID DOB is the age source of truth:** the webhook writes it (service-role) into `profiles_private.birthdate`, and the 18+ gate computes age from that birthdate (not self-reported). Phone OTP rides Supabase Auth's native phone provider (Twilio); a service-role `confirm-phone` Edge Function writes `verifications(kind='phone', state='verified')` on successful `auth.verifyOtp` (the client cannot write it — S1 RLS makes `verifications` writes service-role only). The age gate gates `profiles.dating_enabled` via a DB trigger so a minor can never flip dating on. `register_device` (INTEGRATION-CONTRACT.md C1/C11.2, owned by S2) is called at the end of onboarding. The reveal predicate is **not** defined here — it is canonical `match_reveal_allowed` (C2, owned by S6). All eligibility logic lives in shared packages (`@after5/validators`, `@after5/business`, `@after5/api-client`) so the native client reuses it (spec §10).

**Tech Stack:** Supabase Postgres + RLS + SQL migrations (`supabase/migrations/`); Supabase Auth phone OTP (Twilio provider, already configured in `config.toml`); Persona (hosted Inquiry flow + webhook) for selfie/liveness + government-ID age verification; Supabase Edge Functions in Deno (`Deno.test` for tests); **vitest** for all JS/TS packages (P1 establishes the harness the whole monorepo will use); Zod schemas in `@after5/validators`; Supabase Storage private bucket `profile-photos` for blurred/clear photos; psql `DO $$ … END $$` invariant tests in `supabase/tests/`.

**Source documents:**
- Core-loop spec: `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 pre-filter, §7.2 reveal-at-offer, §8 verification + "Verified · New")
- Roadmap (this phase's scope + Closes): `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 1)
- Schema to reconcile: `docs/superpowers/specs/2026-04-23-date-engine-v2-architecture-design.md` §4.3 (`profiles`, `profiles_private`, payment/age/preference fields, trust_level)
- Phase the schema lands in: `docs/superpowers/plans/2026-05-25-p0-data-model.md` (Tasks 2–3 create `profiles` dating columns, `profiles_private`, `verifications`, the `verification_state` enum)

**Depends on:** **S1 (P0)** and **S2 (P2)** — both must be applied first (RECONCILED-MASTER-PLAN.md §6 build order S1→S2→S3). P1 assumes S1 added `profiles.{dating_enabled, age, age_pref int4range, gender, gender_preferences text[], distance_pref_km, blurred_photo_url, clear_photo_url, reliability_score, primary_city_id, verification verification_state, vibe_tags}`, created `profiles_private` (with `birthdate`, `full_name`, `bio`, `emergency_contact`), and created `verifications(kind in ('phone','selfie','age'), state verification_state, provider, provider_ref, failure_reason, verified_at)`. P1 assumes S2 shipped `register_device`, `devices`, `notifications`/`notification_type`/`notification_preferences`, and `dispatch_notification` (INTEGRATION-CONTRACT.md C1/C11.2).

**Reconciliation notes (read before writing code):**
- S1's `verification_state` enum is `('unverified','pending','verified','failed')`. The spec's verify flow needs an **`appeal`** state. P1 **extends** that enum with `ADD VALUE 'appeal'` (Task 2) rather than redefining it.
- `date-engine-v2` §4.3 calls the orientation field `gender_preferences text[]` and the age field `age_preferences int4range`. **S1 actually shipped `gender_preferences text[]` and `age_pref int4range`.** P1 uses the **S1 names** (`age_pref`, `gender_preferences`) everywhere — they are the source of truth. Dealbreakers are net-new (Task 4 adds `profiles.dealbreakers text[]`).
- "Verified · New" (spec §8): a profile is **Verified** when `profiles.verification='verified'` and **New** when it has fewer than `MIN_RATINGS_FOR_ESTABLISHED` (=3) completed ratings (`profiles.reliability_score IS NULL`). At launch every verified user is "New" — the badge is true, not dead.
- P1 does **not** build the feed query (S5/P4), the reveal predicate (`match_reveal_allowed`, S6/P5 — C2), the clear-photo signed-URL minting (S6/P5), notifications infra (S2/P2 — C1), or `devices`/`register_device` (S2/P2 — C1/C11.2). P1 **calls** `register_device` and `dispatch_notification`; it **consumes** them, it does not define them. P1 provides the profile data, the verification front door, the age gate, the onboarding step machine, the blurred photo, and the eligibility predicates those phases consume.

---

## File Structure

```
supabase/
  migrations/                                            # P1 band: 122000–1229xx (C6). Old 1301xx–1307xx collided with P2/P5.
    20260525122000_p1_verification_appeal_state.sql      # extend verification_state enum (ADD VALUE 'appeal')
    20260525122100_p1_profile_prompts.sql                # profile_prompts table + profile fields (prompts/dealbreakers/onboarding)
    20260525122200_p1_preferences_constraints.sql        # preference columns CHECKs
    20260525122300_p1_age_gate_trigger.sql               # 18+ gate trigger on profiles.dating_enabled (Persona-DOB-derived)
    20260525122400_p1_verification_rollup_trigger.sql    # verifications → profiles.verification rollup
    20260525122500_p1_verifications_user_kind_unique.sql # (user_id,kind) unique the webhook/front-door upsert relies on
    20260525122600_p1_profile_photos_bucket.sql          # private storage bucket + RLS for blurred/clear photos
    20260525122700_p1_badge_view.sql                     # public_profile_card (badge) view — NO reveal fn (reveal = C2 match_reveal_allowed)
    20260525122800_p1_onboarding_advance_rpc.sql         # advance_onboarding_step() RPC → reaches 'done'; sets onboarding_completed_at
  tests/
    _fixtures.sql                                        # (from S1/C8 — \i'd by every test; NOT created here)
    p1_appeal_state.sql
    p1_age_gate.sql
    p1_verification_rollup.sql
    p1_badge_view.sql
    p1_onboarding_advance.sql
  functions/
    start-verification/index.ts                          # FRONT DOOR: create Persona Inquiry + seed verifications(age,pending)
    confirm-phone/index.ts                               # service-role: write verifications(phone,verified) after auth.verifyOtp
    persona-webhook/index.ts                             # service-role webhook: Persona → verifications + DOB→profiles_private.birthdate
    generate-blur/index.ts                               # service-role: produce blurred_photo_url derivative from clear upload
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
    profile.ts                                           # getMyProfile, upsertProfile, savePreferences, startVerification,
                                                         #   confirmPhone, advanceOnboarding, registerDevice (calls S2 register_device), getMyBadge
    index.ts                                             # re-export

vitest.config.ts                                         # repo-root vitest (workspace projects) — P1 OWNS the single root config (C10/C12)
package.json                                             # + "test": "vitest run", + devDeps
packages/validators/package.json                         # + test script
packages/business/package.json                           # + test script
packages/api-client/package.json                         # + test script
```

> **Removed vs the original P1 plan (do not build these):** `offer_reveal`/`offer_reveal_for` and `supabase/tests/p1_reveal_rls.sql` — the reveal predicate is canonical `match_reveal_allowed` (C2, S6). The `20260525130000_p1_test_harness_marker.sql` no-op marker is dropped (the harness is JS — Task 0). All migration filenames are rebased into the `122xxx` band.

Test-loop conventions (inherited from S1/P0):
- **SQL:** `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`. A `DO $$ … RAISE EXCEPTION … END $$;` block = clean exit is PASS, any raise is FAIL. **Every P1 SQL test begins with `\i supabase/tests/_fixtures.sql` and seeds users via `mk_user('label')` — never bare-insert into `profiles` (C8/CV11).**
- **JS/TS:** `pnpm test` (vitest) from repo root, or `pnpm --filter @after5/business test` per package.
- **Deno (Edge Function):** `deno test --allow-env --allow-net supabase/functions/<fn>/`.

---

## Task 0: Establish the single root vitest test harness (repo-wide)

**P1 OWNS the single root `vitest.config.ts` (INTEGRATION-CONTRACT.md C10/C12). The repo currently has no JS test runner; all later phases assume `pnpm test` works and P3/P6/P8/P10/P11 DELETE any duplicate vitest setup (CV10/DS4) — they do not add their own.** This task adds vitest at the workspace root with workspace globs covering `apps/web` + `packages/*`, wires a `test` script, and proves it with one passing sample test. No other phase may create a second vitest config.

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
- Create: `supabase/migrations/20260525122000_p1_verification_appeal_state.sql`
- Create: `supabase/migrations/20260525122100_p1_profile_prompts.sql`
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
-- supabase/migrations/20260525122000_p1_verification_appeal_state.sql
-- Extend S1's verification_state enum with the spec's appeal state (§8).
-- ALTER TYPE ... ADD VALUE cannot run inside a txn block that also uses the new
-- value, so it lives alone in its own migration (Supabase wraps each file in its
-- own transaction; ADD VALUE IF NOT EXISTS is committed before any later file uses it).
alter type verification_state add value if not exists 'appeal';
```

```sql
-- supabase/migrations/20260525122100_p1_profile_prompts.sql
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
git add supabase/migrations/20260525122000_p1_verification_appeal_state.sql \
  supabase/migrations/20260525122100_p1_profile_prompts.sql supabase/tests/p1_appeal_state.sql
git commit -m "P1: verification 'appeal' state + profile_prompts + dealbreakers/onboarding columns"
```

---

## Task 3: Migration — real 18+ age gate (DB trigger, Persona-DOB-derived)

A minor must never be able to enable dating. Compute age from `profiles_private.birthdate` — **which is written service-role from Persona's parsed government-ID DOB by the webhook (Task 6), NOT self-reported** — and **reject** any attempt to set `profiles.dating_enabled=true` unless the user is ≥18. The trigger also re-fires on a `birthdate` change so an edited DOB cannot defeat the gate.

**Files:**
- Create: `supabase/migrations/20260525122300_p1_age_gate_trigger.sql`
- Test: `supabase/tests/p1_age_gate.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_age_gate.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE minor uuid; adult uuid; blocked boolean := false;
BEGIN
  -- Seed via the C8 fixture (auth.users + profiles), never bare-insert into profiles.
  minor := mk_user('minor');
  adult := mk_user('adult');
  -- birthdate here stands in for the Persona-DOB the webhook writes (Task 6).
  insert into profiles_private (user_id, birthdate) values (minor, current_date - interval '16 years')
    on conflict (user_id) do update set birthdate = excluded.birthdate;
  insert into profiles_private (user_id, birthdate) values (adult, current_date - interval '25 years')
    on conflict (user_id) do update set birthdate = excluded.birthdate;

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
-- supabase/migrations/20260525122300_p1_age_gate_trigger.sql
-- Hard 18+ gate. The source of truth is profiles_private.birthdate, which the
-- Persona webhook (Task 6) writes service-role from the parsed government-ID DOB.
-- The user CANNOT set it via RLS (profiles_private.birthdate is service-role-write
-- per S1 RLS), so the gate runs on real ID data, closing the
-- "selfie != age verification" gap.

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

-- Re-fire on a birthdate change: if a dating-enabled user's birthdate is later
-- corrected to a minor DOB (or below 18), revoke dating and resync the cached age.
-- (birthdate is service-role-write only, but this guarantees the gate cannot be
-- defeated by a post-gate birthdate edit — audit MISSING-EDGE #3.)
create or replace function resync_age_on_birthdate() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare yrs numeric;
begin
  if new.birthdate is distinct from old.birthdate and new.birthdate is not null then
    yrs := extract(year from age(new.birthdate));
    update profiles
       set age = floor(yrs)::int,
           dating_enabled = case when yrs < 18 then false else dating_enabled end
     where id = new.user_id;
  end if;
  return new;
end $fn$;

create trigger profiles_private_birthdate_resync
  after update of birthdate on profiles_private
  for each row execute function resync_age_on_birthdate();
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql … -f supabase/tests/p1_age_gate.sql`
Expected: PASS (prints `age gate OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525122300_p1_age_gate_trigger.sql supabase/tests/p1_age_gate.sql
git commit -m "P1: hard 18+ age gate trigger on profiles.dating_enabled (Persona-DOB-derived, re-fires on birthdate change)"
```

---

## Task 4: Migration — preference constraints (pre-filter inputs are well-defined)

The Phase-4 pre-filter reads `gender`, `gender_preferences`, `age_pref`, `distance_pref_km`, `dealbreakers`. P0 created these columns loosely; P1 adds the CHECKs that make the inputs trustworthy so an out-of-range preference can never poison the feed filter.

**Files:**
- Create: `supabase/migrations/20260525122200_p1_preferences_constraints.sql`
- Test: `supabase/tests/p1_preferences.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_preferences.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; bad boolean := false;
BEGIN
  u := mk_user('p');

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
-- supabase/migrations/20260525122200_p1_preferences_constraints.sql
-- Pre-filter input integrity. These bound the values the S5/P4 feed query
-- reads, so a malformed preference can never silently widen or empty a feed.
-- NOTE on int4range canonicalization: a client '[25,40]' literal is stored
-- canonical as [25,41) so upper(age_pref)=41. The S5/P4 pre-filter and the
-- business helper (compatibilityPrefilterInputs) must read the canonical upper
-- as inclusive-1 (ageMax = upper(age_pref) - 1) — flagged for S5 (Depends on).

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
git add supabase/migrations/20260525122200_p1_preferences_constraints.sql supabase/tests/p1_preferences.sql
git commit -m "P1: preference CHECK constraints (well-defined pre-filter inputs)"
```

---

## Task 5: Migration — verification rollup trigger (`verifications` → `profiles.verification`)

The feed pre-filter and badge read **one** column (`profiles.verification`). A trigger rolls the per-kind `verifications` rows up into that aggregate: a user is `verified` only when **both** `phone` AND `age` are verified (selfie is part of the `age` Inquiry — see Task 6 — so age-verified implies a passed liveness selfie). `failed`/`appeal` on any required kind propagates.

**Files:**
- Create: `supabase/migrations/20260525122400_p1_verification_rollup_trigger.sql`
- Test: `supabase/tests/p1_verification_rollup.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_verification_rollup.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; v text;
BEGIN
  u := mk_user('v');

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
-- supabase/migrations/20260525122400_p1_verification_rollup_trigger.sql
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
git add supabase/migrations/20260525122400_p1_verification_rollup_trigger.sql supabase/tests/p1_verification_rollup.sql
git commit -m "P1: verification rollup trigger (verifications -> profiles.verification: phone+age)"
```

---

## Task 6: Verification front door + Persona webhook + phone-row writer (Edge Functions)

This task builds the **verification FRONT DOOR** the audit found missing (audit Critical #1/#2; RECONCILED-MASTER-PLAN.md MD3; contract checklist "P1: verification front door (start inquiry + write `phone` row)"). Without it nothing ever starts verification and no user can reach `verified`. Three Edge Functions:
1. **`start-verification`** (authenticated): creates/embeds a Persona Inquiry with `reference-id = auth.uid()`, seeds `verifications(kind='age', state='pending')` (service-role via the inner service client), returns the embed/session token to the client.
2. **`persona-webhook`** (service-role, no JWT): receives the Persona verdict, verifies the HMAC, upserts `verifications` rows for `age`/`selfie`, **and writes Persona's parsed government-ID DOB into `profiles_private.birthdate`** (the age-gate source of truth — Task 3).
3. **`confirm-phone`** (authenticated): after `auth.verifyOtp` succeeds on the client, writes `verifications(kind='phone', state='verified')` service-role (the client cannot — S1 RLS makes `verifications` writes service-role only). This closes the phone half of the AND-gate.

**Vendor choice — Persona (decision locked).** The spec needs (a) a selfie matched to the profile with liveness, and (b) a *real* age check (the roadmap explicitly flags "selfie ≠ age verification / minors"). A pure-selfie vendor cannot prove ≥18. **Persona** is chosen over Stripe Identity because:
1. **One Inquiry does both jobs** — Persona's Government ID + Selfie template returns a parsed `birthdate` (real age proof) *and* a liveness selfie-to-ID match, closing the "selfie isn't age verification" gap in a single flow. Stripe Identity verifies ID + selfie but is positioned as identity, and its DOB/age extraction is less first-class for a standalone age gate.
2. **Hosted flow + native SDK** — Persona ships a hosted web flow (web today) and iOS/Android SDKs (native later, spec §10) behind the same Inquiry/Template model, so the verify flow we design now is reused on native without rework.
3. **Reference-ID + webhook model** fits our hub-and-spoke exactly: we pass `profiles.id` as the Inquiry `reference-id`; Persona calls our webhook with the verdict; the webhook (and only the webhook, with service-role) writes the result. The client never self-certifies.

`start-verification` opens the Inquiry with `reference-id = auth.uid()`. Persona posts `inquiry.approved | inquiry.declined | inquiry.marked-for-review` to `persona-webhook`. The webhook verifies the HMAC signature, upserts `verifications` rows for kinds `age` and `selfie`, writes the parsed DOB, and lets the Task-5 rollup update `profiles.verification`. On `failed`/`appeal` the webhook fires `dispatch_notification(user, 'account', …)` (S2/C1) so the user gets a failure/appeal notification — there is no verification-specific `notification_type` in the C1 enum (see "Required contract amendments").

**Files:**
- Create: `supabase/functions/start-verification/index.ts`        # FRONT DOOR
- Create: `supabase/functions/confirm-phone/index.ts`             # phone-row writer
- Create: `supabase/functions/persona-webhook/index.ts`
- Create: `supabase/migrations/20260525122500_p1_verifications_user_kind_unique.sql`
- Modify: `supabase/config.toml` (register all three functions; `verify_jwt=false` only for `persona-webhook`)
- Test: `supabase/functions/persona-webhook/index_test.ts`, `supabase/functions/start-verification/index_test.ts`, `supabase/functions/confirm-phone/index_test.ts`

- [ ] **Step 1: Write the failing test (Deno)**

```ts
// supabase/functions/persona-webhook/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { mapInquiryToVerification, verifyPersonaSignature, extractPersonaDob } from './index.ts';

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

Deno.test('extractPersonaDob pulls birthdate from inquiry attributes', () => {
  const dob = extractPersonaDob({ 'birthdate': '2000-01-15' });
  assertEquals(dob, '2000-01-15');
  assertEquals(extractPersonaDob({}), null);
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

// Pure: pull the parsed government-ID DOB out of the Persona inquiry attributes.
// Persona returns a parsed `birthdate` (YYYY-MM-DD) on an approved ID+Selfie inquiry.
// This is the age-gate source of truth (Task 3) — NEVER the self-reported value.
export function extractPersonaDob(inquiryAttributes: Record<string, unknown>): string | null {
  const bd = inquiryAttributes?.['birthdate'];
  return typeof bd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : null;
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

  // Write Persona's parsed government-ID DOB into profiles_private.birthdate
  // (service-role) on an approved inquiry. THIS is the age-gate source of truth
  // (Task 3) — closes the "selfie != age verification" gap (audit MISSING-EDGE #4).
  if (name === 'inquiry.approved') {
    const dob = extractPersonaDob((inquiry?.attributes ?? {}) as Record<string, unknown>);
    if (dob) {
      const { error: dobErr } = await supabase
        .from('profiles_private').update({ birthdate: dob }).eq('user_id', refId);
      if (dobErr) console.error('persona-webhook DOB write error', dobErr.message);
    }
  }

  // On a failed/appeal verdict, notify the user via S2's dispatch_notification
  // (C1). The C1 notification_type enum has no verification-specific value, so we
  // use 'account' (see "Required contract amendments" for the proposed addition).
  if (rows[0].state === 'failed' || rows[0].state === 'appeal') {
    await supabase.rpc('dispatch_notification', {
      p_user: refId, p_type: 'account',
      p_payload: { topic: 'verification', state: rows[0].state, reason: rows[0].failure_reason },
    });
  }

  return new Response(JSON.stringify({ ok: true, mapped: rows.length }), {
    status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
});
```

**`start-verification` (front door)** — authenticated. Resolves `auth.uid()` from the caller's JWT, creates a Persona Inquiry via the Persona API with `reference-id = auth.uid()` (or returns an embed/session token for the hosted flow), then seeds the pending age row service-role and returns the session token:

```ts
// supabase/functions/start-verification/index.ts  (sketch — verify_jwt = true)
// 1. const uid = (await supabase.auth.getUser(jwt)).data.user.id
// 2. POST https://api.withpersona.com/api/v1/inquiries with reference-id=uid,
//    template-id = Deno.env.get('PERSONA_TEMPLATE_ID'), Authorization: PERSONA_API_KEY
// 3. service-role upsert verifications {user_id: uid, kind:'age', state:'pending',
//    provider:'persona', provider_ref: <inquiry id>} onConflict 'user_id,kind'
// 4. return { inquiryId, sessionToken } for the web/native client to embed
// The pure inquiry-request builder (buildInquiryRequest(uid, templateId)) is unit-tested.
```

**`confirm-phone` (phone-row writer)** — authenticated. The client first calls Supabase Auth `verifyOtp` (Twilio provider); on success it calls this function, which re-checks the caller is phone-confirmed (`auth.getUser().phone_confirmed_at` is set) and writes the verified phone row service-role:

```ts
// supabase/functions/confirm-phone/index.ts  (sketch — verify_jwt = true)
// 1. const { user } = (await supabase.auth.getUser(jwt)).data
// 2. if (!user.phone_confirmed_at) return 400 'phone_not_confirmed'
// 3. service-role upsert verifications {user_id:user.id, kind:'phone',
//    state:'verified', provider:'supabase_auth', verified_at: now} onConflict 'user_id,kind'
// The rollup trigger (Task 5) then promotes profiles.verification once age is also verified.
```

The unique index these upserts rely on ships as its own migration in P1's band:

```sql
-- supabase/migrations/20260525122500_p1_verifications_user_kind_unique.sql
-- The webhook / start-verification / confirm-phone upsert on (user_id, kind);
-- enforce one row per user per kind.
create unique index if not exists verifications_user_kind_ukey on verifications (user_id, kind);
```

Register all three functions in `config.toml` (append near the existing `[functions.generate-plan]` block). Only the webhook disables JWT (Persona is not a Supabase user); the front door and phone writer require a logged-in caller:

```toml
[functions.persona-webhook]
verify_jwt = false

[functions.start-verification]
verify_jwt = true

[functions.confirm-phone]
verify_jwt = true
```

- [ ] **Step 4: Run it, expect PASS**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/ supabase/functions/start-verification/ supabase/functions/confirm-phone/`
Expected: PASS (webhook mapping/DOB/HMAC cases; `buildInquiryRequest` case; phone-row shape case). Then `supabase db reset` to apply the unique-index migration (expect clean).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/persona-webhook/index.ts supabase/functions/persona-webhook/index_test.ts \
  supabase/functions/start-verification/ supabase/functions/confirm-phone/ \
  supabase/migrations/20260525122500_p1_verifications_user_kind_unique.sql supabase/config.toml
git commit -m "P1: verification front door (start-verification) + confirm-phone writer + persona-webhook (HMAC + DOB->birthdate) + (user,kind) unique"
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

## Task 8: Migration — profile-photos storage bucket + blurred-photo generation + badge view (RLS)

The profile object that gets revealed at offer. `blurred_photo_url` is visible to anyone browsing; `clear_photo_url` (+ full name) is revealed **only** at offer (spec §7.2) **via the canonical `match_reveal_allowed` predicate (C2, owned by S6/P5) — P1 does NOT define a reveal function**. P1 ships: (a) a **private** `profile-photos` bucket where the blurred derivative is authenticated-readable and the clear original is owner-only; (b) a **blurred-photo generation** Edge Function (`generate-blur`) that produces `<uid>/blurred.jpg` from a clear upload and writes `profiles.blurred_photo_url` — so the blind feed actually has an image (audit DEAD-UI #2); and (c) a `public_profile_card` view (badge + blurred photo + age + prompts — **NO `first_name`, NO name of any kind**, spec §5/§7.2 "no name"; audit UX #4) for what a browser/shortlist sees.

> **Reveal is NOT here.** The former `offer_reveal`/`offer_reveal_for` functions and `supabase/tests/p1_reveal_rls.sql` are **DELETED** (CV6 / DS3). The full at-offer reveal is gated by `match_reveal_allowed(p_viewer, p_instance)` (C2, S6) and the clear-photo signed URL is minted by S6's offer RPC. P1 stores the photos and the badge; S6 owns the reveal predicate and the signed URL.

**Files:**
- Create: `supabase/migrations/20260525122600_p1_profile_photos_bucket.sql`
- Create: `supabase/migrations/20260525122700_p1_badge_view.sql`
- Create: `supabase/functions/generate-blur/index.ts`  (+ `index_test.ts`)
- Modify: `supabase/config.toml` (register `generate-blur`, `verify_jwt = true`)
- Test: `supabase/tests/p1_badge_view.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_badge_view.sql
\i supabase/tests/_fixtures.sql
DO $$
BEGIN
  -- public_profile_card must NOT expose clear_photo_url, full name, OR first_name
  -- (blind feed shows no name — spec §5/§7.2; audit UX #4).
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='clear_photo_url';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes clear_photo_url'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='first_name';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes first_name (spec: no name)'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='full_name';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: public_profile_card exposes full_name'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='badge_verified';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_verified'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='public_profile_card' AND column_name='badge_is_new';
  IF NOT FOUND THEN RAISE EXCEPTION 'public_profile_card missing badge_is_new'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql … -f supabase/tests/p1_badge_view.sql`
Expected: FAIL — `relation "public_profile_card" does not exist`.

- [ ] **Step 3: Write the migrations + blur function**

```sql
-- supabase/migrations/20260525122600_p1_profile_photos_bucket.sql
-- Private bucket for profile photos. Two object-name conventions:
--   <user_id>/blurred.jpg  → readable by any authenticated user (browse/shortlist)
--   <user_id>/clear.jpg    → readable ONLY by the owner via storage RLS; the
--                            clear photo is surfaced to an offer-holder through a
--                            signed URL minted server-side by S6/P5's offer RPC
--                            (gated by match_reveal_allowed, C2), never via a
--                            blanket storage policy.
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
-- supabase/migrations/20260525122700_p1_badge_view.sql
-- public_profile_card: what a browser / shortlisted candidate sees about a
-- creator BEFORE an offer — blurred photo, age, prompts, vibe tags, badge.
-- NO clear photo, NO full name, NO first_name, NO PII. The blind feed shows
-- NO NAME (spec §5/§7.2; audit UX #4). The full reveal (clear photo + name)
-- is gated by match_reveal_allowed (C2, S6) — NOT defined here.
create or replace view public_profile_card
with (security_invoker = true) as
select
  p.id                                            as profile_id,
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
```

**`generate-blur` Edge Function** — authenticated. On clear-photo upload the client calls this with the clear object path; the function downloads `<uid>/clear.jpg`, produces a blurred derivative (Gaussian blur / heavy downscale, e.g. via an ImageMagick/Sharp-equivalent available in the Deno runtime or an image service), uploads `<uid>/blurred.jpg`, and writes `profiles.blurred_photo_url` (service-role). This produces the image the blind feed renders (audit DEAD-UI #2):

```ts
// supabase/functions/generate-blur/index.ts  (sketch — verify_jwt = true)
// 1. const uid = (await supabase.auth.getUser(jwt)).data.user.id
// 2. download `${uid}/clear.jpg` from the private profile-photos bucket
// 3. blur it (downscale + Gaussian); upload `${uid}/blurred.jpg` (upsert)
// 4. service-role update profiles set blurred_photo_url = <signed-or-path> where id = uid
// The pure blur-config builder (blurParams(width,height)) is unit-tested; the
// image bytes path is integration-tested against the local storage emulator.
```

Register it in `config.toml`:
```toml
[functions.generate-blur]
verify_jwt = true
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run:
```bash
supabase db reset \
 && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p1_badge_view.sql \
 && deno test --allow-env --allow-net supabase/functions/generate-blur/
```
Expected: PASS (badge view present; no name columns; blur-config test green).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525122600_p1_profile_photos_bucket.sql \
  supabase/migrations/20260525122700_p1_badge_view.sql \
  supabase/functions/generate-blur/ supabase/config.toml \
  supabase/tests/p1_badge_view.sql
git commit -m "P1: profile-photos bucket + blurred-photo generation + public_profile_card badge view (no name); reveal deferred to C2 match_reveal_allowed"
```

---

## Task 8b: Migration — onboarding step machine advances to `done`

The audit found `onboarding_step` is written by nothing, so `canEnableDating` is a permanent dead-end (audit DEAD-UI #3). This task adds an `advance_onboarding_step(p_to_step text)` SECURITY DEFINER RPC, authorized via `auth.uid()` (INTEGRATION-CONTRACT.md C10), that moves the caller's `onboarding_step` **forward only** through the linear sequence and stamps `onboarding_completed_at` when it reaches `done`.

**Files:**
- Create: `supabase/migrations/20260525122800_p1_onboarding_advance_rpc.sql`
- Test: `supabase/tests/p1_onboarding_advance.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_onboarding_advance.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; step text; ts timestamptz; bad boolean := false;
BEGIN
  u := mk_user('ob');
  -- Make auth.uid() resolve to u inside the SECURITY DEFINER RPC by setting the
  -- JWT sub claim for this transaction (auth.uid() reads request.jwt.claim.sub).
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u::text)::text, true);

  -- Default is 'age_gate'. Advance forward step by step to 'done'.
  perform advance_onboarding_step('basics');
  perform advance_onboarding_step('photos');
  perform advance_onboarding_step('preferences');
  perform advance_onboarding_step('phone_verify');
  perform advance_onboarding_step('selfie_verify');
  perform advance_onboarding_step('done');

  select onboarding_step, onboarding_completed_at into step, ts from profiles where id = u;
  IF step <> 'done' THEN RAISE EXCEPTION 'onboarding did not reach done: got %', step; END IF;
  IF ts IS NULL THEN RAISE EXCEPTION 'onboarding_completed_at not stamped at done'; END IF;

  -- Going backwards must be rejected (forward-only).
  BEGIN
    perform advance_onboarding_step('basics');
  EXCEPTION WHEN others THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'onboarding allowed a backward step'; END IF;

  RAISE NOTICE 'onboarding advance OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql … -f supabase/tests/p1_onboarding_advance.sql`
Expected: FAIL — `function advance_onboarding_step(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525122800_p1_onboarding_advance_rpc.sql
-- Advance the caller's onboarding_step forward through the linear sequence.
-- auth.uid() is the actor (C10). Forward-only; stamps onboarding_completed_at at 'done'.
create or replace function advance_onboarding_step(p_to_step text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  steps text[] := array['age_gate','basics','photos','preferences','phone_verify','selfie_verify','done'];
  cur text; cur_ix int; new_ix int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'advance_onboarding_step: not authenticated'; end if;
  new_ix := array_position(steps, p_to_step);
  if new_ix is null then raise exception 'advance_onboarding_step: invalid step %', p_to_step; end if;

  select onboarding_step into cur from profiles where id = uid;
  cur_ix := array_position(steps, cur);
  if new_ix <= cur_ix then
    raise exception 'advance_onboarding_step: cannot move backward (% -> %)', cur, p_to_step;
  end if;

  update profiles
     set onboarding_step = p_to_step,
         onboarding_completed_at = case when p_to_step = 'done' then now() else onboarding_completed_at end
   where id = uid;
  return p_to_step;
end $fn$;

revoke execute on function advance_onboarding_step(text) from public;
grant execute on function advance_onboarding_step(text) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql … -f supabase/tests/p1_onboarding_advance.sql`
Expected: PASS (prints `onboarding advance OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525122800_p1_onboarding_advance_rpc.sql supabase/tests/p1_onboarding_advance.sql
git commit -m "P1: advance_onboarding_step RPC (forward-only; reaches 'done', stamps completed_at)"
```

---

## Task 9: api-client — typed profile/preferences/verification/onboarding/device helpers

Thin, typed wrappers so the web app (and later native) call one shared API surface rather than hand-rolling Supabase queries. Mirrors the existing `@after5/api-client` style. Exports: `getMyProfile`, `upsertProfile`, `savePreferences`, `getMyBadge`, `startVerification` (front door), `confirmPhone`, `advanceOnboarding`, `registerDevice` (wraps S2's `register_device`). **No `revealCreator` — reveal is `match_reveal_allowed` (C2, S6).**

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

// Read the caller's full profile to hydrate the onboarding/edit form.
export async function getMyProfile(client: After5Client, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('id, first_name, age, vibe_tags, prompt_answers, dealbreakers, gender, gender_preferences, age_pref, distance_pref_km, verification, reliability_score, onboarding_step, dating_enabled, blurred_photo_url')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
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

// FRONT DOOR: start identity verification (invokes the start-verification Edge
// Function which creates the Persona Inquiry + seeds verifications(age,pending)).
export async function startVerification(client: After5Client): Promise<{ inquiryId: string; sessionToken: string }> {
  const { data, error } = await client.functions.invoke('start-verification', { body: {} });
  if (error) throw error;
  return data as { inquiryId: string; sessionToken: string };
}

// After Supabase Auth verifyOtp succeeds, write the verified phone row (server-side).
export async function confirmPhone(client: After5Client): Promise<void> {
  const { error } = await client.functions.invoke('confirm-phone', { body: {} });
  if (error) throw error;
}

// Advance the onboarding step machine (DB RPC; only forward, validated server-side).
export async function advanceOnboarding(client: After5Client, toStep: string): Promise<string> {
  const { data, error } = await client.rpc('advance_onboarding_step', { p_to_step: toStep });
  if (error) throw error;
  return data as string;
}

// Register this device for push notifications. Calls S2/P2's canonical
// register_device RPC (INTEGRATION-CONTRACT.md C1/C11.2) — P1 does NOT define it.
export async function registerDevice(
  client: After5Client,
  token: string, platform: string, webPush: unknown = null,
): Promise<void> {
  const { error } = await client.rpc('register_device', {
    p_token: token, p_platform: platform, p_web_push: webPush,
  });
  if (error) throw error;
}

// NOTE: there is NO revealCreator here. The full at-offer reveal is gated by the
// canonical match_reveal_allowed predicate (C2) and exposed by S6/P5's offer RPC
// (which also mints the clear-photo signed URL). P1 does not wrap a reveal call.
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
git commit -m "P1: api-client profile/preferences/verification/onboarding/register_device helpers (no reveal wrapper)"
```

---

## Task 10: Full verification + types regen + green-suite gate

End-to-end check that every P1 migration applies cleanly, all SQL invariant tests pass, all vitest suites pass, the Deno function tests pass, and the generated types include the new columns/views.

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full DB reset (applies S1/P0 + S2/P2 + every P1 migration in order)**

Run: `supabase db reset`
Expected: completes with no error; S1/S2 migrations apply first (so `register_device`/`dispatch_notification`/`_fixtures.sql` exist), then `20260525122000…122800` P1 migrations apply in their band.

- [ ] **Step 2: Run all P1 SQL tests**

Run:
```bash
for f in supabase/tests/p1_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`. (Each test `\i`'s `_fixtures.sql` and seeds via `mk_user` — C8.)

- [ ] **Step 3: Run all JS + Deno tests**

Run:
```bash
pnpm test
deno test --allow-env --allow-net supabase/functions/persona-webhook/ \
  supabase/functions/start-verification/ supabase/functions/confirm-phone/ supabase/functions/generate-blur/
```
Expected: vitest `passed` across `validators`, `business`, `api-client`, and the harness smoke test; Deno `ok` across the webhook/front-door/phone-writer/blur tests.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` updates to include the new `profiles` columns (`dealbreakers`, `prompt_answers`, `onboarding_step`, `onboarding_completed_at`), `profile_prompts`, the `appeal` enum value on `verification_state`, the `public_profile_card` view (no name columns), and the `advance_onboarding_step` function. (There is NO `offer_reveal` function — reveal is `match_reveal_allowed`, C2/S6.)

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P1: regenerate database types for identity/profile/onboarding schema"
```

---

## Self-Review

**Coverage vs the contract's "P1:" reconciliation checklist (INTEGRATION-CONTRACT.md):**
- **verification front door (start inquiry + write `phone` row)** → Task 6 (`start-verification` creates the Persona Inquiry + seeds `verifications(age,pending)`; `confirm-phone` writes `verifications(phone,verified)` service-role). A user can now actually reach `verified`. ✅
- **DOB age gate** → Task 3 + Task 6: the webhook writes Persona's parsed government-ID DOB into `profiles_private.birthdate` (service-role); the 18+ trigger computes age from that birthdate (never self-reported) and re-fires on birthdate change. ✅
- **advance `onboarding_step`** → Task 8b (`advance_onboarding_step` RPC reaches `done`, stamps `onboarding_completed_at`). `canEnableDating` is no longer a dead-end. ✅
- **blurred photo** → Task 8 (`generate-blur` Edge Function produces `<uid>/blurred.jpg` + writes `profiles.blurred_photo_url`). The blind feed has an image. ✅
- **drop `first_name` from public card** → Task 8 (`public_profile_card` no longer selects any name; test asserts absence of `first_name`/`full_name`). Spec "no name" honored. ✅
- **drop `offer_reveal`** → DELETED (CV6/DS3); reveal is canonical `match_reveal_allowed` (C2, S6). No reveal function or wrapper remains in P1. ✅
- **own root vitest** → Task 0 (single root `vitest.config.ts`; other phases delete duplicates — C10/C12). ✅
- **`register_device`** → Task 9 `registerDevice` wraps S2's `register_device` RPC (C1/C11.2); called at onboarding. P1 does not redefine `devices`/`notifications`. ✅

**Coverage vs this phase's `Closes` list (roadmap Phase 1):**
- **Critical #4 — profile black hole** → Task 2 (prompts table + `prompt_answers`/`vibe_tags`), Task 8 (`public_profile_card` browse view, no name), Task 9 (`upsertProfile`). The pre-offer profile object — blurred photo, age, prompts, vibe tags, badge — is defined, stored, and surfaced; the full at-offer reveal is owned by S6 (`match_reveal_allowed`). ✅
- **Critical #6 — verification named-not-built** → Task 6 (front door + webhook actually write `verifications`), Task 5 (rollup → `profiles.verification`), Task 1/7 (`VerificationState` incl. `appeal`; eligibility). ✅
- **"selfie ≠ age verification / minors"** → Persona's Government-ID+Selfie Inquiry yields a real DOB written to `profiles_private.birthdate`; the rollup requires `age='verified'`; Task 3's DOB-derived 18+ trigger blocks `dating_enabled` regardless of client claims. ✅
- **No age gate** → Task 3 (DB trigger, Persona-DOB source) + Task 1 (`MIN_AGE` in Zod) + Task 7 (`isAdult`/`canEnableDating`). Defence in depth: type boundary, business logic, hard DB constraint. ✅
- **Pre-filter inputs undefined** → Task 4 (CHECK constraints) + Task 7 (`compatibilityPrefilterInputs`). ✅
- **Dead "Verified · New" badge** → Task 7 (`badgeFor`) + Task 8 (`public_profile_card.badge_verified`/`badge_is_new`). True at launch. ✅
- **Required: establish single root vitest harness** → Task 0. ✅

**Builds on S1/S2 (does not recreate):** references `profiles` (extends with `dealbreakers`/`prompt_answers`/`onboarding_*`), `profiles_private` (writes `bio`; webhook writes `birthdate`; reads `birthdate`), `verifications` (adds `appeal` enum value, `(user_id,kind)` unique, rollup trigger), `cities`/`itineraries`/`date_instances` (read-only test joins via `mk_*` fixtures). **Consumes (does not define):** S2's `register_device`, `dispatch_notification`, `devices`, `notifications`, `notification_type` (C1/C11.2); S6's `match_reveal_allowed` (C2). No S1/S2 object is redefined.

**Placeholder scan:** every step has runnable SQL/TS/Deno + exact commands. The Persona Inquiry **template id / environment keys** are env/secrets (documented for the web onboarding UI), not faked; the front-door function, webhook, phone writer, blur function, onboarding RPC, and badge view are fully specified and tested. No dead UI: every api-client helper maps to a real RPC/Edge Function/table; there is no orphaned reveal call.

**Type/name consistency:**
- Verification states identical across layers: DB `verification_state ('unverified','pending','verified','failed','appeal')` = `VerificationStateSchema` = `VState` in the Edge Function = `VerificationState` in business.
- Preference column names match S1 exactly (`age_pref int4range`, `gender_preferences text[]`, `distance_pref_km`).
- Badge fields (`badge_verified`/`badge_is_new`) match `badgeFor()`'s `{verified, isNew}` output.
- Reveal predicate = `match_reveal_allowed(p_viewer uuid, p_instance uuid)` (C2) — owned by S6, NOT defined here.
- `register_device(p_token text, p_platform text, p_web_push jsonb)` signature matches C1/C11.2.
- Prompt ids identical in `PROMPT_IDS` (validators) and the `profile_prompts` seed (Task 2).
- Migration filenames all in P1's `122xxx` band (C6).

**Assumptions locked:**
1. **Vendor = Persona** (single Inquiry does liveness selfie + real government-ID DOB; hosted web + native SDK; reference-id/webhook fits hub-and-spoke). Stripe Identity rejected for weaker standalone age/DOB positioning.
2. **Required verification kinds for a "verified" profile = phone + age** (age Inquiry subsumes the selfie/liveness match). Phone rides Supabase Auth's Twilio provider; `confirm-phone` (Task 6) writes the `phone` row server-side after `verifyOtp` (the client cannot — S1 RLS makes `verifications` service-role-write).
3. **Photos:** private `profile-photos` bucket; `blurred.jpg` authenticated-readable (produced by `generate-blur`, Task 8), `clear.jpg` owner-only + signed URL minted by S6/P5's offer RPC under `match_reveal_allowed`.
4. **"New" threshold:** `reliability_score IS NULL` ⇒ New (P7/S8 populates the score after `MIN_RATINGS_FOR_ESTABLISHED=3` ratings).
5. **Verification-failure / appeal notifications** ride `dispatch_notification(user,'account',…)` (the C1 enum has no verification type). A dedicated `notification_type` value (`verification_passed`/`verification_failed`/`appeal_resolved`) would be cleaner — see "Required contract amendments"; until amended, `'account'` is the canonical value.
6. **Deferred to named later phases (intentionally NOT in P1):** the onboarding UI screens + Persona embed component (web UI, S3-adjacent UI layer); the feed query that *consumes* `compatibilityPrefilterInputs` (S5/P4); the reveal predicate + signed-clear-photo URL minting (S6/P5 — `match_reveal_allowed`); reliability score computation (S8/P7); the appeal **review** console (S9/P8). The `int4range` inclusive-vs-canonical upper boundary is flagged for S5 (Task 4 note).

---

## Required contract amendments (raise before executing this slice)

These are the only places where P1's needs are not fully covered by INTEGRATION-CONTRACT.md v2; per Build Rule 1 ("update the contract in the same change"), raise these before coding:

1. **Verification notification types.** The C1 `notification_type` enum has no verification-specific value, so verification-failed/appeal notifications currently use `'account'`. Recommend adding `verification_passed`, `verification_failed`, `appeal_resolved` to the C1 enum (owner P2/S2). Until then this slice uses `'account'` (no fabricated enum value).
2. **Appeal flow ownership.** P1 ships the `appeal` *state* (enum value + rollup propagation) but the **appeal submission RPC and review surface** are not owned by any contract section. Recommend the contract assign appeal submission to S3 (here) or S9, and appeal review to S9/P8 (which already owns moderation). This slice does not invent an appeal flow; it only carries the state.
3. **DOB write to `profiles_private.birthdate` from the webhook.** The contract should note that the Persona webhook (S3) is an authorized service-role writer of `profiles_private.birthdate` (S1 owns the column/RLS) — confirm S1's RLS leaves `birthdate` service-role-writable so Task 6 can set it.
