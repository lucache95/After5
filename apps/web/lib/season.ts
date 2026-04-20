// Northern hemisphere meteorological seasons. Used for the homepage "Spring
// Edition" badge and for tagging itineraries at generation time so we can
// filter /dates by season later.

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export function getSeason(date: Date = new Date()): Season {
  const m = date.getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'spring';   // Mar, Apr, May
  if (m >= 5 && m <= 7) return 'summer';   // Jun, Jul, Aug
  if (m >= 8 && m <= 10) return 'fall';    // Sep, Oct, Nov
  return 'winter';                         // Dec, Jan, Feb
}

export const SEASON_LABELS: Record<Season, { name: string; sub: string }> = {
  spring: { name: 'Spring Edition', sub: 'Patios, blossom walks, golden-hour vineyards' },
  summer: { name: 'Summer Edition', sub: 'Beach days, sunset wineries, lake nights' },
  fall:   { name: 'Fall Edition',   sub: 'Harvest dinners, vineyard crush, fire-pit nights' },
  winter: { name: 'Winter Edition', sub: 'Cozy rooms, fondue, slope-side hot tubs' },
};
