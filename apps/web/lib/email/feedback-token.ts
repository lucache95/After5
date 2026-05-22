// HMAC-signed feedback tokens. Encodes the saved_plan ID + user email so
// the feedback page can load the plan without auth. Token shape:
//   base64url(payload_json).base64url(sig)
// where sig = HMAC-SHA256(SUBSCRIBER_TOKEN_SECRET, payload_json).
//
// Reuses the same SUBSCRIBER_TOKEN_SECRET as unsubscribe tokens — one
// secret for all lightweight email-link signatures.
//
// Security hardening (2026-05-22):
//   - TTL: tokens embed an `iat` (issued-at) timestamp and expire after
//     72 hours. The email arrives ~24h post-date, giving the user 2
//     extra days to click.
//   - Scoping: payload includes saved_plan_id + itinerary_id + email,
//     so the HMAC is bound to a specific plan and user.
//   - One-time use: enforced at the DB layer via `feedback_completed_at`
//     on `saved_plans` (checked in the page server component).
//   - Rate limiting: enforced at the API route level (/api/feedback).
//
// Future consideration: signing-key rotation. Currently we use a single
// SUBSCRIBER_TOKEN_SECRET. A rotation scheme (key-id prefix + grace
// period) would let us cycle keys without invalidating in-flight links.

import { createHmac, timingSafeEqual } from 'crypto';

/** Token TTL in milliseconds — 72 hours. */
export const FEEDBACK_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

interface FeedbackPayload {
  /** saved_plans.id */
  sp: string;
  /** itineraries.id */
  it: string;
  /** user email */
  e: string;
  /** issued-at UTC epoch (seconds) */
  iat: number;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function secret(): string {
  const s = process.env.SUBSCRIBER_TOKEN_SECRET;
  if (!s) throw new Error('SUBSCRIBER_TOKEN_SECRET missing');
  return s;
}

export function makeFeedbackToken(opts: {
  savedPlanId: string;
  itineraryId: string;
  email: string;
}): string {
  const payload: FeedbackPayload = {
    sp: opts.savedPlanId,
    it: opts.itineraryId,
    e: opts.email.toLowerCase().trim(),
    iat: Math.floor(Date.now() / 1000),
  };
  const json = JSON.stringify(payload);
  const sig = createHmac('sha256', secret()).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export type FeedbackTokenResult =
  | { status: 'valid'; savedPlanId: string; itineraryId: string; email: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifyFeedbackToken(token: string): FeedbackTokenResult {
  const dot = token.indexOf('.');
  if (dot === -1) return { status: 'invalid' };

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let json: string;
  try {
    json = fromB64url(payloadB64).toString('utf8');
  } catch {
    return { status: 'invalid' };
  }

  const expected = createHmac('sha256', secret()).update(json).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sigB64);
  } catch {
    return { status: 'invalid' };
  }

  if (provided.length !== expected.length) return { status: 'invalid' };
  if (!timingSafeEqual(expected, provided)) return { status: 'invalid' };

  try {
    const p = JSON.parse(json) as FeedbackPayload;
    if (!p.sp || !p.it || !p.e) return { status: 'invalid' };

    // TTL check: reject tokens older than 72 hours.
    // Tokens minted before the `iat` field was added lack it — treat
    // them as expired (they predate this hardening and should not work).
    if (!p.iat) return { status: 'expired' };
    const ageMs = Date.now() - p.iat * 1000;
    if (ageMs > FEEDBACK_TOKEN_TTL_MS) return { status: 'expired' };

    return { status: 'valid', savedPlanId: p.sp, itineraryId: p.it, email: p.e };
  } catch {
    return { status: 'invalid' };
  }
}
