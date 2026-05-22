# After5 Sprint: Polish + Insiders + Eval + Photos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dates feel curated (not algorithmic), launch an Insiders contributor program, build a quality evaluation dashboard, and get photo coverage to 95%.

**Architecture:** Four independent workstreams that can execute in parallel. Workstream 1 touches the plan wizard and output components. Workstream 2 builds new pages/tables for the Insiders program. Workstream 3 adds an admin analytics page. Workstream 4 runs existing scripts. Shared touchpoints: admin layout nav (WS2 + WS3), database.ts types (WS2 + WS3).

**Tech Stack:** Next.js 15, React 19, Supabase (Postgres + Auth + Storage), Tailwind CSS, Resend (email), TypeScript.

---

## File Map

### Workstream 1: Surprise Me + Output Polish
- Modify: `apps/web/app/page.tsx` (add Surprise Me CTA)
- Modify: `apps/web/app/plan/page.tsx` (handle `?surprise=true` query param, skip to loading)
- Modify: `apps/web/components/itinerary/ChooserCards.tsx` (add differentiation subtitles, surface why_it_works)
- Modify: `supabase/functions/generate-plan/prompt.ts` (add card_label to LLM output schema)
- Modify: `supabase/functions/generate-plan/index.ts` (retry on empty what_to_do, compute card labels)

### Workstream 2: After5 Insiders Program
- Create: `supabase/migrations/20260522160000_insiders_program.sql`
- Create: `apps/web/app/join/page.tsx` (public application page)
- Create: `apps/web/app/join/JoinForm.tsx` (client form component)
- Create: `apps/web/app/insiders/page.tsx` (contributor dashboard)
- Create: `apps/web/app/insiders/InsidersDashboard.tsx` (client dashboard component)
- Create: `apps/web/app/admin/insiders/page.tsx` (admin approval queue)
- Create: `apps/web/app/admin/insiders/insiders-admin.tsx` (client admin component)
- Create: `apps/web/app/api/insiders/apply/route.ts` (application submission)
- Create: `apps/web/app/api/admin/insiders/route.ts` (approve/reject/assign tasks)
- Create: `apps/web/lib/email/insider-welcome.ts` (approval email template)
- Modify: `apps/web/app/admin/layout.tsx` (add "Insiders" nav item)
- Modify: `packages/types/src/database.ts` (add insider types)

### Workstream 3: Evaluation Dashboard
- Create: `apps/web/app/admin/eval/page.tsx` (server component, data fetching)
- Create: `apps/web/app/admin/eval/eval-dashboard.tsx` (client dashboard with charts)
- Create: `apps/web/app/api/admin/eval/route.ts` (aggregation queries)
- Modify: `apps/web/app/admin/layout.tsx` (add "Eval" nav item)

### Workstream 4: Photo Backfill
- No new files — run existing scripts, verify results

---

## Workstream 1: Surprise Me + Output Polish

### Task 1.1: "Surprise Me" Button on Landing Page

**Files:**
- Modify: `apps/web/app/page.tsx:147-153` (hero CTA section)
- Modify: `apps/web/app/plan/page.tsx:79-106,330-420` (inputs + phase logic)

- [ ] **Step 1: Add Surprise Me link to hero section**

In `apps/web/app/page.tsx`, after the existing "Plan my date" button (line ~153), add a second CTA:

```tsx
<Link
  href="/plan?surprise=true"
  className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-6 py-3 font-display text-sm tracking-wide text-text transition-colors hover:bg-cream"
>
  Surprise me
</Link>
```

- [ ] **Step 2: Handle `?surprise=true` in plan page**

In `apps/web/app/plan/page.tsx`, read the query param on mount. When `surprise=true`:
- Set inputs to smart defaults: `{ occasion: 'date', duration_min: 150, budget_per_person: 50, vibe: ['romantic'], must_includes: [], drive_tolerance_min: 20, max_radius_km: 30, location: 'out', effort: 'low', when: 'tonight', time_of_day: 'evening', intent: '' }`
- Skip directly to `phase: 'loading'` and call `generate()` immediately
- Add a `useEffect` that checks `searchParams.get('surprise')` and triggers generation

```tsx
useEffect(() => {
  if (searchParams.get('surprise') === 'true' && phase === 'inputs') {
    const surpriseDefaults = {
      occasion: 'date' as const, duration_min: 150, budget_per_person: 50,
      vibe: ['romantic'], must_includes: [], drive_tolerance_min: 20,
      max_radius_km: 30, location: 'out' as const, effort: 'low' as const,
      when: 'tonight' as const, time_of_day: 'evening' as const, intent: '' as const,
      you_pronouns: '' as const, partner_pronouns: '' as const, note: '',
      future_date: '',
    };
    setInputs(surpriseDefaults);
    setPhase('loading');
    generate(surpriseDefaults);
  }
}, [searchParams]);
```

- [ ] **Step 3: Test the flow**

Navigate to `/plan?surprise=true` — should skip directly to the loading animation and return 3 dates with no wizard interaction.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/plan/page.tsx
git commit -m "feat: add Surprise Me instant generation button on hero"
```

### Task 1.2: Card Differentiation Labels

**Files:**
- Modify: `apps/web/components/itinerary/ChooserCards.tsx:12-83`
- Modify: `apps/web/app/plan/page.tsx` (compute labels before passing to ChooserCards)

- [ ] **Step 1: Compute differentiation labels**

In the plan page results phase, after itineraries are received, compute a label for each:

```tsx
function computeCardLabels(itineraries: Itinerary[]): string[] {
  if (itineraries.length < 2) return itineraries.map(() => '');
  const sorted = itineraries.map((it, i) => ({ i, cost: it.total_cost_pp, dur: it.total_duration_min }));
  const labels = new Array(itineraries.length).fill('');
  
  const cheapest = sorted.reduce((a, b) => a.cost < b.cost ? a : b);
  const longest = sorted.reduce((a, b) => a.dur > b.dur ? a : b);
  const quickest = sorted.reduce((a, b) => a.dur < b.dur ? a : b);
  
  labels[longest.i] = 'Most ambitious';
  labels[cheapest.i] = cheapest.i !== longest.i ? 'Best value' : '';
  labels[quickest.i] = labels[quickest.i] === '' ? 'Quickest' : labels[quickest.i];
  
  // Fill any remaining empty label
  labels.forEach((l, i) => { if (!l) labels[i] = 'Our pick'; });
  return labels;
}
```

- [ ] **Step 2: Pass labels to ChooserCards**

Add `labels` prop to ChooserCards. Update the component to accept and render them.

- [ ] **Step 3: Update ChooserCards to show labels + why_it_works**

In `ChooserCards.tsx`, replace the generic "Custom built for you" with the differentiation label. Add a truncated `why_it_works` preview (first sentence, max 80 chars):

```tsx
interface Props {
  itineraries: Itinerary[];
  activeIdx: number;
  onPick: (i: number) => void;
  labels?: string[];
}

// In the card render, replace the eyebrow:
<span className="font-display text-xs uppercase tracking-widest text-accent">
  {labels?.[i] || 'Custom built for you'}
</span>

// Add why_it_works preview after the title:
{it.why_it_works && (
  <p className="mt-1 line-clamp-2 text-xs text-muted">
    {it.why_it_works}
  </p>
)}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/itinerary/ChooserCards.tsx apps/web/app/plan/page.tsx
git commit -m "feat: add differentiation labels and why_it_works to chooser cards"
```

### Task 1.3: Fix Empty what_to_do Fallback

**Files:**
- Modify: `supabase/functions/generate-plan/prompt.ts` (retry logic)
- Modify: `supabase/functions/generate-plan/index.ts` (alerting)

- [ ] **Step 1: Add retry on empty what_to_do**

In `prompt.ts`, after parsing the LLM response, check if any stop has empty what_to_do. If so, retry the writing pass once with a stronger instruction:

```typescript
// After the initial writeItineraries call, check completeness
const hasEmptyStops = written.some(it => 
  it.stops.some(s => !s.what_to_do || s.what_to_do.trim().length < 10)
);

if (hasEmptyStops && !isRetry) {
  console.warn('[prompt] Empty what_to_do detected, retrying writing pass');
  return writeItineraries(apiKey, model, input, true); // isRetry flag prevents infinite loop
}
```

- [ ] **Step 2: Add deterministic fallback for still-empty stops**

For any stop that STILL has empty what_to_do after retry, generate a deterministic fallback from the place data:

```typescript
stops: it.stops.map((s, i) => {
  const what = byIndex?.what_to_do || byId?.what_to_do || '';
  if (!what || what.trim().length < 10) {
    const place = input.placesById.get(s.place_id);
    const fallback = place
      ? `Head to ${place.name} in ${place.neighborhood}. ${place.local_insight || `A solid ${place.type} spot worth checking out.`}`
      : `Check out this stop — a local favourite.`;
    return { ...s, what_to_do: fallback };
  }
  return { ...s, what_to_do: what };
}),
```

- [ ] **Step 3: Add console.error alerting**

In `index.ts`, after the writing pass, log a prominent warning if fallback was used:

```typescript
const fallbackCount = written.reduce((n, it) => 
  n + it.stops.filter(s => s.what_to_do?.startsWith('Head to ')).length, 0);
if (fallbackCount > 0) {
  console.error(`[QUALITY ALERT] ${fallbackCount} stops used deterministic fallback — LLM failed to generate what_to_do`);
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-plan/prompt.ts supabase/functions/generate-plan/index.ts
git commit -m "fix: retry and fallback for empty what_to_do — never ship blank stops"
```

---

## Workstream 2: After5 Insiders Program

### Task 2.1: Database Schema for Insiders

**Files:**
- Create: `supabase/migrations/20260522160000_insiders_program.sql`
- Modify: `packages/types/src/database.ts`

- [ ] **Step 1: Create migration**

```sql
-- Insider applications and approved contributors
create table insider_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  first_name text not null,
  instagram text,
  motivation text not null,
  best_date_spot text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id),
  notes text
);

create index idx_insider_apps_status on insider_applications(status);
alter table insider_applications enable row level security;

-- Approved insiders get a role on their profile
alter table profiles add column if not exists insider_role text check (
  insider_role in ('scout', 'tester', 'curator', 'ambassador')
);
alter table profiles add column if not exists insider_points int not null default 0;
alter table profiles add column if not exists insider_approved_at timestamptz;

-- Task assignments for insiders
create table insider_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  assigned_to uuid references profiles(id),
  task_type text not null check (task_type in ('visit_venue', 'rate_date', 'improve_copy', 'business_outreach', 'take_photo')),
  title text not null,
  description text,
  venue_id uuid references places(id),
  itinerary_id uuid references itineraries(id),
  points_reward int not null default 10,
  status text not null default 'open' check (status in ('open', 'assigned', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  submission_notes text,
  submission_photo_url text,
  completed_at timestamptz
);

create index idx_insider_tasks_assignee on insider_tasks(assigned_to, status);
alter table insider_tasks enable row level security;

-- RLS: insiders can see their own tasks
create policy "Users can view their own tasks"
  on insider_tasks for select
  using (assigned_to = auth.uid());

create policy "Users can update their own assigned tasks"
  on insider_tasks for update
  using (assigned_to = auth.uid() and status in ('assigned', 'submitted'));
```

- [ ] **Step 2: Add TypeScript types to database.ts**

Add `insider_applications` and `insider_tasks` table types, plus `insider_role`, `insider_points`, `insider_approved_at` to the `profiles` Row/Insert/Update types.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260522160000_insiders_program.sql packages/types/src/database.ts
git commit -m "feat: database schema for Insiders program (applications, tasks, roles)"
```

### Task 2.2: Public Join Page

**Files:**
- Create: `apps/web/app/join/page.tsx`
- Create: `apps/web/app/join/JoinForm.tsx`
- Create: `apps/web/app/api/insiders/apply/route.ts`

- [ ] **Step 1: Build the server page**

`apps/web/app/join/page.tsx` — server component with:
- Hero section: "Become an After5 Insider" headline, subtext about shaping Kelowna's best dates
- 4 role cards (Scout, Tester, Curator, Ambassador) with icons and 1-line descriptions
- "What you get" section: attribution, exclusive events, partner perks, early access
- The application form component below

- [ ] **Step 2: Build the form component**

`apps/web/app/join/JoinForm.tsx` — client component:
- Fields: first_name (required), email (required), instagram (optional), motivation textarea ("Why do you want to help?" — required, 50-500 chars), best_date_spot textarea ("What's the best date spot in Kelowna most people don't know about?" — required, 20-300 chars)
- Submit button with loading state
- Success state: "Application received! We'll be in touch within 48 hours."
- POST to `/api/insiders/apply`

- [ ] **Step 3: Build the API route**

`apps/web/app/api/insiders/apply/route.ts`:
- Validate input with Zod
- Check for duplicate email (don't allow re-application if pending/approved)
- Insert into `insider_applications`
- Return 201 on success
- Rate limit: max 3 applications per IP per day (simple in-memory)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/join/ apps/web/app/api/insiders/
git commit -m "feat: public /join page with Insiders application form"
```

### Task 2.3: Admin Approval Queue

**Files:**
- Create: `apps/web/app/admin/insiders/page.tsx`
- Create: `apps/web/app/admin/insiders/insiders-admin.tsx`
- Create: `apps/web/app/api/admin/insiders/route.ts`
- Modify: `apps/web/app/admin/layout.tsx`

- [ ] **Step 1: Add nav item to admin layout**

In `apps/web/app/admin/layout.tsx`, add "Insiders" to the nav array alongside Venues, Dates, Feedback.

- [ ] **Step 2: Build admin server page**

`apps/web/app/admin/insiders/page.tsx`:
- Fetch all applications from `insider_applications` ordered by created_at desc
- Fetch all approved insiders from `profiles` where `insider_role` is not null
- Pass both to the client dashboard

- [ ] **Step 3: Build admin client component**

`apps/web/app/admin/insiders/insiders-admin.tsx`:
- Two tabs: "Applications" (pending queue) and "Active Insiders" (approved list)
- Applications tab: cards showing name, email, Instagram link, motivation, best_date_spot answer, applied date. Approve/Reject buttons with role selector dropdown (Scout/Tester/Curator/Ambassador)
- Active Insiders tab: table showing name, role, points, tasks completed, approved date
- Approve action: PATCH to `/api/admin/insiders` with `{ application_id, action: 'approve', role }`
- Reject action: PATCH with `{ application_id, action: 'reject' }`

- [ ] **Step 4: Build admin API route**

`apps/web/app/api/admin/insiders/route.ts`:
- `requireAdmin()` guard
- PATCH handler: approve (update application status, set insider_role + insider_approved_at on profiles, send welcome email) or reject (update status)
- GET handler: return applications + active insiders with stats

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/insiders/ apps/web/app/api/admin/insiders/ apps/web/app/admin/layout.tsx
git commit -m "feat: admin Insiders approval queue with role assignment"
```

### Task 2.4: Insider Welcome Email

**Files:**
- Create: `apps/web/lib/email/insider-welcome.ts`

- [ ] **Step 1: Build the email template**

Follow the same pattern as `post-date-feedback.ts` and `welcome.ts`:
- Warm-cream branded background (#FDF9F3)
- "Welcome to the After5 Insiders" headline
- Their assigned role with description
- CTA button linking to `/insiders` dashboard
- Warm sign-off

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/email/insider-welcome.ts
git commit -m "feat: branded welcome email for approved Insiders"
```

### Task 2.5: Insider Dashboard

**Files:**
- Create: `apps/web/app/insiders/page.tsx`
- Create: `apps/web/app/insiders/InsidersDashboard.tsx`

- [ ] **Step 1: Build the server page**

`apps/web/app/insiders/page.tsx`:
- Auth-gated (redirect to /login if not authenticated)
- Check `profiles.insider_role` — if null, redirect to `/join`
- Fetch assigned tasks from `insider_tasks` for this user
- Fetch leaderboard (top 10 insiders by points)

- [ ] **Step 2: Build the dashboard client component**

`apps/web/app/insiders/InsidersDashboard.tsx`:
- Header: "Hey [name]" with role badge and points display
- "Your Tasks" section: cards for each assigned task with:
  - Task type icon, title, description, points reward
  - If venue-linked: venue name + link to venue page
  - "Mark Complete" button → opens a submission form (notes textarea + optional photo upload)
- "Leaderboard" section: top 10 insiders with name, role, points, tasks completed
- "Your Contributions" section: list of completed tasks with attribution links

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/insiders/
git commit -m "feat: Insider contributor dashboard with tasks and leaderboard"
```

---

## Workstream 3: Evaluation Dashboard

### Task 3.1: Eval Data Aggregation API

**Files:**
- Create: `apps/web/app/api/admin/eval/route.ts`

- [ ] **Step 1: Build aggregation queries**

The route computes all metrics from existing tables. No new schema needed.

```typescript
// GET /api/admin/eval?period=7d|30d|all
export async function GET(request: NextRequest) {
  await requireAdmin();
  const period = request.nextUrl.searchParams.get('period') || '7d';
  const since = periodToDate(period);
  
  // 1. Generation metrics
  const { count: totalGens } = await supabase
    .from('itineraries').select('*', { count: 'exact', head: true })
    .gte('generated_at', since);
  
  // 2. Quality scores
  const { data: qualityData } = await supabase
    .from('itineraries').select('generation_log, total_cost_pp')
    .gte('generated_at', since).limit(500);
  // Extract quality_score from generation_log->this_itinerary->quality_score
  
  // 3. Save rate
  const { count: totalSaves } = await supabase
    .from('saved_plans').select('*', { count: 'exact', head: true })
    .gte('created_at', since);
  
  // 4. Feedback scores
  const { data: feedback } = await supabase
    .from('plan_feedback').select('rating, stop_votes')
    .gte('created_at', since);
  
  // 5. Editorial pack breakdown from generation_log
  // Parse generation_log.taste.editorial_pack for each itinerary
  
  // 6. Venue frequency — which places appear most
  // Parse stops[].place_id from itineraries
  
  // 7. Worst 5 dates — lowest quality_score
  const { data: worstDates } = await supabase
    .from('itineraries').select('id, title, slug, generation_log, generated_at')
    .gte('generated_at', since)
    .order('generated_at', { ascending: false }).limit(500);
  // Sort by extracted quality_score, take bottom 5
  
  return NextResponse.json({ totalGens, saveRate, avgQuality, packBreakdown, venueFrequency, worstDates, feedback });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/admin/eval/route.ts
git commit -m "feat: evaluation metrics aggregation API"
```

### Task 3.2: Eval Dashboard UI

**Files:**
- Create: `apps/web/app/admin/eval/page.tsx`
- Create: `apps/web/app/admin/eval/eval-dashboard.tsx`
- Modify: `apps/web/app/admin/layout.tsx`

- [ ] **Step 1: Add nav item**

Add "Eval" to the admin layout nav.

- [ ] **Step 2: Build server page**

Simple page that renders the client dashboard.

- [ ] **Step 3: Build eval dashboard**

`eval-dashboard.tsx` — client component:

**Period selector:** 7d / 30d / All time tabs

**Row 1 — Key metrics (4 stat cards):**
- Total generations | Avg quality score | Save rate (%) | Feedback positivity (%)

**Row 2 — Editorial pack effectiveness:**
- Horizontal bar chart (styled divs, no library) showing each pack name + number of activations + save rate when that pack was active
- Highlight: which pack produces the best save rate

**Row 3 — Venue health:**
- Table: venue name, appearances (last period), avg feedback, times flagged
- Sort by appearances desc
- Color-code: green (positive feedback), yellow (no feedback), red (negative)

**Row 4 — Bottom 5 dates:**
- Cards showing: title, quality_score, generated_at, stop names
- Link to `/admin/dates/[id]` for each
- "Review" button

All charts are server-rendered styled divs — percentage bars using Tailwind width classes (`style={{ width: '${pct}%' }}`). No Chart.js or recharts.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/admin/eval/ apps/web/app/admin/layout.tsx
git commit -m "feat: evaluation dashboard with quality metrics, pack effectiveness, venue health"
```

---

## Workstream 4: Photo Backfill Execution

### Task 4.1: Run Photo Scripts

**Files:** No new files — execute existing scripts.

- [ ] **Step 1: Classify existing photos**

```bash
cd apps/web
node scripts/classify-photos.mjs --limit 5  # test first
node scripts/classify-photos.mjs             # run all
```

Expected: each venue with a photo gets a quality score (1-5). Low scores flagged for replacement.

- [ ] **Step 2: Backfill Google photos for venues missing them**

```bash
node scripts/backfill-google-photos.mjs --limit 5  # test
node scripts/backfill-google-photos.mjs              # run all
```

Expected: venues with Google Place IDs get the highest-quality photo selected.

- [ ] **Step 3: Generate AI covers for remaining gaps**

```bash
node scripts/generate-place-covers.mjs --limit 5  # test
node scripts/generate-place-covers.mjs              # run all
```

Expected: venues with no Google photo get a Gemini-generated editorial cover uploaded to Supabase Storage.

- [ ] **Step 4: Verify coverage**

```sql
SELECT 
  count(*) as total,
  count(photo_url) as has_google_photo,
  count(generated_photo_url) as has_ai_cover,
  count(*) - count(coalesce(photo_url, generated_photo_url)) as still_missing
FROM places WHERE is_active = true;
```

Target: `still_missing` = 0 (100% coverage between the two columns).

- [ ] **Step 5: Spot-check in browser**

Visit `/admin/venues` — verify photo column shows images for all venues. Visit 5 random `/places/[slug]` pages — verify hero images load (no broken alt text).

---

## Parallelization Guide

These workstreams are designed for parallel agent execution:

| Agent | Workstream | Touches |
|-------|-----------|---------|
| Agent 1 | WS1: Surprise Me + Polish | `page.tsx`, `plan/page.tsx`, `ChooserCards.tsx`, edge function |
| Agent 2 | WS2: Insiders Program | New `/join`, `/insiders`, `/admin/insiders` pages + migration |
| Agent 3 | WS3: Eval Dashboard | New `/admin/eval` pages + API route |
| Agent 4 | WS4: Photo Backfill | Script execution only, no code changes |

**Merge order:** WS4 first (no code conflicts), then WS1, WS2, WS3 (handle admin layout.tsx conflict — all three add a nav item).

**Admin layout.tsx conflict resolution:** When merging WS2 + WS3, combine the nav item additions. Expected final nav: `['Venues', 'Dates', 'Feedback', 'Insiders', 'Eval']`.
