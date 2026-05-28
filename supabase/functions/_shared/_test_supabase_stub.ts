// supabase/functions/_shared/_test_supabase_stub.ts
// TEST-ONLY stand-in for `@supabase/supabase-js`. Wired in via _test_import_map.json
// so `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'`
// resolves here during `deno test`. NOT shipped — referenced only by the import map.
//
// Behavior is driven by `globalThis.__SB_STUB__` so each test can script:
//   - getUser() result (authed user id, or an auth error)
//   - rpc() result per rpc name (data or PostgrestError-shaped { code, message })
//   - a recorder capturing every rpc call ({ name, args }) for arg-shaping assertions.

export type RpcResult = { data?: unknown; error?: { code?: string; message?: string; details?: string } | null };

export type StubConfig = {
  user?: { id: string } | null;
  userError?: { message: string } | null;
  // map rpcName -> result; default success {data:null,error:null}
  rpc?: Record<string, RpcResult>;
  // populated by the stub: every rpc invocation in call order
  calls: Array<{ name: string; args: Record<string, unknown> }>;
};

function cfg(): StubConfig {
  const g = globalThis as unknown as { __SB_STUB__?: StubConfig };
  if (!g.__SB_STUB__) g.__SB_STUB__ = { calls: [] };
  return g.__SB_STUB__;
}

export function resetStub(next: Partial<StubConfig> = {}): StubConfig {
  const fresh: StubConfig = { user: { id: 'test-user-id' }, userError: null, rpc: {}, calls: [], ...next };
  (globalThis as unknown as { __SB_STUB__?: StubConfig }).__SB_STUB__ = fresh;
  return fresh;
}

// Minimal SupabaseClient surface used by match.ts: .auth.getUser() and .rpc().
export class SupabaseClient {
  auth = {
    getUser: () => {
      const c = cfg();
      if (c.userError) return Promise.resolve({ data: { user: null }, error: c.userError });
      return Promise.resolve({ data: { user: c.user ?? null }, error: null });
    },
  };
  rpc(name: string, args: Record<string, unknown>) {
    const c = cfg();
    c.calls.push({ name, args });
    const r = c.rpc?.[name] ?? { data: null, error: null };
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  }
}

export function createClient(_url: string, _key: string, _opts?: unknown): SupabaseClient {
  return new SupabaseClient();
}
