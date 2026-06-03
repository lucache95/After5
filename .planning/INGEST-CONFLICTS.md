## Conflict Detection Report

> Generated 2026-06-03 by gsd-doc-synthesizer (MODE: merge) over the 4-doc ingest
> set. Precedence: ADR > SPEC > PRD > DOC, with the LIVE-NAV-VERIFY DOC at per-doc
> precedence 0 (highest) on the points it walked. No ADR-typed docs were ingested,
> so there are no LOCKED-vs-LOCKED contradictions to gate on. Cross-ref cycle
> detection ran clean (single edge LIVE-NAV-VERIFY → MVP-AUDIT; no cycle). No
> UNKNOWN/low-confidence classifications. All prod-vs-local contradictions are
> resolved per the orchestrator's authoritative corrections — recorded as INFO,
> or as a single WARNING where the stakes (a possible rebuild) warrant user eyes.

### BLOCKERS (0)

No blockers. No LOCKED ADR contradictions, no contradiction of an existing locked
decision in PROJECT.md, no UNKNOWN-low-confidence docs, no cross-ref cycles.

### WARNINGS (1)

[WARNING] Door 2 (start-from-scratch) — live-verify says "hard dead-end", orchestrator says "live on prod"
  Found: docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md (DOC, precedence 0)
    classifies C12/D2 as WORSE — "start from scratch" fires a "couldn't start a
    blank one" toast because `create_blank_itinerary()` is MISSING (migration
    20260603120100 gated/unapplied on the LOCAL stack it walked).
  Found: orchestrator authoritative correction #1 + .planning/PROJECT.md Key
    Decisions — migration 20260603120100 + the generate-plan edge ARE applied/
    deployed to PROD; the dead-end is a LOCAL-ONLY artifact and Door 2 WORKS on prod.
  Impact: This is the one prod-vs-local contradiction with rebuild stakes. If the
    roadmapper trusts the live-verify literally, it could queue a rebuild of an
    already-shipped RPC + sequence a blank-itinerary migration ahead of the E11
    canvas work — wasted, possibly conflicting, effort. Synthesis recorded both and
    sided with the orchestrator (Door 2 = re-check, do NOT rebuild) per precedence-0
    being scoped to LOCAL findings.
  → RE-CHECK Door 2 + `create_blank_itinerary` + typed-city against PROD before any
    E11 build; do NOT rebuild the blank-itinerary RPC. Confirm the prod migration
    state, then close this warning. (See decisions.md D8, requirements.md REQ-creator-controls E11.)

### INFO (4)

[INFO] Auto-resolved: DOC(precedence 0) > SPEC on the points LIVE-NAV-VERIFY walked
  Note: docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md was assigned per-doc
    precedence 0 deliberately (most recent live-tested verification). On the
    specific Section C/D items it CONFIRMED/WORSE/NOT_REPRO, its verdicts override
    the static docs/superpowers/reports/2026-06-03-MVP-AUDIT.md (SPEC, precedence 1).
    Recorded in requirements.md per E-item as verify-notes. UNREACHED items
    (C2/C3/C5/C6/C9/D13/D16) remain MVP-AUDIT assertions, not overridden — flagged
    "confirm in code" (context.md). No data lost; both sources preserved.

[INFO] Auto-resolved: missing-RPC reconciliation (live-verify vs orchestrator correction #2)
  Note: LIVE-NAV-VERIFY new-issue #4 lists FOUR RPCs absent from the running (local)
    DB: `create_blank_itinerary`, `reject_candidate`, `update_night`, `cancel_night`.
    Orchestrator correction #2 narrows this for PROD: only `reject_candidate`,
    `update_night`, `cancel_night` are genuinely absent on prod (E12/E7/E6 = real
    build work); `create_blank_itinerary` IS applied on prod (see WARNING above).
    Synthesis adopts the orchestrator's prod-accurate list. (decisions.md D9.)

[INFO] Auto-resolved: C10 `/account`→`/plan/i/` dead link — NOT_REPRO, re-scoped
  Note: LIVE-NAV-VERIFY C10 came back NOT_REPRO for the dating flow (the `/plan/i/`
    anchor only manifests for slug-less saved legacy planner plans). The MVP-AUDIT
    queued the fix under P0/E2 nav. Synthesis re-scopes it OUT of E2 and INTO the
    legacy-planner cleanup (requirements.md F11 note). E2 retains only the
    profile/dates tab repoint. Lower-precedence audit framing yields to the
    higher-precedence live verdict.

[INFO] Brand-serif regressions vs "brand sweep shipped"
  Note: LIVE-NAV-VERIFY new-issue #5 found residual legacy-Fraunces serif on
    `/create` PolaroidLoader, `/login` wordmark + heading, `/about` + `/tell-us`
    headings, while .planning/PROJECT.md Validated + orchestrator correction #3 list
    the brand sweep as shipped & live. Not a true contradiction: the sweep shipped;
    these are residual follow-up spots, NOT a re-queue of the whole sweep. Logged as
    a follow-up touch-up (context.md), not an E-item. Low stakes — no gate.
