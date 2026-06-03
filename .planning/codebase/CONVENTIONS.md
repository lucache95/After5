# Coding Conventions

**Analysis Date:** 2026-06-03

## Naming Patterns

**Files:**
- PascalCase for React components: `LocalTime.tsx`, `UserMenu.tsx`, `ProfileCard.tsx`
- camelCase for utility functions and libraries: `cn.ts`, `sticker.ts`, `calendar.ts`, `place-image.ts`
- kebab-case for test files co-located with components: `LocalTime.test.tsx`, `UserMenu.test.tsx`
- Feature directories use kebab-case: `/lib/after5`, `/lib/email`, `/lib/match`
- E2E test files follow pattern: `[feature]-[variant].spec.ts` (e.g., `5b-happy-path.spec.ts`, `chat-negatives.spec.ts`)

**Functions:**
- camelCase for all function names: `vibePalette()`, `messageForCode()`, `shortlist()`, `createClient()`
- Verb-first for actions: `makeOffer()`, `idemKey()`, `normalizeNightDetailStops()`, `createBrowserClient()`
- Boolean-returning functions use `is` or `has` prefix: standard TypeScript convention
- No leading underscores for "private" functions; encapsulation via module scope

**Variables:**
- camelCase for all variables and constants: `const MESSAGES`, `let mounted`, `const hostEmail`
- UPPER_SNAKE_CASE for module-level constants only: `const MAX_PHOTOS = 10`, `const SERVICE_ROLE_KEY`
- Const with objects/arrays at module scope: `const DEFAULT: VibePalette = {...}`, `const KEYWORD_PALETTES = [...]`

**Types:**
- PascalCase for all TypeScript types and interfaces: `LocalTimeProps`, `SessionUser`, `VibePalette`, `OfferResult`, `MatchError`
- Suffixes: `Props` for component prop types, no suffix for domain/data types
- Discriminated unions for result types: `{ kind: 'offer'; offer_id: string } | { kind: 'reciprocal'; pair_id: string }`
- Error types as classes inheriting from Error: `class MatchError extends Error`

**Type Naming Conventions:**
- Request/response envelopes: `Envelope<T>` with discriminated `ok` boolean
- Props interfaces always defined in the component file above the component function
- Reusable domain types in `@after5/types` package (e.g., `Database`, auto-generated from Supabase schema)

## Code Style

**Formatting:**
- ESLint config extends `next/core-web-vitals`
- Rules enabled: `react/no-unescaped-entities` (warn), `@next/next/no-html-link-for-pages` (warn)
- Prettier config: not explicitly set; uses Next.js defaults
- Two-space indentation (implicit from codebase patterns)

**Linting:**
- ESLint extends Next.js best practices for React/Next.js rules
- Core rules remain lenient with warnings (not errors) to favor pragmatism over strictness
- No additional formatting tooling (Biome, custom Prettier) detected

**Structural Style:**
- One component/type per file (PascalCase files are single exports)
- Files <500 lines (enforced by design-system guidance)
- JSDoc comments on components and exported functions, not inline clutter
- Single blank line between logical sections within a file

## Import Organization

**Order:**
1. React + Next.js imports: `import { useEffect, useState } from 'react'`; `import Link from 'next/link'`; `import type { Metadata } from 'next'`
2. Third-party libraries: `import { createClient } from '@supabase/ssr'`; `import { Toaster } from 'sonner'`
3. Relative imports from `@/` alias: `import { cn } from '@/lib/cn'`; `import { LocalTime } from '@/components/LocalTime'`
4. Blank line between groups
5. Within each group, `type` imports at the end

**Path Aliases:**
- `@/*` maps to `./` (apps/web) per `tsconfig.json` `paths` config
- `@after5/types`, `@after5/business`, `@after5/api-client`, etc. for package imports (pnpm workspace)
- All imports use explicit paths; no barrel-file re-exports unless the file is specifically a barrel (e.g., `packages/business/src/index.ts`)

## Error Handling

**Patterns:**
- Custom error class `MatchError` for all edge-function failures
- `MatchError` wraps: `code` (discriminator string), `errcode` (raw PG error code for debugging), `detail` (optional context)
- Messages mapped via `messageForCode(code: string): string` for user-facing copy
- Discriminated envelopes: `{ ok: true, data: T } | { ok: false, code: '<name>', message, detail?: string, errcode?: 'P50xx' }`
- Throw `MatchError` on validation failures or RPC failures
- Never silent catches; always log or re-throw with context
- Null checks: `if (!data) throw new MatchError('unknown')`; `if (Number.isNaN(d.getTime())) return fallback`

**Async Patterns:**
- `async`/`await` preferred over `.then()` chains
- `.catch((err) => { ... })` used for specific fire-and-forget error suppression (e.g., email notifications)
- No catch-all `.catch()` without logging or context

**Component-Level Error Boundaries:**
- Uses `error.tsx` for Next.js app routes (see `apps/web/app/error.tsx`)
- SSR components throw to let Next.js handle errors
- Client components with hydration-safe try/catch use `suppressHydrationWarning` only when necessary

## Logging

**Framework:** console (browser/edge) and stderr (edge functions)

**Patterns:**
- No explicit logging library; uses native `console.log`, `console.error`
- PostHog integration (see `PostHogProvider.tsx`) for analytics, not logging
- Edge function stderr writes captured by Supabase function logs
- No debug-mode conditional logging; rely on error stack traces and request IDs
- Log failures and side-effect outcomes (email sent, photo uploaded)

## Comments

**When to Comment:**
- Inline comments explain WHY, not WHAT (WHAT is clear from code)
- Function-level comments (JSDoc or block comment) for non-obvious behavior
- Algorithm complexity or performance notes: "O(n²) search — acceptable for <50 items"
- **Hydration patterns** require explicit comments (e.g., SSR/client sync issues in `LocalTime.tsx`)
- RLS policy rationale in SQL migrations, not TypeScript

**JSDoc/TSDoc:**
- Component props: inline `interface Props { /** description */ prop: Type }`
- Exported functions: `/** description of what it does and any side effects */`
- No over-documenting; if the type and name are clear, skip the comment
- Example usage in comments for ambiguous APIs

**Example:**
```typescript
// apps/web/components/LocalTime.tsx line 3-8
// Client component that renders a datetime in the VIEWER's local timezone.
// SSR-safe local time, done right. A Server Component renders this in the server
// TZ (UTC). Two earlier approaches failed: (1) raw toLocaleString → React #418
// hydration error; (2) suppressHydrationWarning on an always-rendered value →
// silences the warning but React keeps the server (UTC) text and never swaps to
// local, even after a state-triggered re-render.
```

## Function Design

**Size:** 
- Target <50 lines for utility functions
- Components up to 150 lines acceptable (split if logic is complex)
- One responsibility per function (SRP enforced by size constraint)

**Parameters:**
- Destructure props: `({ iso, opts, format, fallback, className }: LocalTimeProps)`
- Single object param for >2 arguments
- No default parameters in function signatures for required params; use JSDoc `@default`
- Optional params at the end, destructured with defaults inline

**Return Values:**
- Explicit return types on exported functions: `Promise<OfferResult>`, `VibePalette`, `null`
- Discriminated unions for branching results (offer vs. reciprocal match)
- Early returns for guard clauses: `if (!iso) return <span>...</span>`
- Never return undefined implicitly; use `null` or explicit type

**Example:**
```typescript
// apps/web/lib/after5/match.ts lines 88-100
export async function makeOffer(instance: string, candidate: string): Promise<OfferResult> {
  const result = await call<OfferResult>('match-make-offer', {
    instance,
    candidate,
    idem_key: idemKey(),
  });
  // Fire-and-forget email notification (see comment for why this is safe)
  fireAndForget(() => notifyOffered(result));
  return result;
}
```

## Module Design

**Exports:**
- Named exports only; no default exports
- Barrel files explicitly labeled (e.g., `packages/business/src/index.ts` re-exports specific functions)
- All exports from source files (not re-exported through barrels) use `export function`, `export type`, `export interface`
- Type-only imports use `import type { ... }`

**Barrel Files:**
- Used for package entrypoints: `packages/business/src/index.ts`
- Not used for directory grouping within `apps/web` (import from leaf files)
- Enables tree-shaking when package is consumed

**Circular Imports:**
- Avoided; layered architecture prevents them (see ARCHITECTURE.md)
- If needed, defer import to function scope (rare)

## Design System Conventions

**Barbiecore / Dating Vertical:**
- All dating UI (`/onboarding`, `/home`, `/feed`, `/dates/[slug]`, `/matches`, `/messages`) uses tokens from `docs/superpowers/DESIGN-SYSTEM.md`
- Tailwind tokens: `font-heading` (Caprasimo), `font-body` (Fredoka), `shell.*` colors
- Runtime vibe palettes via `vibePalette(vibeTags)` from `packages/business/src/vibePalette.ts`
- No hardcoded hex colors in components; always use semantic Tailwind tokens
- Sticker rotation: deterministic `-3° to +3°` via `stickerRotation()` utility in `apps/web/lib/sticker.ts`

**Class Merging:**
- `cn()` utility (clsx + tailwind-merge) for conditional Tailwind classes
- Never concatenate class strings directly
- Example: `cn('text-base', variant === 'dark' && 'text-white')`

**Mobile-First:**
- Design at 375px; desktop centers in phone-container (`max-w-[420px]`)
- Use `vaul` (bottom sheets), `sonner` (toasts), `framer-motion` (animations)
- Tap targets ≥44px, generous padding
- `hover:` styles only on devices with pointer:fine (Tailwind config sets `hoverOnlyWhenSupported: true`)

**Accessibility:**
- Semantic HTML + ARIA labels on icon buttons
- Heading hierarchy (`<h1>`, `<h2>`, etc., not skipped)
- Alt text on all images
- Keyboard navigation (Tab, Enter, Escape)
- Contrast passes WCAG AA (mind shell.pink on shell.base combinations)

**Legacy Planner Brand:**
- Warm cream / terra-cotta tokens: `background`, `surface`, `accent`, `text`
- Font: Inter (body), Fraunces (display)
- Kept separate from dating-vertical Barbiecore; planner routes use warm tokens only
- No emoji, no stickers, no Gen-Z copy on planner surfaces

## TypeScript

**Strict Mode:** Enabled globally in `apps/web/tsconfig.json`
- `strict: true` enforces all strict flags
- `noEmit: true` (type-check only, build via Next.js)
- `skipLibCheck: true` to avoid transitive dependency type errors

**Null/Undefined:**
- Required vs. optional clearly marked in types: `iso: string | null` vs `iso?: string`
- Optional chaining: `data?.id`, `user?.email`
- Nullish coalescing: `value ?? fallback`
- Non-null assertions rare; only use when TypeScript inference is impossible and you've proven safety

**Generics:**
- Used for reusable components and utilities: `<T>` in `call<T>()`, `Envelope<T>`
- Named constraints when helpful: `<T extends Record<string, unknown>>`
- Inferred when possible; explicit in function signatures

## Server vs. Client Components (Next.js 15)

**Pattern:**
- Default to Server Components (no `'use client'` directive)
- Mark `'use client'` only when the component needs hooks, event handlers, or browser APIs
- Use `'use client'` at the leaf (smallest subtree) to preserve streaming benefits
- Server components fetch data; pass as props to client children

**Authentication:**
- `createAdminClient()` (server-only) uses `SUPABASE_SECRET_KEY` for admin operations
- `createClient()` (client-side) uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + session auth
- `browserAfter5Client()` in client components for edge-function calls

**Data Flow:**
- Server: fetch from Supabase → component renders
- Client: event handler → call edge function → handle `MatchError`
- Never pass Server Component client-only props down to children

## RLS / Security Conventions

**Database Policies:**
- All tables have RLS enabled; policies default-deny
- Policies keyed on `auth.uid()` for user data
- Admin operations (migrations, migrations) use service-role client, not session auth
- Policies documented in SQL comments at table/policy level

**Environment Variables:**
- `NEXT_PUBLIC_*` prefix for client-side variables (always present in client bundle)
- No `NEXT_PUBLIC_` prefix for secrets: `.env.local` only, never committed
- Supabase keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- Edge function secrets: set in Vercel/Supabase dashboard, not `.env` files

## Organization & Team Patterns

**Work-in-progress branches:**
- Feature branches use descriptive names: `5b-match-core`, `chat-send-message`, `m2-create-form`
- Worktree branches for parallel tracks (see `.claude/worktrees`)
- Main is always production-deployable (CI gates enforce test + type-check passes)

**Commit Messages:**
- Concise present-tense: "add MatchError handling", "refactor vibePalette to support tagBg"
- Multi-line: title + body (reason why)
- Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

*Convention analysis: 2026-06-03*
