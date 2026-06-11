'use client';
// M3.5 — add a real venue we don't carry to your night. Searches via the
// /api/places/search proxy (server-side Google Places; key never reaches the
// client) and lets the host add a result as an inline custom stop. If the proxy
// returns 503 (no key provisioned), we say search isn't available yet.
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Stop } from '@/lib/itinerary-types';

export function CustomVenueSearch({
  onAdd,
  actionLabel = 'add to plan',
}: {
  onAdd: (stop: Stop) => void;
  /** Label on each result's action button — the stop-location picker reuses
   * this surface with "use this place". */
  actionLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setUnavailable(false);
    setSearched(true);
    try {
      const res = await fetch('/api/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (res.status === 503) {
        setUnavailable(true);
        setResults([]);
        return;
      }
      if (!res.ok) {
        setResults([]);
        return;
      }
      const body = (await res.json()) as { results?: Stop[] };
      setResults(body.results ?? []);
    } catch (err) {
      console.error('[editor] place search failed', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          aria-label="search for a place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
          placeholder="a quiet coffee shop, that taco spot..."
          className="min-h-[44px] w-full rounded-full border border-shell-ink/15 bg-white/70 px-4 font-body text-sm text-shell-ink placeholder:text-shell-ink/35 focus:border-shell-accent/60 focus:outline-none focus:ring-2 focus:ring-shell-accent/20"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-shell-accent px-5 font-body text-sm lowercase text-white shadow-fun transition hover:opacity-90 disabled:opacity-50"
        >
          <Search className="h-4 w-4" aria-hidden />
          search
        </button>
      </div>

      {unavailable && (
        <p className="mt-3 font-body text-sm text-shell-ink/60">
          custom venue search isn’t available yet.
        </p>
      )}

      {!unavailable && searched && !searching && results.length === 0 && (
        <p className="mt-3 font-body text-sm text-shell-ink/60">
          no places found. try another search.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((stop) => (
            <li
              key={stop.place_id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-shell-ink/12 bg-white/70 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-body text-sm font-medium lowercase text-shell-ink">
                  {stop.place_name}
                </p>
                {stop.address && (
                  <p className="truncate font-body text-xs text-shell-ink/55">{stop.address}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onAdd(stop)}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-shell-accent/40 px-4 font-body text-xs lowercase text-shell-accent transition hover:bg-shell-accent/10"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
