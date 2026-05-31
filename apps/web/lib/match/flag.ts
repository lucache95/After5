import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@after5/types';

/**
 * Whether the current authenticated user may use the matching loop.
 *
 * Calls the `app_match_enabled_self()` RPC, whose result is
 *   global flag `match_v2_enabled` ON  OR  the user is in `match_cohort`.
 *
 * Use this on match/host pages instead of reading the raw `match_v2_enabled`
 * feature_config row, so a cohort works while the global flag stays OFF and the
 * UI gate matches the RPC gate. Fail-closed: any error means not enabled.
 */
export async function isMatchEnabledForViewer(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('app_match_enabled_self');
  if (error) return false;
  return data === true;
}
