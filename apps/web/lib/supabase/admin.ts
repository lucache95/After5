// Server-only Supabase client using the service-role / secret key.
// Bypasses RLS — use ONLY in trusted server contexts (route handlers,
// server actions). NEVER import from a 'use client' file.
//
// We use this in /api/subscribe specifically because the email-gate
// flow needs anonymous upserts that cross-update existing rows
// (email → city → name across substeps). RLS for that table is locked
// down to insert-only for the anon role; the server endpoint mediates
// the rest using its elevated privileges, after validating inputs.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@after5/types';

let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Supabase admin client: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing');
  }
  cached = createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
