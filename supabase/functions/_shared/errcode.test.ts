// supabase/functions/_shared/errcode.test.ts
// Table-test the Postgres-errcode → HTTP-status + UI-code mapping.
// These rows are the source of truth verified against errcode.ts MAP and must match
// the architecture spec (§4.1). Every P5xxx code raised by an RPC lands in
// PostgrestError.code; pgErrorToResponse maps it. Unknown/null codes → 500.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { pgErrorToResponse, ok, jsonResponse } from './errcode.ts';

type Row = { code: string; status: number; uiCode: string };

// VERIFIED against errcode.ts MAP:
const ROWS: Row[] = [
  { code: 'P5000', status: 503, uiCode: 'feature_disabled' },
  { code: 'P5001', status: 401, uiCode: 'auth_mismatch' },
  { code: 'P5002', status: 409, uiCode: 'account_gated' },
  { code: 'P5003', status: 409, uiCode: 'offer_already_active' },
  { code: 'P5004', status: 409, uiCode: 'time_conflict' },
  { code: 'P5005', status: 425, uiCode: 'chat_not_ready' },
  { code: 'P5007', status: 410, uiCode: 'offer_expired' },
  { code: 'P5008', status: 409, uiCode: 'reciprocal_pending' },
  { code: 'P5009', status: 409, uiCode: 'reciprocal_stale' },
];

for (const row of ROWS) {
  Deno.test(`pgErrorToResponse maps ${row.code} -> ${row.status}/${row.uiCode}`, async () => {
    const res = pgErrorToResponse({ code: row.code, message: 'pg raised', details: 'd1' });
    assertEquals(res.status, row.status);
    const body = await res.json();
    assertEquals(body.ok, false);
    assertEquals(body.code, row.uiCode);
    assertEquals(body.errcode, row.code);
    // detail carries err.details through
    assertEquals(body.detail, 'd1');
    // a human-facing message is always present
    assertEquals(typeof body.message, 'string');
  });
}

Deno.test('pgErrorToResponse: unknown errcode -> 500 server_error (fail-loud)', async () => {
  const res = pgErrorToResponse({ code: 'P9999', message: 'boom', details: 'x', hint: 'h' });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.code, 'server_error');
  // raw errcode preserved for debugging
  assertEquals(body.errcode, 'P9999');
});

Deno.test('pgErrorToResponse: null/undefined error -> 500 server_error', async () => {
  const res = pgErrorToResponse(null);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, 'server_error');
});

Deno.test('pgErrorToResponse: error with no .code -> 500 (treated as unknown)', async () => {
  const res = pgErrorToResponse({ message: 'plain js error' });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, 'server_error');
});

Deno.test('ok(): wraps data in {ok:true,data} at HTTP 200', async () => {
  const res = ok({ offer_id: 'abc' });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.data.offer_id, 'abc');
});

Deno.test('jsonResponse(): sets content-type json + given status', async () => {
  const res = jsonResponse({ hello: 'world' }, 418);
  assertEquals(res.status, 418);
  assertEquals(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assertEquals(body.hello, 'world');
});
