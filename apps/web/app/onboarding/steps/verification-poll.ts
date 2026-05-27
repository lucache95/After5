// Read the caller's verification state. Extracted so the status screen can be
// unit-tested without a live Supabase client.
import { browserAfter5Client } from '@/lib/after5/client';
import type { VerificationState } from '@after5/validators';

export async function readVerification(): Promise<VerificationState> {
  const client = browserAfter5Client();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return 'unverified';
  const { data } = await client.from('profiles').select('verification').eq('id', user.id).maybeSingle();
  return (data?.verification ?? 'unverified') as VerificationState;
}
