// Check whether the current user has saved a given itinerary.
// GET /api/saved-plans/check?id=<uuid> → { saved: boolean }
// Returns saved:false (200) for unauthenticated callers — no need to
// 401 here, the Save button just renders in the unsaved state.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ saved: false });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ saved: false });

  const { data } = await supabase
    .from('saved_plans')
    .select('id')
    .eq('user_id', user.id)
    .eq('itinerary_id', id)
    .maybeSingle();

  return NextResponse.json({ saved: !!data });
}
