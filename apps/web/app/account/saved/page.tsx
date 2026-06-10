// RETIRED (UX audit P2-F13, 2026-06-09): the saved-plans collection was the last
// planner-era surface. Bookmarking is collection behavior, not going-out behavior —
// the loop is generate → publish → browse → match. The saved_plans TABLE stays
// (post-date feedback tokens + admin eval read it); only the UI is gone. Old links
// land on /my-nights, the closest living surface.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SavedPlansRetired() {
  redirect('/my-nights');
}
