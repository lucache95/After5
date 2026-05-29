# Branded Auth Emails

The HTML files in this folder are the branded versions of Supabase's auth emails. They share the after5 dating brand: shell-base canvas (`#FAF4EC`), lowercase Caprasimo-style wordmark/headline, pink (`#E0218A`) accent on one word, deep-plum (`#3D0F2E`) pill CTA, Fredoka body. Google fonts load as progressive enhancement; web-safe fallbacks (`Trebuchet MS`/`Segoe UI`) keep them rendering in clients that block remote fonts. Designed for Gmail, Apple Mail, Outlook 2016+ and major mobile clients (all critical styles inlined; `<style>` block is fallback only).

## Files

| File                  | Supabase template          | Subject (paste in dashboard)         |
| --------------------- | -------------------------- | ------------------------------------ |
| `magic-link.html`     | Magic Link                 | `your after5 sign-in link`           |
| `confirm-signup.html` | Confirm signup             | `confirm your after5 email`          |
| `reset-password.html` | Reset Password             | `reset your after5 password`         |

> **Token used in all three:** `{{ .ConfirmationURL }}` — Supabase substitutes the time-limited link at send time.

## How to install (Supabase dashboard)

1. Go to **Authentication → Email Templates**: https://supabase.com/dashboard/project/ufufmcpnysvwtutpbian/auth/templates
2. For each template (Magic Link, Confirm signup, Reset Password):
   - Set **Subject heading** from the table above.
   - Open the matching HTML file, copy the entire contents, and paste into the **Message body** field.
   - Click **Save**.
3. Send yourself a magic link via the live `/login` to confirm rendering.

## To get a real FROM address (`hello@tryafter5.app`)

By default Supabase sends from `noreply@mail.app.supabase.io` and is rate-limited to 4 emails/hour. To send from your own domain and lift the rate limit:

1. **Sign up at Resend**: https://resend.com (free tier = 3000/month).
2. **Add and verify the `tryafter5.app` domain** in Resend → Domains. They'll give you DNS records (SPF, DKIM, DMARC) to add to Cloudflare for `tryafter5.app`.
3. **Create an API key** in Resend → API Keys.
4. Add to `.env.local` (already templated):
   ```
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=hello@tryafter5.app
   ```
5. **Configure Supabase SMTP**: Authentication → Settings → SMTP Settings:
   - Host: `smtp.resend.com`
   - Port: `465` (TLS) or `587` (STARTTLS)
   - Username: `resend`
   - Password: your Resend API key
   - Sender email: `hello@tryafter5.app`
   - Sender name: `After5`
   - Toggle **Enable Custom SMTP** ON.
6. Send a test from `/login` — emails now come from `hello@tryafter5.app`.

I can automate the Cloudflare DNS records via the existing Cloudflare API token in `.env.local` once you've created the Resend domain entry and have the records to push.
