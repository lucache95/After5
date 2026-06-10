// Greedy re-spacing pass: walk the ordered feed and ensure no two back-to-back
// nights share the same non-null ambient_sound_path. When item[i] would follow
// item[i-1] with the same path, find the nearest later item that has a different
// path and swap it forward. If no such item exists (e.g. every remaining night
// shares the same sound) the conflict is left in place rather than degrading
// ranking further — the deck stays listenable, just not perfectly spaced.
//
// Key rules:
//  - The function is pure (no mutation of the input array elements).
//  - Ranking is preserved as much as possible: a single targeted swap, not a full
//    shuffle. The first element never moves.
//  - null / absent ambient_sound_path is treated as "no sound" — nulls are always
//    allowed as neighbours of anything, including other nulls.

import type { FeedNight } from '@after5/api-client';

export function spaceBySound(nights: FeedNight[]): FeedNight[] {
  if (nights.length < 2) return nights;

  const arr = nights.slice(); // shallow copy — we only swap references

  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1]!.ambient_sound_path;
    const curr = arr[i]!.ambient_sound_path;

    // null/absent is always allowed next to anything.
    if (!prev || !curr || prev !== curr) continue;

    // Find the nearest later index whose sound differs from prev.
    let swapIdx = -1;
    for (let j = i + 1; j < arr.length; j++) {
      const candidate = arr[j]!.ambient_sound_path;
      if (!candidate || candidate !== prev) {
        swapIdx = j;
        break;
      }
    }

    if (swapIdx === -1) continue; // no suitable swap candidate; leave as-is

    // Swap arr[i] and arr[swapIdx].
    const tmp = arr[i]!;
    arr[i] = arr[swapIdx]!;
    arr[swapIdx] = tmp;
  }

  return arr;
}
