// supabase/functions/_shared/errcode.ts
// Maps Postgres errcodes (raised by P5 RPCs) to HTTP status + UI-facing string.
// See docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md §4.1.

export type P5ErrorCode =
  | 'P5000'  // feature_disabled       → 503
  | 'P5001'  // auth_mismatch          → 401
  | 'P5002'  // account_gated          → 409
  | 'P5003'  // offer_already_active   → 409
  | 'P5004'  // time_conflict          → 409
  | 'P5005'  // chat_not_ready         → 425
  | 'P5007'  // offer_expired          → 410
  | 'P5008'  // reciprocal_pending     → 409
  | 'P5009'; // reciprocal_stale       → 409

export type ErrorBody = {
  ok: false;
  code: string;          // 'feature_disabled' | 'auth_mismatch' | ... | 'server_error'
  message: string;       // UI-facing string
  detail?: string;       // optional detail from PG raise (e.g. P5002 sub-reason)
  errcode?: string;      // raw PG errcode (debugging)
};

export type SuccessBody<T> = { ok: true; data: T };

const MAP: Record<P5ErrorCode, { status: number; code: string; message: string }> = {
  P5000: { status: 503, code: 'feature_disabled',     message: 'Matching launches soon.' },
  P5001: { status: 401, code: 'auth_mismatch',        message: 'Please sign in again.' },
  P5002: { status: 409, code: 'account_gated',        message: "This person isn't available." },
  P5003: { status: 409, code: 'offer_already_active', message: "Someone's already in the offer slot." },
  P5004: { status: 409, code: 'time_conflict',        message: "You're already locked at that time." },
  P5005: { status: 425, code: 'chat_not_ready',       message: 'Keep chatting first.' },
  P5007: { status: 410, code: 'offer_expired',        message: 'That offer expired.' },
  P5008: { status: 409, code: 'reciprocal_pending',   message: 'You have a reciprocal match — choose which night to lock.' },
  P5009: { status: 409, code: 'reciprocal_stale',     message: "That reciprocal pair isn't available anymore." },
};

// Supabase PostgrestError shape: { code, message, details, hint }.
// For SECURITY DEFINER plpgsql `raise exception ... using errcode='P5xxx'`, the
// errcode lands in `.code`. We map it here.
export function pgErrorToResponse(err: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): Response {
  if (!err) return jsonResponse({ ok: false, code: 'server_error', message: 'Unknown server error.', errcode: undefined } satisfies ErrorBody, 500);

  const code = err.code as P5ErrorCode | undefined;
  if (code && MAP[code]) {
    const m = MAP[code];
    return jsonResponse(
      { ok: false, code: m.code, message: m.message, detail: err.details ?? undefined, errcode: code } satisfies ErrorBody,
      m.status,
    );
  }

  // Unknown errcode — fail-loud + log server-side
  console.error('match edge unmapped errcode', err.code, err.message, err.details, err.hint);
  return jsonResponse(
    { ok: false, code: 'server_error', message: 'Something went wrong. Please try again.', errcode: err.code, detail: err.message } satisfies ErrorBody,
    500,
  );
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return jsonResponse({ ok: true, data } satisfies SuccessBody<T>, 200, init);
}

export function jsonResponse(body: unknown, status: number, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
