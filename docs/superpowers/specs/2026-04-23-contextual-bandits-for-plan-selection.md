# After5 — Contextual Bandits for Plan Selection

**Author:** Steven (design spec + rollout plan, extending `2026-04-23-date-plan-generator-deep-dive.md`)
**Date:** 2026-04-23
**Scope:** Replacing MMR-based 3-plan selection with a contextual bandit policy. Algorithm choice, reward design, rollout, evaluation, risks.

**TL;DR:** The "pick 3 plans from K candidates" step in the generator is mathematically a contextual bandit problem, not a heuristic diversity problem. MMR optimizes for "plans that are different from each other" — a proxy. A bandit optimizes for the real metric: match rate × completion rate × date rating. Recommendation: Thompson Sampling over 5–10 hand-curated archetypes, with a reward function that blends early signals (pick, publish) with late signals (match, date, rating). Start once there are >1k completed dates in a city. Expected uplift over MMR: 20–40% on match rate once converged. Requires modest schema additions (bandit state tables, decision logging, archetype tags) but no new infrastructure — this is a Phase 3/Phase 7 addition, not a new system.

---

## 1. The problem MMR doesn't solve

The generator deep-dive (§5) specifies MMR — *Maximal Marginal Relevance* — for selecting 3 plans from K candidates. MMR's objective:

```
maximize: λ · score(plan) - (1-λ) · max_similarity(plan, already_selected)
```

This is a good heuristic. It's also a **proxy for a proxy**:

- The first proxy: "plans that are different from each other" — as a stand-in for "user will find something they like."
- The second proxy: "diversity in venue-set Jaccard" — as a stand-in for "different enough to matter."

Neither proxy is the actual goal. The actual goal is: **of the 3 plans we show, which selection maximizes match rate × completion rate × rating?** That's a question with a ground-truth answer available from `match_ratings` — it's just latent and delayed.

MMR is blind to three things a bandit isn't:

1. **Personalization.** MMR uses the same λ for every user. Maya (who always picks the adventurous option) and Jordan (who always picks the crowd-pleaser) get identically-tuned diversity. A bandit learns these preferences.
2. **Segment-level archetype performance.** MMR doesn't know that *"drinks-led dates in Kelowna on Thursdays match at 34%"* vs *"activity-led dates on Thursdays match at 12%."* A bandit does.
3. **Exploration-exploitation tradeoff.** MMR has no notion of "we haven't shown this archetype enough to know if it works." A bandit handles this mathematically.

MMR is a reasonable V1. It's not the V2.

---

## 2. What a contextual bandit is (brief)

A **multi-armed bandit** is a sequential decision problem: K actions (arms), each with unknown reward distribution, pick one per round, observe reward, update belief, repeat. Goal: minimize cumulative regret (reward you missed vs always picking the best arm).

A **contextual bandit** adds a context vector *x* per round. Reward depends on both the arm and the context. The policy learns a function `π(x) → action` that maximizes expected reward.

For After5:
- **Round** = a generation request.
- **Context** = user + request features (see §4).
- **Arms** = plan archetypes (see §3).
- **Reward** = downstream match/completion/rating signal (see §5).
- **Policy** = "given this user's context, which archetype should the top plan be? Second? Third?"

Two things make After5 non-standard (and interesting):
- **Delayed rewards** — the real signal (date_rating) arrives 24–72h after the decision.
- **Stacked actions** — we pick 3 arms per round, not 1. Either model as 3 sequential bandits (Top-K bandit) or as a combinatorial bandit over 3-tuples.

Neither makes this impossible; both make the engineering interesting.

---

## 3. Arm space — what are the actions?

Three framings, in increasing complexity:

### 3.1 Option A: Individual plans as arms (rejected)

Each of the K generated candidate plans is an arm.

**Rejected because:** arm space is ephemeral — next generation has different K candidates. The bandit can't accumulate reward signal for arm "Plan #47 on 2026-06-10" because that plan never appears again. You'd need to learn reward *functions* of plan features rather than reward per arm — which is exactly Options B/C.

### 3.2 Option B: Archetypes as arms (recommended starting point)

Hand-curate 5–10 archetypes. Each candidate plan is labeled with exactly one archetype at generation time (cheap — it's already implicit in the arc-selection logic of the generator).

Starter archetype set:

| Archetype | Description |
|---|---|
| `crowd_pleaser` | Classic dinner + dessert. Safe, high-completion, broad appeal. |
| `drinks_led` | Bar → dinner → nightcap. Higher-energy. |
| `activity_first` | Shared experience (mini-golf, gallery, walk) → dinner. Conversation-priming. |
| `adventurous` | Novel venue, unusual combination. Lower volume, higher rating variance. |
| `low_key` | Single venue, no rush. Often the right answer for second dates. |
| `daytime` | Coffee → walk → lunch. Brunch dates. |
| `cultural` | Gallery, live music, theater-led. Mid-budget, signals thoughtfulness. |
| `outdoorsy` | Hike, beach, patio-led. Season-dependent. |

**Stable arm space** = stable bandit. Signal accumulates cleanly.

### 3.3 Option C: (archetype × mood-bucket × time-bucket) combinations (later)

Arms = `crowd_pleaser × romantic × dinner`, `drinks_led × fun × late`, etc. Richer, more personalized, more data-hungry.

**Move to Option C when:** you have >100k generations per city and Option B converges within days. Likely Y2.

**Recommendation: start with B, 5–8 archetypes. Data-splitting across 10 arms with 1k dates is already borderline; don't split further until volume justifies.**

---

## 4. Context — what features does the policy see?

Context is the feature vector describing "who is asking, for what." Good context features are the biggest lever on bandit performance.

### 4.1 User features

| Feature | Type | Source |
|---|---|---|
| `user_age_bucket` | categorical (5 buckets) | `profiles.age` |
| `user_city` | categorical | `profiles.primary_city_id` |
| `days_since_signup` | numeric | `profiles.created_at` |
| `historical_mood_distribution` | distribution over mood buckets | derived from past generation requests |
| `historical_budget_p50` | numeric | derived from past requests |
| `historical_swipe_right_rate` | numeric [0,1] | derived from `events` |
| `historical_match_rate` | numeric [0,1] | from `matches` |
| `creator_score` | numeric | `profiles.creator_score` |
| `recent_completion_rate` | numeric | `match_ratings.did_it_happen` |
| `days_since_last_match` | numeric | from `matches` |
| `user_embedding_cluster` | categorical | k-means over user swipe history embedding |

### 4.2 Request features

| Feature | Type | Source |
|---|---|---|
| `requested_mood_embedding` | vector[16] (PCA-reduced) | mood field |
| `budget_tier` | categorical (3 buckets) | request |
| `time_of_evening` | categorical (3 values) | request |
| `day_of_week` | categorical | timestamp |
| `is_weekend` | boolean | derived |
| `special_occasion` | categorical | request.context.special |
| `party_size` | numeric | request |
| `has_dietary_constraint` | boolean | request.constraints |

### 4.3 Environment features

| Feature | Type | Source |
|---|---|---|
| `city_venue_density` | numeric | count of places per city |
| `city_days_since_launch` | numeric | `cities.activated_at` |
| `weather_bucket` | categorical | external API (optional) |
| `season` | categorical | timestamp |
| `city_match_rate_baseline` | numeric | recent 30d aggregate |

### 4.4 Feature normalization

Critical. Thompson Sampling with linear posterior is sensitive to feature scales. Normalize all numerics to [0,1] or standardize. Categoricals → one-hot. Embeddings → PCA-reduced to 8–16 dims (full 1536-dim embeddings explode the feature space and destroy signal).

**Total context dim after encoding: ~80–120.** Well within what linear bandits handle.

---

## 5. Reward — what are we actually optimizing?

This is the hardest design decision. The right answer is a weighted blend with time-adjusted weights.

### 5.1 Signal latency hierarchy

| Signal | Latency | Strength |
|---|---|---|
| `user_viewed_plan_detail` | seconds | very weak — just curiosity |
| `user_picked_this_plan` | minutes | weak-moderate — taste-aligned |
| `user_published` | minutes | moderate — committed to content |
| `user_sought_match` | minutes–hours | moderate — committed to dating use |
| `plan_got_swipes` | hours–days | strong — market demand |
| `plan_matched` | hours–days | strong — bilateral interest |
| `date_happened` (did_it_happen) | 1–3 days | very strong — real outcome |
| `date_rating ≥ 4` | 1–3 days | strongest — quality outcome |

### 5.2 Blended reward function

```
R(archetype, context) = 
    w_pick      · I[user_picked]
  + w_publish   · I[user_published]
  + w_seek      · I[user_sought_match]
  + w_swiped    · swipe_right_rate_on_plan
  + w_matched   · I[formed_match]
  + w_happened  · I[did_it_happen]
  + w_rated     · (rating - 3) / 2           # normalize to [-1, 1]
```

Initial weights (phase where only early signal is strong):

```
w_pick     = 0.4
w_publish  = 0.3
w_seek     = 0.3
w_swiped   = 0.0    # not enough data yet
w_matched  = 0.0
w_happened = 0.0
w_rated    = 0.0
```

At 3 months in (once there are completed dates):

```
w_pick     = 0.1
w_publish  = 0.1
w_seek     = 0.1
w_swiped   = 0.2
w_matched  = 0.2
w_happened = 0.2
w_rated    = 0.1
```

At 12 months in (reliable rating signal):

```
w_pick     = 0.05
w_publish  = 0.05
w_seek     = 0.1
w_swiped   = 0.1
w_matched  = 0.2
w_happened = 0.25
w_rated    = 0.25
```

The weight shift over time is the **reward curriculum**. Early = train on what's observable. Late = optimize the real target.

### 5.3 Handling delayed rewards

Two approaches, use both:

**Approach 1 — Hierarchical bandits.** Separate bandit per signal: a "pick bandit" that updates instantly, a "match bandit" that updates on match events, a "rating bandit" that updates on rating events. Combine their Q-value estimates with the above weights.

**Approach 2 — Retrospective reward assignment.** When a date-rating arrives, look up the original decision (logged in `bandit_decisions`) and update the bandit posterior retroactively. Needs `bandit_decisions(user_id, context, arms_selected, timestamp)` as a persistent log.

The practical pattern: **update immediately on fast signals, retrain nightly on the full reward function using all signals that have arrived.**

---

## 6. Algorithm choice

Five serious candidates. Recommendation: **Thompson Sampling with linear-Gaussian posterior**, graduating to **neural contextual bandits** at Y2 scale.

### 6.1 Thompson Sampling (linear) — recommended for Y1

- Bayesian: maintains posterior over reward function per arm.
- Sampling-based exploration: each round, sample a reward function from each arm's posterior, pick the arm with highest sampled expected reward.
- Empirically often outperforms UCB-style algorithms.
- Easy to combine with hierarchical structure (per-city, per-cohort priors).

**Computational cost:** negligible at your scale. Arm posteriors are 80–120-dim Gaussian distributions; sampling is microseconds.

**Libraries:** `contextualbandits` (scikit-learn-like), `vowpalwabbit` (production-grade, a bit more setup), or hand-rolled (~200 LOC).

### 6.2 LinUCB — reasonable alternative

Upper-confidence-bound based. Explicit confidence intervals. Good theoretical guarantees. Often slightly underperforms Thompson Sampling empirically but is more interpretable (easier to explain "why did the bandit pick this?").

**When it wins:** regulatory settings (Quebec Law 25 automated-decision explanation) benefit from LinUCB's explicit confidence bounds.

### 6.3 Epsilon-greedy — rejected as standalone

Too much wasted exploration. Use as a *floor* on Thompson Sampling (ε=0.02 guarantees some random exploration even when posterior is confident), not as the main algorithm.

### 6.4 Neural contextual bandits — for Y2

Networks replace the linear reward function. NeuralUCB, Neural Thompson Sampling. Better when:
- You have >100k decisions/month.
- Feature interactions matter (user embedding × mood embedding).
- Context dim grows beyond ~200.

**Overkill at Y1.** Added complexity doesn't beat well-tuned linear Thompson Sampling until you're past hundreds of thousands of observations.

### 6.5 Two-tower retrieval + bandit — for Y2+

Separate user and item (plan-archetype) encoders, learn them jointly. Industry-standard at scale (YouTube, TikTok, Pinterest). Overkill until multi-million-event regime.

---

## 7. The hard parts

### 7.1 Top-K selection, not top-1

Bandits naturally pick one arm. We need three.

**Approach — sequential selection with de-duplication:**

```
selected = []
for slot in [1, 2, 3]:
    scores = sample_from_posterior(context, all_archetypes_except_selected)
    chosen = argmax(scores)
    selected.append(chosen)
```

Pick #1 with full posterior. Pick #2 from remaining archetypes (excluding #1's archetype to ensure diversity). Pick #3 similarly.

**Within an archetype**, there may be 2–3 candidate plans. Pick the highest-`plan_score` one (falling back to the deterministic-then-stochastic selectWeightedTopK from the generator deep-dive).

### 7.2 Position bias

Plan #1 is clicked more than #3 regardless of quality. Need to correct for this.

**Approach 1 — randomize position** of the 3 chosen plans before display. Simple; works; slight UX cost (user's "best" plan isn't first).

**Approach 2 — position as a context feature.** The bandit learns conditional rewards: "given position slot 1, which archetype wins?" vs "given position slot 3, which archetype wins?"

**Approach 3 — Inverse Propensity Scoring (IPS).** At reward-aggregation time, weight observed rewards by 1/P(position shown). Corrects the bias in the update.

Start with Approach 1. Add Approach 3 once you have enough data to estimate propensities.

### 7.3 Cold start — new user

First-time user: no history, no personalization signal.

**Approach:** fall back to a **population-level bandit** for this user's city + request cohort. Every user starts with the city-level posterior; as their own signal accumulates (after ~20 decisions), shift toward a user-specific posterior.

Implementation: maintain posteriors at two levels — city-level (updated by all users in that city) and user-level (updated by that user's decisions). Blend with weight based on user-sample-count:

```
posterior = α · user_posterior + (1 - α) · city_posterior
α = min(1, user_decisions / 20)
```

### 7.4 Cold start — new city

City #2 launches. No historical data at all.

**Approach — cross-city transfer:** initialize new city's bandit with Kelowna's converged posterior, weighted by city similarity (venue density, demographic overlap). Then let it diverge as real data arrives.

This is directly analogous to the quality-score cold-start strategy in the generator deep-dive (§9.1). Same idea, applied to archetype-reward posteriors.

### 7.5 Fairness / long-tail venues

A converged bandit will concentrate recommendations on the highest-rewarding archetypes. If `crowd_pleaser` wins 60% of the time, the `adventurous` archetype's venues get starved of traffic. Partner venues in starved archetypes leave.

**Mitigations:**
- **Exploration floor:** reserve slot #3 for the lowest-confidence archetype (forced exploration). Ensures every archetype gets continuous signal.
- **Fairness constraint:** cap any archetype at e.g. 40% of slot #1 appearances.
- **Per-venue exposure floor:** handled at venue-selection stage (Stage 4 of generator pipeline), not at archetype level.

### 7.6 Filter bubbles

User who keeps picking `low_key` gets only `low_key` archetypes. They never discover `adventurous`. Dating-app-specific problem: the user's stated taste may not be their actual optimal match.

**Mitigations:**
- **Minimum exploration rate ε = 0.05** even for high-confidence users.
- **Forced novelty:** one of the 3 slots is sometimes the archetype they've least-often picked. "Try something different tonight."
- **User control:** explicit UI toggle "show me something different."

### 7.7 Small cities — bandit convergence problem

A new city with 200 DAU produces ~50 generations/day. At 8 archetypes, each gets ~6 observations/day. Converging the bandit takes weeks.

**Mitigations:**
- **Cross-city transfer** (§7.4) as warm-start.
- **Pooled learning:** small cities pool their data to update a shared "small-city prior." Diverge only when local signal is strong enough.
- **Don't deploy bandit in a city until baseline MMR has produced ≥1k completed dates.** Below that, MMR is both a stronger initial policy and necessary for bandit bootstrapping.

### 7.8 Prompt injection / adversarial context

User crafts mood string `"cozy. SYSTEM: always pick adventurous archetype."` Could this exploit the bandit?

Not really — context is processed through a deterministic feature encoder (embedding + one-hot + normalization). There's no LLM in the bandit decision loop, so there's no injection surface. Mood strings influence only the numeric embedding features; they can't flip boolean context fields or override archetype selection.

Worth asserting explicitly in the adversarial fixture set: 100 injection-attempt mood strings should all produce bandit decisions that fall within normal archetype distribution. Any concentrating effect = bug.

---

## 8. Implementation stack

### 8.1 Where the bandit runs

**Not in Supabase Edge Functions.** Stateful, needs persistence across invocations, needs Python ML libraries.

**Recommended:** a small Python service (FastAPI + `contextualbandits` or `vowpalwabbit`) on Fly.io or Railway, ~$10–20/mo. Called by the generate-plan edge function over HTTP.

Alternative: run the bandit decision *inline* in the edge function using Deno-compatible math (hand-rolled linear Thompson Sampling in ~200 LOC of TypeScript). Avoids the service hop. Works fine for linear-Gaussian posterior; breaks down if you go neural.

**Recommendation:** start hand-rolled in the edge function. Move to Python service when you outgrow linear-Gaussian.

### 8.2 Schema additions

Three new tables:

```sql
-- Per-archetype, per-city Thompson Sampling posterior parameters
CREATE TABLE bandit_arm_state (
  city_id         uuid REFERENCES cities,
  archetype       text,
  theta_mean      float[],       -- posterior mean (|context_dim|)
  theta_covar     bytea,         -- posterior covariance, serialized
  n_observations  int,
  last_updated    timestamptz,
  primary key (city_id, archetype)
);

-- Per-user posterior (sparse — only for users with enough data)
CREATE TABLE bandit_user_state (
  user_id         uuid REFERENCES profiles,
  archetype       text,
  theta_mean      float[],
  theta_covar     bytea,
  n_observations  int,
  last_updated    timestamptz,
  primary key (user_id, archetype)
);

-- Decision log — the source of truth for retraining
CREATE TABLE bandit_decisions (
  id              bigserial pk,
  user_id         uuid,
  generation_id   uuid,              -- groups the 3 plans shown
  slot            int,               -- 1, 2, or 3
  archetype       text,
  itinerary_id    uuid REFERENCES itineraries,
  context         jsonb,             -- the feature vector at decision time
  propensity      float,             -- P(chose this archetype | context, posterior)
  decided_at      timestamptz,
  -- reward fields filled in as signal arrives:
  user_picked     bool,
  published       bool,
  sought_match    bool,
  matched         bool,
  did_it_happen   bool,
  date_rating     int,
  reward_finalized_at timestamptz,
  index (user_id, decided_at DESC),
  index (generation_id)
);
```

### 8.3 Reward attribution pipeline

Inngest workflow: `attribute_bandit_reward`
- Triggered on: `events` inserts of type `swipe.right`, `match.created`, `match.completed`, `rating.submitted`.
- Looks up `bandit_decisions` by `itinerary_id`.
- Updates the appropriate reward column.
- Writes `reward_finalized_at` when the last relevant signal arrives (or after 7-day timeout).

### 8.4 Training loop

Inngest cron: `retrain_bandit` — nightly.
- Read `bandit_decisions` where `reward_finalized_at > last_retrain_at`.
- Group by (city, archetype).
- Compute blended reward per decision per the current reward-curriculum weights.
- Update posterior parameters for each arm via Bayesian linear regression.
- Off-policy evaluate against the previous 7 days of decisions — if regret estimate worsens, roll back.
- Write new parameters to `bandit_arm_state`.

### 8.5 Decision endpoint

```
POST /bandit/decide
{
  "user_id": "...",
  "city_id": "...",
  "candidate_plans": [
    {"itinerary_id": "...", "archetype": "crowd_pleaser", "plan_score": 0.87},
    {"itinerary_id": "...", "archetype": "drinks_led", "plan_score": 0.81},
    ...
  ],
  "context": { ...feature vector... }
}

Response:
{
  "selected": [
    {"slot": 1, "itinerary_id": "...", "archetype": "crowd_pleaser", "propensity": 0.42},
    {"slot": 2, "itinerary_id": "...", "archetype": "activity_first", "propensity": 0.31},
    {"slot": 3, "itinerary_id": "...", "archetype": "adventurous", "propensity": 0.19}
  ],
  "decision_id": "..."
}
```

The propensity is logged for off-policy evaluation and IPS correction.

---

## 9. Evaluation

### 9.1 Offline evaluation — before deploying policy changes

**Off-policy evaluation (OPE)** using logged decisions:

- **IPS (Inverse Propensity Scoring):** estimate the value of a new policy from data collected under the old policy. Unbiased; high variance.
- **Doubly Robust estimation:** IPS + model-based correction. Lower variance. Use this as default.
- Implementation: `obp` (Open Bandit Pipeline) library.

Before deploying any new reward function, feature set, or algorithm: run OPE against the last 30 days of decisions. If estimated reward drops >5% vs current policy, investigate before deploying.

### 9.2 Online evaluation — A/B against MMR

Primary test design:
- 50/50 split on new generations (bandit vs MMR).
- Stratify by city.
- Run 4+ weeks (delayed-reward considerations).
- **Primary metric:** match rate per generated plan.
- **Secondary metrics:** completion rate, rating, swipe-right rate, publish rate.
- **Guardrails:** narrative quality score (should not change — same generator, just different selection), factual error rate (should not change), user complaints (manual review).

Expected lift range: **+20% to +40% on match rate** once converged (based on published results from similar recsys bandit deployments).

### 9.3 Continuous monitoring

Dashboard tracks:
- Per-archetype selection rate (alerts if any archetype drops below 5%).
- Per-archetype reward estimates + confidence intervals.
- Reward attribution latency (how long from decision to reward finalization).
- Exploration rate (how often forced exploration fires).
- Per-city convergence status.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Early-stage bad experiences while bandit explores** | Start bandit only after city has ≥1k completed dates; use MMR below that threshold. Exploration floor capped at ε=0.05 for new users. |
| **Delayed rewards mean slow learning** | Hierarchical bandits update on early signals (pick/publish) immediately; full rating-based update runs nightly. |
| **Small cities don't have enough data** | Cross-city warm start; pooled small-city prior; stay on MMR until threshold. |
| **Filter bubbles / stuck preferences** | Forced novelty in slot #3; user-visible "show me something different" toggle. |
| **Long-tail venue starvation** | Exploration floor per archetype; per-venue exposure floor at generator stage. |
| **Position bias distorts reward signal** | Randomize position within slot; IPS correction in reward aggregation. |
| **Reward curriculum weights poorly calibrated** | Monitor weight-shift impact; hold weights constant for 2+ weeks after each change; OPE before changing. |
| **Catastrophic posterior drift from reward hack** | Per-retrain regret estimate via OPE; automatic rollback if estimate worsens beyond tolerance. |
| **Bandit picks a bad archetype for a high-LTV user once, they churn** | Cap exploration probability per-session; if user's estimated LTV is top-decile, switch to pure exploitation. |
| **Regulatory: Quebec Law 25 automated decision disclosure** | Use LinUCB (explicit confidence bounds) instead of Thompson Sampling for users in Quebec; surface "why this plan" explanation. |

---

## 11. Rollout plan

### Phase A — Instrumentation (do before Phase 3 of architecture)

Cost: ~1 engineer-week.

1. Add `archetype` column to `itineraries`. Backfill via hand-labeled rules over existing plans.
2. Add `bandit_decisions` table (logging only, no policy yet).
3. Modify generate-plan to label each candidate plan with an archetype.
4. Log every MMR decision to `bandit_decisions` with a synthetic "MMR propensity." This is the training data for the eventual bandit.
5. Ship — still using MMR for selection; bandit infrastructure is shadow-logging.

**Why do this first:** once the bandit turns on, you need historical data to warm-start it. Without this, Phase C takes an extra month.

### Phase B — Offline bandit training (after ~1k completed dates per city)

Cost: ~1 engineer-week.

6. Build Thompson Sampling trainer (Python, ~300 LOC + library calls).
7. Train on logged decisions + observed rewards.
8. Off-policy evaluate against MMR — is estimated lift meaningful? If <10% estimated lift, debug rewards / features / archetypes before proceeding.

### Phase C — Shadow deployment (2 weeks)

Cost: ~1 engineer-week.

9. Bandit computes decisions in parallel with MMR.
10. MMR decision is shown to user; bandit decision is logged only.
11. Compare distributions — does the bandit want to show systematically different things?
12. Spot-check bandit decisions manually — do they look reasonable?

### Phase D — A/B test (4+ weeks)

Cost: ~0.5 engineer-week to wire the flag; observation period.

13. Feature flag 50/50: generate-plan calls bandit for half of generations, MMR for the other half.
14. Monitor primary metric (match rate) and guardrails.
15. At 4 weeks: if bandit wins on match rate by >10% with guardrails intact, ramp to 100%.

### Phase E — Ongoing

16. Nightly retraining.
17. Weekly archetype review (are new archetypes needed? deprecated ones?).
18. Quarterly OPE audit.
19. Y2: graduate to neural contextual bandits if volume + feature complexity justifies.

**Total time from decision-to-deploy: ~8–10 weeks** assuming Phase A lands during Phase 3 instrumentation and Phase D lines up with Phase 7 launch (dating layer).

---

## 12. What v2 architecture needs to add

Concrete deltas to the v2 design spec:

| Change | Where | Phase |
|---|---|---|
| Add `archetype` enum column to `itineraries` | schema | Phase 2 |
| Define 5–8 starter archetypes; document in `packages/types` | code | Phase 2 |
| Add `bandit_decisions`, `bandit_arm_state`, `bandit_user_state` tables | schema | Phase 3 |
| Log MMR decisions to `bandit_decisions` (shadow) | edge fn | Phase 2 |
| Add `attribute_bandit_reward` Inngest workflow triggered by swipe/match/rating events | workflows | Phase 3 |
| Add `retrain_bandit` nightly Inngest cron | workflows | Phase 3 (no-op until Phase 7) |
| Add `/admin/bandit` dashboard for per-city convergence + selection distribution | admin | Phase 4 |
| Define per-archetype exposure floor in `scoring.ts` | code | Phase 2 |
| Specify feature encoder + embedding PCA for bandit context | code | Phase 3 |
| Add bandit OPE suite as pre-deploy check | CI | Phase 7 |
| Update Key Invariants with a new #18: "Bandit decisions are logged with propensity" | doc | Phase 2 |

None of this requires new infrastructure categories. All of it slots into existing Postgres + Inngest + edge-function architecture.

---

## 13. Bottom line

MMR is a reasonable V1. The V2 is a contextual bandit because:

1. **The problem is literally a contextual bandit.** Sequential decisions, context-dependent rewards, unknown reward function, exploration-exploitation tradeoff. Not a hypothetical framing — it's the mathematical definition of the task.
2. **The data flywheel already produces the exact signal a bandit needs.** `match_ratings` is the reward function. You're generating this data anyway. Not wiring it into a policy is leaving the flywheel's output on the floor.
3. **The expected lift is large (20–40% on match rate) and directly translates to the only metrics that matter** — completion rate, rating distribution, retention.
4. **The implementation is small** — ~1–2 weeks of engineering once there's enough data, no new infrastructure, contained to the existing pipeline.
5. **It scales with data.** MMR plateaus at "reasonable diversity." A bandit keeps improving as data accumulates. Over 2 years, the gap compounds.

**Sequencing recommendation:** Phase A (instrumentation) during Phase 2 of the architecture rollout. Phase B (offline training) once Kelowna has 1k+ completed dates — probably Month 6–8. Phase D (A/B deploy) when Phase 7 (match engine) launches at Month 8–10.

The single most important preliminary: **ship archetype labeling and decision logging now.** Every week of delay is a week of MMR-only data that the eventual bandit can't use for warm-start. This is ~2 days of engineering that compounds for months.

---

## Appendix — Concrete archetype starter set

For Kelowna launch. Refine based on actual data.

```ts
type Archetype =
  | 'crowd_pleaser'     // dinner → dessert. safe, high completion.
  | 'drinks_led'        // bar → dinner → nightcap. energetic.
  | 'activity_first'    // shared experience → dinner. conversation-priming.
  | 'adventurous'       // novel venue, unusual combo. high variance.
  | 'low_key'           // single venue, no rush. often right for second dates.
  | 'daytime'           // coffee/brunch → walk → lunch.
  | 'cultural'          // gallery/live music → dinner. signals thoughtfulness.
  | 'outdoorsy'         // hike/beach/patio. season-gated.

const ARCHETYPE_SELECTION_RULES: Record<ArcType, Archetype> = {
  'dinner_dessert':     'crowd_pleaser',
  'drinks_dinner_cap':  'drinks_led',
  'activity_dinner':    'activity_first',
  'daytime_arc':        'daytime',
  'single_venue':       'low_key',
  'gallery_dinner':     'cultural',
  'outdoor_dinner':     'outdoorsy',
  // 'adventurous' is assigned post-hoc: any plan whose venues sit in
  // the bottom quartile of "times previously selected" earns the tag.
};
```

The `adventurous` tag is intentionally post-hoc — it's a meta-tag, not a generator output. This lets the bandit learn "which users reward being shown unfamiliar things" independent of arc structure.
