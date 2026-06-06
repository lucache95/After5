# Playwright authed browser flow + UX/nav audit recipe

How Claude drives a browser to audit After5's UX, navigation, and functionality.

## Two modes — and which works here

| Mode | Tool | Works in this env? |
|------|------|--------------------|
| **Interactive** (navigate→snapshot→click→read console/network, live, watched) | Playwright **MCP** (`mcp__playwright__browser_*`) | **NO** — the MCP Chromium is network-isolated in After5 sessions; it cannot reach `localhost:3000` OR public URLs. (It works in projects like Surkle where the MCP server has host network access.) |
| **Scripted batch** (a spec walks routes, captures screenshots + console + network, Claude reviews the output) | `@playwright/test` via `CI=1 npx playwright test` | **YES** — `playwright.config.ts`'s `webServer` boots its own Next server in-process. This is the recipe used for v1.0/Phase-7 visual captures. |

**So in this environment the audit is the scripted-batch form:** a collector spec captures the evidence, Claude reviews the screenshots + console/network logs + nav-affordance probes and judges the findings. Same evidence as the interactive loop, just batch not live. If a future env gives the MCP browser network access, prefer the interactive loop for exploratory hunting.

## Auth (After5 = local PKCE via Mailpit, NOT a prod password)

After5 has no `SMOKE_OWNER` password. The authed-session recipe (see `apps/web/e2e/_helpers/auth.ts`, `loginAs`):
1. `page.goto('/login')` → submit the email → this sets the PKCE verifier cookie + Supabase mails a magic link.
2. Fetch the link from **Mailpit** (`http://127.0.0.1:54324`, the local Supabase mail catcher) — match `…/auth/v1/verify?token=pkce_…&type=magiclink`.
3. `page.goto(verifyUrl)` → the session is established. QA acct: `lucache95@gmail.com` (see `reference_local-qa-browser-login`).

The local Supabase stack must be up (`supabase status`; Mailpit at :54324). Run with `CI=1` so Playwright owns the dev server (don't also run `pnpm dev` — port collision).

## The audit (UX-01) — per-route checklist

For every route, @420px (`page.setViewportSize({width:420,height:900})`):
- screenshot → `docs/superpowers/audits/screenshots/<date>-<route-slug>.png`
- console errors (`page.on('console', m => m.type()==='error')`)
- failed network (`page.on('response', r => r.status()>=400)`)
- nav-affordance probe: deep route has a working back/up control? (the v1.0 `DeepRouteHeader` primitive)
- judged by Claude: layout/overflow · broken/flashing images · dead/no-op buttons · broken nav/traps/missing-back · @420px parity · a11y · brand/DESIGN-SYSTEM drift

## Evidence + findings
- Screenshots → `docs/superpowers/audits/screenshots/`.
- Findings markdown (bug · route/URL · repro · screenshot · severity) → the phase's audit doc, so UX-02 remediation is grounded in what the app actually does.
