// apps/web/lib/after5/match.ts
// Typed client wrapper over the 5b match-* edge functions. One function per
// edge function D touches; centralizes the error-name → dry-copy mapping so
// every host screen reports failures the same way, and mints idem_key for the
// mutating calls that coalesce retries. Calls go through browserAfter5Client()
// so the cookie-backed SSR session is reused (no second client).
// Canonical edge envelope (see _shared/errcode.ts):
//   success → { ok: true, data: T }
//   failure → { ok: false, code: '<name>', message, detail?: string, errcode?: 'P50xx' }
// `code` is the string name (the discriminator); `errcode` is the raw PG code.
'use client';
import { browserAfter5Client } from '@/lib/after5/client';

// String error names the edge layer emits (errcode.ts MAP + server_error/bad_request).
export type MatchErrorName =
  | 'feature_disabled' | 'auth_mismatch' | 'account_gated'
  | 'offer_already_active' | 'time_conflict' | 'chat_not_ready'
  | 'offer_expired' | 'reciprocal_pending' | 'reciprocal_stale'
  | 'server_error' | 'bad_request';

// Raw PG errcodes, carried in `errcode` for debugging/telemetry.
export type MatchErrcode =
  | 'P5000' | 'P5001' | 'P5002' | 'P5003' | 'P5004'
  | 'P5005' | 'P5007' | 'P5008' | 'P5009';

export type DemandBucket = 'quiet' | 'warming_up' | 'filling_up' | 'almost_full';

// Discriminated result of match_make_offer (RPC returns jsonb; commit ab4d087).
export type OfferResult =
  | { kind: 'offer'; offer_id: string }
  | { kind: 'reciprocal'; pair_id: string };

export class MatchError extends Error {
  code: MatchErrorName | 'unknown';
  errcode?: string;
  detail?: string;
  constructor(code: MatchErrorName | 'unknown', errcode?: string, detail?: string) {
    super(messageForCode(code));
    this.name = 'MatchError';
    this.code = code;
    this.errcode = errcode;
    this.detail = detail;
  }
}

// Keyed by the string error name (the envelope's `code`). Dry lowercase copy.
const MESSAGES: Record<MatchErrorName, string> = {
  feature_disabled: "matching isn't live yet — soon.",
  auth_mismatch: "that's not your account to act on.",
  account_gated: "this person can't be offered right now.",
  offer_already_active: 'you already have an offer out.',
  time_conflict: 'that time overlaps another locked date.',
  chat_not_ready: 'keep chatting first.',
  offer_expired: 'that offer already expired.',
  reciprocal_pending: 'this date needs a reciprocal decision first.',
  reciprocal_stale: 'both dates were cancelled.',
  server_error: "that didn't go through. try again?",
  bad_request: "that didn't go through. try again?",
};

export function messageForCode(code: string): string {
  return MESSAGES[code as MatchErrorName] ?? "that didn't go through. try again?";
}

type Envelope<T> = { ok: boolean; data?: T; code?: string; errcode?: string; detail?: string };

// Edge functions return a 2xx JSON envelope on the happy path AND, for handled
// failures, may surface as a non-2xx with the same body on `data`. We read the
// body either way and throw MatchError (keyed on the string `code`) when ok === false.
async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await browserAfter5Client().functions.invoke<Envelope<T>>(fn, { body });
  if (!data) throw new MatchError('unknown');
  if (data.ok === false) {
    throw new MatchError((data.code as MatchErrorName) ?? 'unknown', data.errcode, data.detail);
  }
  return data.data as T;
}

function idemKey(): string {
  return crypto.randomUUID();
}

export function shortlist(instance: string, candidate: string, rank: number): Promise<null> {
  return call<null>('match-shortlist', { instance, candidate, rank });
}

// Returns the discriminated jsonb: caller branches on result.kind.
// On a successful 'offer' result we fire the offer-received email best-effort:
// the edge runtime that creates the offer can't send mail (blank RESEND key),
// so we ping the Node route /api/offers/notify-offered, which resolves the
// recipient + sends. Fire-and-forget — a failed/blocked send never affects the
// offer (the RPC result is the source of truth). A 'reciprocal' result is not a
// new outgoing offer, so it sends nothing here.
export async function makeOffer(instance: string, candidate: string): Promise<OfferResult> {
  const result = await call<OfferResult>('match-make-offer', {
    instance, candidate, idem_key: idemKey(),
  });
  if (result.kind === 'offer') {
    notifyOfferReceived(result.offer_id);
  }
  return result;
}

// Best-effort: never throws, never awaited by callers. Mirrors the email
// layer's warn-and-skip contract so the offer flow is never blocked on mail.
function notifyOfferReceived(offerId: string): void {
  try {
    if (typeof fetch !== 'function') return;
    void fetch('/api/offers/notify-offered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId }),
      keepalive: true,
    }).catch((err) => {
      console.warn('[match] offer-received email trigger failed', err);
    });
  } catch (err) {
    console.warn('[match] offer-received email trigger threw', err);
  }
}

// Exported for sub-project E (candidate self-withdraw); D never calls it (F-1).
export function withdraw(instance: string): Promise<null> {
  return call<null>('match-withdraw', { instance });
}

// Sub-project E (candidate accept). match_accept_offer returns a bare uuid (the
// lock id); the edge envelope is { ok:true, data:'<uuid>' } so call<string> yields it.
export function acceptOffer(offer: string): Promise<string> {
  return call<string>('match-accept-offer', { offer, idem_key: idemKey() });
}

// Sub-project E (candidate pass). match_pass_offer returns void; no idem_key.
export async function passOffer(offer: string): Promise<void> {
  await call<null>('match-pass-offer', { offer });
}

export function cancelLock(
  lock: string,
  reason: 'mutual' | 'no_show' | 'creator_pre_lock' | 'safety',
): Promise<null> {
  return call<null>('match-cancel-lock', { lock, reason, idem_key: idemKey() });
}

export function resolveReciprocal(pairId: string, chosenInstance: string): Promise<null> {
  return call<null>('match-resolve-reciprocal', {
    pair_id: pairId, chosen_instance: chosenInstance, idem_key: idemKey(),
  });
}

export function demandHint(instance: string): Promise<DemandBucket> {
  return call<DemandBucket>('match-demand-hint', { instance });
}

// Sub-project F (post-date rating). match_ratings has NO RPC — it's a direct
// table insert under RLS (policy match_ratings_rater_insert: rater_id=auth.uid()
// AND the lock pairs rater↔ratee). So this wrapper inserts via the browser client
// rather than functions.invoke. The unique (lock_id, rater_id) constraint means a
// resubmit returns 'already_rated' (terminal success), not an error.
export interface RatingInput {
  lockId: string;
  rateeId: string;
  showed_up: boolean | null;
  on_time: boolean | null;
  cancelled_with_notice: boolean | null;
  unsafe_or_disrespectful: boolean | null;
}

export async function submitRating(input: RatingInput): Promise<'ok' | 'already_rated'> {
  const client = browserAfter5Client();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new MatchError('auth_mismatch');
  const { error } = await client.from('match_ratings').insert({
    lock_id: input.lockId,
    rater_id: user.id,
    ratee_id: input.rateeId,
    showed_up: input.showed_up,
    on_time: input.on_time,
    cancelled_with_notice: input.cancelled_with_notice,
    unsafe_or_disrespectful: input.unsafe_or_disrespectful,
  });
  if (error) {
    if (error.code === '23505') return 'already_rated';
    throw new MatchError('server_error', error.code, error.message);
  }
  return 'ok';
}
