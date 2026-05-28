export type FeedTier = 'empty' | 'thin' | 'live';
export interface FeedCounts { compatibleOpen: number; totalOpen: number; }

// 0 compatible -> empty (show "lining up Kelowna"); <5 -> thin; otherwise live.
export function feedColdStartTier({ compatibleOpen }: FeedCounts): FeedTier {
  if (compatibleOpen <= 0) return 'empty';
  if (compatibleOpen < 5) return 'thin';
  return 'live';
}
