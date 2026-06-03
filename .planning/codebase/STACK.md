# Technology Stack

**Analysis Date:** 2026-06-03

## Languages

**Primary:**
- TypeScript 5.6.3 - All application code (monorepo packages + Next.js app)

**Runtime:**
- JavaScript (ES2022 target compiled from TypeScript)

## Runtime

**Environment:**
- Node.js >= 22.0.0 (enforced in `package.json` engines)

**Package Manager:**
- pnpm 9.12.0 (monorepo package manager)
- Lockfile: `pnpm-lock.yaml` (262KB, committed)

## Frameworks

**Core Application:**
- Next.js 15.1.0 - Server-side rendering, API routes, App Router (`apps/web/`)
- React 19.0.0 - UI component library
- React DOM 19.0.0 - React rendering

**Monorepo Build:**
- Turbo 2.3.0 - Monorepo task orchestration and caching
- pnpm workspaces - Workspace dependencies defined in `pnpm-workspace.yaml`

**Backend/Edge:**
- Supabase Functions - Deno-based serverless functions (`supabase/functions/`)
- Deno 1.x (implicit in Supabase stack) - Edge Function runtime

**Testing:**
- Vitest 2.1.8 - Unit and integration test runner (config: `vitest.config.ts`, workspace config: `vitest.workspace.ts`)
- Playwright 1.49.0 - E2E browser testing (`apps/web/`)
- Jest (via Testing Library) - React component testing utilities
- jsdom 25.0.1 - DOM implementation for Node-based tests

**Build/Dev:**
- TypeScript 5.6.3 - Type checking (`tsc --noEmit`)
- Tailwind CSS 3.4.17 - Utility-first CSS framework (`apps/web/tailwind.config.ts`)
- Autoprefixer 10.4.20 - CSS vendor prefixing
- PostCSS 8.5.0 - CSS transformation
- Sharp 0.34.5 - Image optimization (Next.js Image)
- ESLint 8.57.1 - Code linting
- eslint-config-next - Next.js ESLint rules
- next-lint - Next.js built-in linting

**UI Components:**
- Framer Motion 12.40.0 - Animation library
- Vaul 1.1.2 - Drawer/modal component library
- Sonner 2.0.7 - Toast notification library
- Lucide React 0.460.0 - Icon library
- clsx 2.1.1 - Classname utility
- tailwind-merge 2.5.5 - Merge Tailwind classes without conflicts

**PDF Generation:**
- @react-pdf/renderer 4.5.1 - Server-side PDF creation from React components

## Key Dependencies

**Critical - Database/Auth:**
- @supabase/supabase-js 2.45.0 - Supabase JavaScript client (database, auth, realtime)
- @supabase/ssr 0.10.2 - Supabase SSR helpers (cookie-based auth for Next.js App Router)

**Critical - Schema/Validation:**
- zod 3.23.8 - TypeScript-first schema validation (used throughout Edge Functions and API routes)

**Analytics:**
- posthog-js 1.369.3 - Product analytics (client-side, optional via `NEXT_PUBLIC_POSTHOG_KEY`)

**Maps:**
- mapbox-gl 3.22.0 - Mapbox GL library (static map images only, no WebGL)
- react-map-gl 8.1.1 - React wrapper for Mapbox (installed but may be unused)

**Push Notifications:**
- web-push 3.6.7 - Web Push Protocol sender (server-side, Node.js runtime)

**Testing Utilities:**
- @testing-library/react 16.1.0 - React component testing utilities
- @testing-library/user-event 14.5.2 - User interaction simulation
- @testing-library/jest-dom 6.6.3 - DOM matchers for Jest
- jest-axe 10.0.0 - Accessibility testing

**Internal Monorepo Packages:**
- @after5/api-client (workspace:*) - Supabase client wrapper
- @after5/types (workspace:*) - Shared TypeScript types
- @after5/validators (workspace:*) - Zod schema validation
- @after5/business (workspace:*) - Business logic

## Configuration

**Environment:**
- `.env.local.example` - Template for environment variables (NEVER commit `.env.local`)
- `.env.development.local` - Development-specific overrides
- `.env.prod.local` - Production-specific overrides
- Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `JOBS_RUNNER_SECRET`, and others (see `.env.local.example`)

**Build:**
- `tsconfig.base.json` - Base TypeScript configuration (ES2022 target, bundler resolution)
- `tsconfig.json` - Next.js TypeScript configuration (DOM lib, JSX preserve)
- `apps/web/tsconfig.json` - App-specific configuration
- `next.config.js` - Next.js configuration (transpilation of workspace packages, image remotePatterns)
- `vitest.config.ts` - Vitest configuration (Node environment by default)
- `vitest.workspace.ts` - Workspace config splitting Node tests (packages/*) from jsdom tests (apps/web)
- `turbo.json` - Turbo task definitions and caching

**Database:**
- `supabase/config.toml` - Local Supabase environment config (port 54321 API, 54322 DB)
- Migrations in `supabase/migrations/` (numbered .sql files, managed by Supabase CLI)
- Edge Functions in `supabase/functions/*/` (Deno-based)

**Linting/Formatting:**
- `.eslintrc` or similar (searched but specific config not found in output)
- Prettier (not explicitly configured in sample; Tailwind may auto-format CSS)

## Platform Requirements

**Development:**
- Node.js >= 22.0.0
- pnpm 9.12.0
- PostgreSQL 17 (via Supabase local stack)
- Deno (implicit, used by Supabase Functions locally)
- Git
- Supabase CLI (for `db:start`, `db:push`, `functions:*` commands)

**Production:**
- Vercel (hosting platform for `apps/web/`)
- Supabase Cloud (PostgreSQL database, auth, edge functions, storage, realtime)
- Supabase Schema Version: PostgreSQL 17 major

**Deployment:**
- Vercel deployment via `vercel.json` (see build/install commands in that file)
- Cron jobs via Vercel Cron (defined in `apps/web/vercel.json`)
- Edge Functions deployed to Supabase via `supabase functions deploy`

---

*Stack analysis: 2026-06-03*
