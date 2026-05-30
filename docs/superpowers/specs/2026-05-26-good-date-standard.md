# The After5 Good Date Standard

> **Status:** Draft v1.1 — research-backed + refined after external review. Scoring model, locale calibration, and a semantic-incompatibility taxonomy added; open questions resolved into decisions (§5).
> **Purpose:** One explicit definition of "a great After5 date." It is the single source of truth feeding three things:
> 1. **The eval** — deterministic rule checks + LLM-as-judge rubric that score generated dates.
> 2. **The generation prompt** — `generate-plan` should generate *toward* this standard (and the selection/template layer should compose toward it).
> 3. **Insider/curator guidelines** — what humans are told "good" looks like.
>
> Synthesized from four parallel research lanes (date-experience psychology, scroll-stopping aesthetics, practitioner date-planning heuristics, curation/itinerary craft). Sources at the bottom.

---

## 0. The convergent core (what all four lanes independently agreed on)

When four separate research angles land on the same ideas, those are the load-bearing principles. A great date is:

1. **An arc, not a list.** Warm-up → one clear peak → a warm, slightly-elevated ending. (Psychology: peak–end rule + gradual escalation. Heuristics: "end on a high note." Curation: "energy blocks," anchor + soft landing.)
2. **Built on contrast.** Each stop is a *different kind* of experience; sameness (pub→bar, two meals, three wineries) flattens it. (All four lanes.)
3. **Organized around one idea / one feeling.** Not three good places stapled together — a single coherent vibe. (Aesthetics: cohesion = "premium/saveable." Curation: "a point of view; curation is subtraction.")
4. **Specific and sensory.** Concrete named details ("the smoked-trout starter," "the unmarked back patio") prove real taste and stop the scroll; generic praise reads as a bot. (Aesthetics + curation.)
5. **Anchored by one signature moment.** A single standout the night is built around — the sunset, the view, the one shared thing — because memory is dominated by the peak. (Psychology + curation.)

Everything below is an operationalization of these five.

---

## 1. The Standard — dimensions

Each dimension lists: what it means · how we measure it (🔧 deterministic rule / ⚖️ judge / 🎨 visual-curation track / ✍️ prompt guidance) · good vs bad.

### A. The Arc — energy & structure
The date has a felt shape: a low-stakes, conversation-friendly **warm-up**, a **peak** in the middle/late, and a **warm ending** — never trailing off at its lowest energy.
- 🔧 Opener is not a conversation-killer (no movie / loud club / high-formality dinner as stop 1, esp. early dates). 🔧 Final stop is not the lowest-energy/errand-y category. 🔧 Exactly one identifiable "peak" stop exists.
- ⚖️ "Does it build, and end warm — or does it peak immediately / fizzle?"
- ✍️ Prompt: instruct the writer (and ideally templates) to sequence warm-up → peak → soft landing.
- ✅ Lakeside patio drink → vineyard tasting at golden hour (peak) → gelato by the water at sunset. ❌ Movie → loud bar → late greasy diner.

### B. Contrast & variety — no monotony
Adjacent stops must change the *experience category*, not just the venue.
- 🔧 **Category-variety rule** (see §2 map): no two adjacent stops from the same category. 🔧 Eat before late drinking. 🔧 No two sit-down meals in one date.
- ⚖️ "Does each stop feel distinct — does the vibe/energy/sensory mode actually change?"
- ✅ activity → food → view. ❌ pub → cocktail bar (both *Drinking*); café → dessert café (both *Sweet/cozy*).

### C. One coherent vibe — the Pinterest-board test
The whole date reads as a single organizing feeling, and text + imagery share that mood.
- ⚖️ "Is this one cute idea, or three good places stapled together? One mood, or a grab-bag?"
- 🎨 Visual track: lead image + stop images share light/palette (warm, locale-appropriate tones); 3–4 colors max → reads premium/saveable. *(Driven by the photo pipeline + feed card, not the LLM.)*
- ✍️ Prompt: give each generated date a one-line "organizing idea" and make `why_it_works` express it.
- ✅ "Golden-hour lakeside wind-down." ❌ A fancy dinner + an arcade + a quiet wine bar — three moods, no through-line.

### D. Scroll-stopping front door
In the feed, title + hook + lead image must stop the scroll in ~2 seconds: concrete + sensory + a small curiosity beat — without clickbait or over-specifying.
- 🔧 Existing rules apply: title ≤ 8 words, no banned/generic words ("perfect/amazing/magical"), no emoji, no time-of-day words in titles. 🔧 Title contains a concrete noun (real place/sensory thing), not only adjectives.
- ⚖️ "Would this stop your scroll? Concrete + intriguing vs vague?"
- ✅ "Sunset wine, then the bakery nobody knows about." ❌ "A Lovely Evening Out."

### E. Taste & specificity — curated, not algorithmic
Concrete, named, sensory detail per stop; an insider/hidden-gem feeling; "a local with great taste," not a brochure.
- 🔧 Every stop's `what_to_do` references its place name (grounding) and is not the deterministic fallback. 🔧 Heuristic: names at least one specific concrete thing (a dish/drink/spot/sensory detail).
- ⚖️ "Specificity & sensory detail; does it feel like insider knowledge or generic praise?"
- ✅ "Share the canelé and a flat white; grab the window counter for the morning light." ❌ "Enjoy great coffee in a nice atmosphere."

### F. A moment worth wanting — emotional payoff / desirability (THE HEADLINE)
One clear standout moment built around a feeling, that makes you imagine living the night *with someone*. Aspirational but feasible ("a Tuesday you'd actually do," not fantasy).
- ⚖️ **Desirability (weighted highest, but kept honest — see §2):** "Is there a clear peak moment, and does this make you want to live this night with someone?"
- ✍️ Prompt: name the "moment" the night is built around.
- ✅ "…as the light goes amber over the lake." ❌ A competent plan with no moment you'd remember.
- ⚠️ Pure desirability drifts toward aesthetic bait / expensive fantasy, so it is **not** the score by itself — it's the top weight in a composite that arc + coherence keep grounded (§2).

### I. Locale calibration — city-aware (App serves any US/Canada city)
The §0 core (arc, contrast, coherence, specificity, signature moment) is **universal across cities**. What changes per city is the *flavor* of the peak and of "local specificity": the date must feel **authentic to its city**, never generic or out-of-place. The judge is given the city and rewards what genuinely fits there.
- ⚖️/✍️ Favor the standout moment that fits THIS place: a lake sunset / vineyard golden-hour in Kelowna; a hidden rooftop, speakeasy, or skyline moment in a dense city; a beach or trailhead where that's the local signature. Down-weight generic, tourist-default, or out-of-place moments.
- The "effortlessly cinematic, not aggressively optimized" instinct is a *Kelowna* expression of the universal "one signature moment + local specificity" rule — other cities express it differently (urban novelty *is* the local signature in some places).
- ✅ (Kelowna) "Vineyard at golden hour → hidden tasting room → lakefront nightcap." ✅ (dense city) "Sidecar at the unmarked speakeasy → the dumpling spot locals queue for → skyline rooftop." ❌ (anywhere) a sequence of tourist-default picks with no local point of view.
- **Implementation:** the eval `EvalCase` carries a `city`; the judge prompt is parameterized by it. Rules (categories, budget, copy) are city-neutral.

### G. Logistics that make sense — thoughtfulness signals
A real plan a thoughtful person made: tight/walkable, sane travel, respects hours/time-of-day/season, realistic budget, not over-scheduled, light-led timing.
- 🔧 Travel between stops within tolerance (flag long hops/backtracking). 🔧 Budget realism (existing `cost_realism`). 🔧 Stop count capped ~2–3. 🔧 Time-of-day ordering (no sunset spot at 2pm). 🔧 Next stop is open at expected arrival. 🔧 If a sunset/viewpoint exists, it lands in the golden-hour window.
- ✅ Three walkable stops in one district, sunset stop timed to sunset. ❌ Four crammed stops with 25-min drives between each.

### H. First-date calibration (CONTEXT MODIFIER, not a fixed rule)
For early/lower-intimacy contexts (After5 `intent`/`occasion`), tighten: lower stakes, conversation-first, an activity icebreaker, shorter total (~2–3 hrs), low-pressure pricing on stop 1. These **relax** for reconnect/established contexts (a long dinner or a loud show is fine later).
- 🔧 Apply B–G more strictly when context = early/impress; loosen duration/opener rules otherwise.

---

## 2. Scoring model — gates × gradient

The score is **not** a flat weighted sum. Hard constraints **gate** (cap) the score; the judge dimensions provide the **gradient** among dates that clear the gates.

**Gates (a violation caps the headline, e.g. ≤ 40/100):**
- Copy hard-rules (banned words, emoji, title length, empty/ungrounded `what_to_do`).
- Logistics validity (next stop open at arrival, drive time within tolerance, sane time-of-day order, realistic budget).
- Contrast (no two same-category adjacent — §3).

> Why gates, not weights: a date whose 2nd venue is closed when you arrive isn't "90% good," it's broken. Logistics earns no partial credit; it qualifies you to be scored at all.

**Gradient (judge composite, for dates that pass the gates):**
```
headline = 0.35·desirability   (F)
         + 0.25·arc            (A)
         + 0.20·vibe_coherence (C)
         + 0.10·taste/specificity (E)
         + 0.10·scroll_stopping_hook (D)
```
This is ChatGPT-review's weighting with logistics moved to a gate; desirability leads but arc + coherence keep it from drifting into pretty-but-pointless.

> **These weights are a prior, not gospel.** The eval's deeper job: once it runs against real `save_rate` / `feedback`, **re-fit the weights to what actually predicts saved/locked dates.** We commit to the standard, then let data correct it — otherwise it's just a confident guess.

## 3. The category map + incompatibility taxonomy

Group `places.type` by *experience category*, then forbid same-category adjacency (and over-use):

| Category | `places.type` values |
|---|---|
| 🍸 Drinking | brewery, cocktail_bar, winery, (pub) |
| 🍽 Food | restaurant |
| 🍰 Sweet/cozy | cafe, dessert, ice_cream, bakery |
| 🌅 Outdoor | hike, viewpoint, beach, park, garden, sunset_spot, walk |
| 🎨 Culture | gallery, market, shop |
| 🎯 Activity | activity |

This **extends** the engine's existing "no two bars/cafes back-to-back" adjacency fix (`generate-plan/index.ts`) into a semantic-category rule (so pub→cocktail_bar fails even though the `type` values differ).

**Semantic-incompatibility taxonomy** (the richer version of "doesn't make sense" — judge frame + cheap deterministic rules where possible):
- **Energy clash** — calm → high-intensity with no bridge (meditation tea house → nightclub; wine bar → trampoline park).
- **Redundant emotional beats** — two "sit & talk," two high-volume, or two "spectacle" stops in a row.
- **Logistical incoherence** — repeated city-crossing, excessive transit hops, weather/season mismatch.
- **Social-pacing failure** — peak too early, dead middle, or no decompression after a high-stimulation stop.
- **Vulnerability sequencing** — too intimate / too performative too fast for the date's context.

> ⚠️ **Build-cost honesty:** energy-clash, peak-placement, and vulnerability-sequencing rules need a per-venue **energy** and **intimacy** score the `places` table doesn't have (it has `vibe_tags` like chill/romantic/boujee, which only *approximate* energy). **v1:** approximate energy/intimacy from `vibe_tags` + category and let the **judge** catch the rest. Add dedicated `energy`/`intimacy` columns **only if** v1 eval data shows these rules move outcomes — don't build the metadata layer speculatively (YAGNI).

---

## 4. How it plugs into After5 (the three consumers)

**1. Eval (the immediate build):**
- **Rule-check layer** (`packages/business/src/date-eval/rules.ts`, vitest-tested, pure): all 🔧 items — category variety, arc gates, logistics, copy hard-rules. Pass/fail, free, instant. Acts as gates/penalties on the composite score.
- **Judge layer** (`generate-plan/eval/judge.ts`): all ⚖️ dimensions scored 1–5, framed as *"score this the way a person with great taste who actually plans thoughtful dates would — would they be proud to send it to someone they liked?"* Desirability weighted highest.

**2. Generation prompt / selection:** the ✍️ items become prompt instructions, and the structural ones (arc, contrast, signature moment, light-led timing) should ideally shape **selection/templates**, not just be graded after the fact. The standard is what the engine generates *toward*.

**3. Visual-curation track (separate lane):** the 🎨 items live with the **photo pipeline** (`classify-photos.mjs` already scores photos 1–5) + the feed card design. The eval does **not** judge photo beauty — but the standard names it so it isn't forgotten.

**4. Dashboard upgrade (later):** the composite score can replace the selection-only `quality_score` shown on `/admin/eval`, giving a real copy/holistic quality number.

---

## 5. Decisions (resolved after review)
1. **Weighting →** composite gates × gradient (§2), desirability-led but grounded by arc + coherence. Weights are a **prior to be re-fit against real save/feedback data.**
2. **First-date calibration →** yes, **context-modulated** via `intent`/`occasion` (§1.H): early/impress optimizes safety, optionality, low-pressure exits, conversation, *moderate* novelty; reconnect/established allows immersion, intensity, duration, adventure.
3. **Kelowna →** "effortlessly cinematic," scenic/golden-hour peak over urban novelty (§1.I).
4. **More "doesn't-make-sense" rules →** the semantic-incompatibility taxonomy (§3), built lean (judge + cheap deterministic rules; richer rules gated on data).

### Still open / to validate empirically
- The exact weight numbers (re-fit from data).
- Whether dedicated venue `energy`/`intimacy` columns are worth adding (gate on v1 eval signal).
- Lucas's own Kelowna taste edits beyond the locale note above.

---

## Sources

**Date-experience psychology:** [Self-expansion & novel/arousing activities (Aron)](https://journals.sagepub.com/doi/10.1177/02654075221110630) · [Misattribution of arousal (Dutton & Aron, 1974)](https://en.wikipedia.org/wiki/Misattribution_of_arousal) · [Peak–end rule (Decision Lab)](https://thedecisionlab.com/biases/peak-end-rule) · [Optimal-level-of-stimulation (Berlyne)](https://www.sciencedirect.com/science/article/pii/S0273229722000417) · [Why dinner-and-a-movie is a poor first date](https://theartofcharm.com/art-of-dating/dinner-movie-make-poor-first-date/)

**Scroll-stopping aesthetics:** [Premium color palettes](https://colorhero.io/blog/what-makes-color-palette-feel-premium) · [Pinterest curation/algorithm](https://www.outfy.com/blog/pinterest-algorithm/) · [Focal points & hierarchy (Smashing)](https://www.smashingmagazine.com/2015/02/design-principles-dominance-focal-points-hierarchy/) · [Thumb-stop rate](https://tigertracks.ai/insights/beyond-the-scroll-understanding-and-influencing-thumb-stop-rate-across-all-ad-formats/) · [When curiosity gaps backfire (Nature)](https://www.nature.com/articles/s41598-024-81575-9) · [Curiosity-driven hooks & specificity](https://www.avisostudios.com/blog/capture-audience-attention-with-curiosity-driven-marketing-hooks)

**Practitioner heuristics:** [Art of Charm — first date ideas](https://theartofcharm.com/art-of-dating/first-date-ideas/) · [Rules of drinking on a first date](https://www.insidehook.com/advice/the-rules-of-drinking-on-a-first-date) · [Dinner vs drinks (Cup of Jo)](https://cupofjo.com/2015/08/13/first-date-dinner-vs-drinks/) · [15 first-date tips (Ramsey)](https://www.ramseysolutions.com/relationships/first-date-tips) · [Walking-date guide](https://grass.camp/en-US/blog/walking-date-routes-low-pressure-outdoor-dating)

**Curation & itinerary craft:** [Anchor/contrast/pacing of a city day](https://www.momentslog.com/travel/how-to-build-a-flexible-museum-and-cafe-day-that-makes-any-city-feel-understandable) · [Writing specific, opinionated recs (Infatuation)](https://www.theinfatuation.com/all/features/how-to-pitch-the-infatuation) · [Atlas Obscura curation philosophy](https://www.atlasobscura.com/faq) · [Curation as subtraction (Bhaskar)](https://www.goodreads.com/book/show/30512491-curation) · [Sunset/golden-hour itinerary sequencing](https://showmeseattle.com/2025/08/15/west-seattle-sunset-itinerary-how-to-spend-the-perfect-afternoon-on-alki-beach/)
