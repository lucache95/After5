# email brand audit — 2026-06-01

Audited and fixed every transactional email under `apps/web/lib/email/` against
the Barbiecore brand (`docs/superpowers/DESIGN-SYSTEM.md` + `apps/web/tailwind.config.ts`).

## brand standard applied (email-adapted)

Email clients don't load web fonts, so brand alignment in email = **colors +
wordmark + tone + layout**, not the display face.

- Colors (Tier-1 shell, exact hex from `tailwind.config.ts`): base `#FAF4EC`,
  accent `#E0218A`, ink `#3D0F2E`, pink `#FFE5F1`. Card `#FFFFFF`, hairline
  `#F2D9E6`, muted plum `#7A5A6E`.
- Wordmark: lowercase `after5` in hot-pink accent (matches `/home` masthead),
  styled text — no hosted-image dependency.
- Fonts: web-safe stack referencing the brand fonts first then falling back —
  body `'Fredoka',…rounded sans`; heading `'Caprasimo','Cooper Black',…serif`.
- Tone: lowercase, dry, no filler/adverbs/passive (stop-slop). Em-dashes kept
  only as typographic separators in body copy, not as AI-cadence connectors.
- Layout: centered ~600px card, generous padding, `rounded` 24px card, soft
  pink hairline borders, hot-pink pill CTA, consistent header + footer.
- Footer line changed from "curated date plans for Kelowna couples" (Kelowna
  hardcoded — banned per DESIGN-SYSTEM audience note) to "the dating app that's
  actually fun".

## shared wrapper

New `apps/web/lib/email/layout.ts` exports `emailShell()` (header wordmark +
card + footer + base styles + optional unsubscribe line + hidden preheader) plus
`wordmark()`, `ctaButton()`, `eyebrow()`, `hairline()`, and the `BRAND` /
`FONT_BODY` / `FONT_HEADING` tokens. Every template routes through it. No shared
wrapper existed before — each email hand-rolled its own warm-cream `#FDF9F3` /
`#C2552B` shell.

## per-email verdict

| email | before | after | screenshot |
| --- | --- | --- | --- |
| `offer-received.ts` | PARTIAL — lowercase tone already, but warm-cream `#FDF9F3` bg, orange `#C2552B` accent, black `#1A1A1A` CTA, "After5" bold-sans wordmark, Kelowna footer. Self-labelled "Barbiecore" but rendered planner brand. | ON-BRAND — shell, pink wordmark/accent/CTA, plum ink, dating footer. | offer-received.png |
| `offer-expiring.ts` | PARTIAL — same as offer-received. | ON-BRAND — shell + last-call eyebrow in accent. | offer-expiring.png |
| `welcome.ts` | OFF-BRAND — warm-cream, orange, black CTA, sentence-case "Welcome to After5", Kelowna-hardcoded copy ("Kelownan's built", "Kelowna spot"). | ON-BRAND — shell + lowercase founder voice; polaroid motif KEPT (brand motif per §5); Kelowna removed. | welcome.png |
| `weekly-digest.ts` | OFF-BRAND — warm-cream, sentence case, "real Kelownans", tan plan cards `#F4ECDD`. | ON-BRAND — shell, soft-pink plan cards, lowercase, unsubscribe footer. | weekly-digest.png |
| `post-date-feedback.ts` | OFF-BRAND — warm-cream, sentence case, "everyone in Kelowna". | ON-BRAND — shell, lowercase, rounded cover image, unsubscribe footer. | post-date-feedback.png |
| `insider-welcome.ts` | OFF-BRAND — warm-cream, orange role badge `#FDF0E9`, capitalized "Scout"/"Curator", Kelowna in every role blurb. | ON-BRAND — shell, soft-pink `#FFE5F1` role badge, lowercase role + blurbs. | insider-welcome.png |
| `feature-spotlights.ts` | OFF-TONE — sentence-case titles/bodies, "Kelownans" (renders inside digest). | ON-BRAND — lowercase dry copy, Kelowna removed. | (renders in weekly-digest.png) |

Non-template files left as-is by design: `resend.ts` (sender plumbing),
`send-offer-received.ts` / `send-offer-expiring.ts` (dispatchers),
`feedback-token.ts` / `unsubscribe-token.ts` (token helpers).

## are all emails brand aligned now?

Yes. All six rendered emails share one Barbiecore identity — cream base, hot-pink
`after5` wordmark, pink accent + pill CTA, deep-plum ink, rounded cards, lowercase
dry copy, consistent header/footer. Verified by rendering each template with
sample props, screenshotting at 600px via Playwright/Chromium, and reading every
screenshot.

## verification

- `pnpm --filter @after5/web typecheck` — clean.
- `pnpm --filter @after5/web test` — 328 passed (68 files). The two send-offer
  dispatcher tests assert subject/content/tag only and stayed green (subjects
  unchanged where the test pins them; lowercase subjects matched existing
  expectations like "Alex sent you a night out").
- Visual: 6/6 screenshots read on-brand and consistent (rendered to /tmp, not
  committed).
