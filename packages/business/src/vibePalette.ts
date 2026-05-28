export interface VibePalette {
  bg: string;     // background hex
  accent: string; // primary accent hex
  ink: string;    // text/icon hex
}

// Default: soft Barbiecore-neutral — dusty rose surface, deep berry accent, near-black ink.
const DEFAULT: VibePalette = { bg: '#FAE6EF', accent: '#B5286A', ink: '#1A0A12' };

/** Ordered keyword → palette entries. First match (any tag, case-insensitive substring) wins. */
const KEYWORD_PALETTES: Array<{ keywords: string[]; palette: VibePalette }> = [
  // Nightlife / music — midnight-blue bg, warm amber accent, off-white ink
  {
    keywords: ['jazz', 'bar', 'music', 'nightlife'],
    palette: { bg: '#0E1A2B', accent: '#E8A838', ink: '#F5F0E8' },
  },
  // Outdoor / warm — peachy-coral bg, deep terracotta accent, dark brown ink
  {
    keywords: ['beach', 'picnic', 'outdoor', 'sunset'],
    palette: { bg: '#FDE8DC', accent: '#C94B2C', ink: '#2B1206' },
  },
  // Craft / tactile — warm clay bg, burnt sienna accent, deep brown ink
  {
    keywords: ['pottery', 'craft', 'art', 'paint', 'workshop'],
    palette: { bg: '#EDD9C0', accent: '#A0431E', ink: '#2A150A' },
  },
  // Cafe — soft latte bg, espresso brown accent, near-black ink
  {
    keywords: ['coffee', 'cafe', 'brunch'],
    palette: { bg: '#F5ECD7', accent: '#6B3A2A', ink: '#1C0E07' },
  },
  // Active / outdoors — fresh sage green bg, deep forest accent, near-black ink
  {
    keywords: ['active', 'hike', 'sport', 'climb'],
    palette: { bg: '#D4EDDA', accent: '#1B5E34', ink: '#0A1F10' },
  },
];

/**
 * Maps vibe_tags to a Tier-2 mood palette for experience-card surfaces.
 * Matching is case-insensitive substring; first matching tag wins.
 * Returns DEFAULT Barbiecore-neutral palette when no tag matches.
 */
export function vibePalette(vibeTags: string[] | null | undefined): VibePalette {
  if (!vibeTags || vibeTags.length === 0) return DEFAULT;

  for (const tag of vibeTags) {
    const lower = tag.toLowerCase();
    for (const { keywords, palette } of KEYWORD_PALETTES) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return palette;
      }
    }
  }

  return DEFAULT;
}
