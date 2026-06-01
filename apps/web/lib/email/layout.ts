// Shared Barbiecore email shell — header (wordmark) + footer + base styles.
// Every transactional email routes through `emailShell()` so the brand stays
// consistent: warm-filmic cream base, hot-pink accent, deep-plum ink, lowercase
// dry copy, ~600px centered card, generous padding, rounded surfaces.
//
// Email clients don't load web fonts reliably (Caprasimo/Fredoka won't render
// in Gmail/Outlook), so we reference the brand fonts first then fall back to a
// rounded web-safe stack. Brand alignment in email = COLORS + wordmark + tone +
// layout, not the display face. All CSS is inlined — email requires it.

// Barbiecore Tier-1 shell tokens — must match apps/web/tailwind.config.ts.
export const BRAND = {
  base: '#FAF4EC', // warm filmic cream — page background
  accent: '#E0218A', // hot pink — wordmark, CTAs, key highlights
  ink: '#3D0F2E', // deep plum — primary text
  pink: '#FFE5F1', // soft pink tint — washes, eyebrow chips
  card: '#FFFFFF', // card surface on top of cream
  hairline: '#F2D9E6', // soft pink-tinted divider/border
  muted: '#7A5A6E', // plum-muted secondary text (passes on cream + white)
} as const;

// Rounded, friendly web-safe stack. References Fredoka first (round, friendly)
// so any client that DOES have it picks it up; everything else degrades to a
// system rounded/sans face.
export const FONT_BODY =
  "'Fredoka','Trebuchet MS','Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif";
// Caprasimo is the display face; fall back to a chunky system serif so headings
// keep some weight/character when it can't load.
export const FONT_HEADING =
  "'Caprasimo','Cooper Black','Arial Rounded MT Bold','Trebuchet MS',Georgia,serif";

export interface EmailShellOptions {
  /** Document <title> + preheader hint. */
  title: string;
  /** Inner card HTML (already escaped where needed). */
  body: string;
  /** Optional unsubscribe URL — renders the one-click footer line when set. */
  unsubUrl?: string | null;
  /** Footer unsubscribe label, e.g. "don't want post-date emails?". */
  unsubLabel?: string;
  /** Max card width in px. Default 600 (email-safe, mobile-friendly). */
  maxWidth?: number;
  /** Hidden preheader text shown in the inbox preview. */
  preheader?: string;
  /** Site URL for the wordmark + footer link. */
  siteUrl: string;
}

// The After5 wordmark as styled text — lowercase, hot pink, the dating-brand
// treatment (no hosted image dependency, renders identically everywhere).
export function wordmark(siteUrl: string): string {
  return `<a href="${siteUrl}" style="font-family:${FONT_HEADING};font-size:26px;font-weight:400;color:${BRAND.accent};text-decoration:none;letter-spacing:-0.01em;">after5</a>`;
}

// Pill CTA button — hot-pink fill, rounded, white label, lowercase.
export function ctaButton(opts: { href: string; label: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px 0;">
    <tr>
      <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:9999px;">
        <a class="btn" href="${opts.href}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-family:${FONT_BODY};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:9999px;">
          ${opts.label}
        </a>
      </td>
    </tr>
  </table>`;
}

// Eyebrow label — small uppercase tracked tag in the accent color.
export function eyebrow(text: string, color: string = BRAND.muted): string {
  return `<p style="margin:0 0 10px 0;font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${color};">${text}</p>`;
}

// Hairline divider matching the brand.
export function hairline(): string {
  return `<hr style="border:none;border-top:1px solid ${BRAND.hairline};margin:26px 0 22px 0;">`;
}

export function emailShell(opts: EmailShellOptions): string {
  const maxWidth = opts.maxWidth ?? 600;
  const siteUrl = opts.siteUrl;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.base};opacity:0;">${opts.preheader}</div>`
    : '';

  const footerUnsub = opts.unsubUrl
    ? `<p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${BRAND.muted};">
         ${opts.unsubLabel ?? "don't want these?"} <a href="${opts.unsubUrl}" style="color:${BRAND.muted};text-decoration:underline;">unsubscribe</a> &mdash; one click.
       </p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${opts.title}</title>
  <style>
    body, table, td, p, a, h1, h2, ul, li { font-family: ${FONT_BODY}; }
    h1, h2 { font-family: ${FONT_HEADING}; }
    a.btn:hover { background-color: #C71778 !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.base};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.base}" style="background-color:${BRAND.base};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${maxWidth}px;">

          <tr>
            <td align="left" style="padding:0 0 24px 4px;">
              ${wordmark(siteUrl)}
            </td>
          </tr>

          <tr>
            <td bgcolor="${BRAND.card}" style="background-color:${BRAND.card};border:1px solid ${BRAND.hairline};border-radius:24px;padding:34px 30px;">
              ${opts.body}
            </td>
          </tr>

          <tr>
            <td style="padding:24px 8px 0 8px;">
              <p style="margin:0 0 6px 0;font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${BRAND.muted};">
                <a href="${siteUrl}" style="color:${BRAND.ink};text-decoration:underline;">tryafter5.app</a>
                &middot; the dating app that's actually fun
              </p>
              ${footerUnsub}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
