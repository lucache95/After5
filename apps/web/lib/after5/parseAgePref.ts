// Canonical age_pref parser (E4 / D-09). age_pref is an int4range column stored
// canonical as '[lo,hi)' (upper-EXCLUSIVE); savePreferences writes the inclusive
// '[lo,hi]' literal. This single parser hydrates BOTH onboarding and account prefs
// forms — extracted from onboarding/preferences/page.tsx so the upper-exclusive
// off-by-one (Pitfall 3) lives in exactly one place. Do NOT re-derive this.
//
// Handles both endings: '[25,40)' → { min: 25, max: 39 } (exclusive, subtract 1)
// and '[25,40]' → { min: 25, max: 40 } (inclusive). Bad input → sane default.
export function parseAgePref(raw: unknown): { min: number; max: number } {
  if (typeof raw !== 'string') return { min: 25, max: 40 };
  const m = raw.match(/^\[(\d+),(\d+)\)$/) ?? raw.match(/^\[(\d+),(\d+)\]$/);
  if (!m) return { min: 25, max: 40 };
  const lo = Number(m[1]);
  const hiRaw = Number(m[2]);
  const inclusiveHi = raw.endsWith(')') ? hiRaw - 1 : hiRaw;
  return { min: lo, max: inclusiveHi };
}
