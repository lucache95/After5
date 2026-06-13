# Persona — going to Production

Identity + 18+ age verification runs through two edge functions:

- `supabase/functions/start-verification` (verify_jwt **on** — authed users) creates a
  Persona Inquiry against `PERSONA_TEMPLATE_ID` using `PERSONA_API_KEY`, with
  `reference-id = auth.uid()`, and seeds a `pending` `verifications` row.
- `supabase/functions/persona-webhook` (verify_jwt **off** — HMAC auth) receives the
  verdict, HMAC-validates it with `PERSONA_WEBHOOK_SECRET` (**fail-closed**: a blank or
  wrong secret rejects every webhook), upserts the `age` + `selfie` verification rows,
  writes the DOB into `profiles_private`, and notifies. A DB trigger rolls the rows up
  into `profiles.verification` (`unverified → pending → verified | failed`).

The frontend embeds the flow via `apps/web/app/onboarding/steps/PersonaEmbed.tsx`
(loads `cdn.withpersona.com/dist/persona-v5.1.2.js` with the returned `sessionToken`).

## The one thing that bites everyone

**Prod reads Supabase EDGE SECRETS, not `.env.local`.** Editing `.env.local` only
affects local `supabase functions serve`. To change prod you must:

```bash
supabase secrets set PERSONA_API_KEY='persona_production_…' --project-ref ufufmcpnysvwtutpbian
supabase secrets set PERSONA_WEBHOOK_SECRET='…' --project-ref ufufmcpnysvwtutpbian
# PERSONA_TEMPLATE_ID only if it changed
```

Secrets take effect at runtime — no redeploy needed.

**All three secrets must be from the SAME environment.** A Production API key paired with
a Sandbox webhook secret is the classic failure: inquiries succeed, the embedded flow
completes, but every webhook fails HMAC → the verdict is never recorded → the user is
stranded in `pending` with no recovery. This is a launch blocker.

## Production checklist

Repo / edge (engineer):
- [ ] Set prod edge `PERSONA_API_KEY` to the **production** key (`persona_production_…`).
- [ ] Set prod edge `PERSONA_WEBHOOK_SECRET` to the **production webhook's** signing secret.
- [ ] Confirm prod edge `PERSONA_TEMPLATE_ID` is the template that is **published in
      Production** (the same `itmpl_…` id works across environments only if that template
      version is enabled in Production).

Persona dashboard (manual — values not in the repo):
- [ ] **Production environment**: the inquiry template (`itmpl_…`) is published/enabled.
- [ ] **Webhooks** (Production env): a webhook pointing at
      `https://ufufmcpnysvwtutpbian.supabase.co/functions/v1/persona-webhook`, subscribed to
      `inquiry.approved`, `inquiry.declined`, `inquiry.marked-for-review`. Copy its **signing
      secret** → that's the value for `PERSONA_WEBHOOK_SECRET`.
- [ ] **Allowed / redirect domains** (Production env): include `tryafter5.app` (and any
      Vercel preview domain you verify from) so the embedded flow + redirects aren't blocked.

## Verify it end-to-end

1. Sign in on prod, go to `/onboarding/verify`, run the flow with a real ID.
2. Watch `supabase functions logs persona-webhook --project-ref ufufmcpnysvwtutpbian` — a
   `200 ok` (not `401 bad_signature`) means the secret matches.
3. Confirm the user's `profiles.verification` flips to `verified` and `profiles_private.birthdate`
   is written.

If the webhook logs show `401 bad_signature`, the `PERSONA_WEBHOOK_SECRET` doesn't match the
Production webhook's signing secret — re-copy it from the dashboard.
