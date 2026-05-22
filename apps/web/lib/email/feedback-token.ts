// HMAC-signed feedback tokens. Encodes the saved_plan ID + user email so
// the feedback page can load the plan without auth. Token shape:
//   base64url(payload_json).base64url(sig)
// where sig = HMAC-SHA256(SUBSCRIBER_TOKEN_SECRET, payload_json).
//
// Reuses the same SUBSCRIBER_TOKEN_SECRET as unsubscribe tokens — one
// secret for all lightweight email-link signatures.

import { createHmac, timingSafeEqual } from 'crypto';

interface FeedbackPayload {
  /** saved_plans.id */
  sp: string;
  /** itineraries.id */
  it: string;
  /** user email */
  e: string;
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
  };
  const json = JSON.stringify(payload);
  const sig = createHmac('sha256', secret()).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export function verifyFeedbackToken(
  token: string,
): { savedPlanId: string; itineraryId: string; email: string } | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let json: string;
  try {
    json = fromB64url(payloadB64).toString('utf8');
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret()).update(json).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sigB64);
  } catch {
    return null;
  }

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const p = JSON.parse(json) as FeedbackPayload;
    if (!p.sp || !p.it || !p.e) return null;
    return { savedPlanId: p.sp, itineraryId: p.it, email: p.e };
  } catch {
    return null;
  }
}
