'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  Camera,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import type { VenueRow, FeedbackRow, PairingRow } from './page';
import { VenueEditPanel } from './venue-edit-panel';
import { LocalTime } from '@/components/LocalTime';

// ---------------------------------------------------------------------------
// Quality helpers
// ---------------------------------------------------------------------------

type Quality = 'green' | 'yellow' | 'red';

function venueQuality(v: VenueRow): Quality {
  const hasPhoto = !!(v.photo_url || v.daytime_photo_url || v.evening_photo_url);
  const hasInsight = !!v.local_insight;
  if (hasPhoto && hasInsight) return 'green';
  if (!hasPhoto && !hasInsight) return 'red';
  return 'yellow';
}

const QUALITY_RING: Record<Quality, string> = {
  green: 'border-l-emerald-400',
  yellow: 'border-l-amber-400',
  red: 'border-l-rose-400',
};

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'type' | 'feedback_score' | 'updated_at' | 'total_appearances';

function sortVenues(list: VenueRow[], key: SortKey, asc: boolean): VenueRow[] {
  const copy = [...list];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'type':
        cmp = a.type.localeCompare(b.type);
        break;
      case 'feedback_score':
        cmp = a.feedback_score - b.feedback_score;
        break;
      case 'updated_at':
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        break;
      case 'total_appearances':
        cmp = a.total_appearances - b.total_appearances;
        break;
    }
    return asc ? cmp : -cmp;
  });
  return copy;
}

// ---------------------------------------------------------------------------
// Extract unique values for filter dropdowns
// ---------------------------------------------------------------------------

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VenuesDashboard({
  venues: initialVenues,
  feedback,
  pairings,
}: {
  venues: VenueRow[];
  feedback: FeedbackRow[];
  pairings: PairingRow[];
}) {
  const [venues, setVenues] = useState(initialVenues);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterQuality, setFilterQuality] = useState('');
  const [filterVibe, setFilterVibe] = useState('');
  const [filterNeighborhood, setFilterNeighborhood] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Derive filter options
  const types = useMemo(() => unique(venues.map((v) => v.type)).sort(), [venues]);
  const vibes = useMemo(
    () => unique(venues.flatMap((v) => v.vibe_tags)).sort(),
    [venues],
  );
  const neighborhoods = useMemo(
    () => unique(venues.map((v) => v.neighborhood)).sort(),
    [venues],
  );

  // Filter + sort
  const filtered = useMemo(() => {
    let list = venues;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.neighborhood.toLowerCase().includes(q) ||
          v.slug.toLowerCase().includes(q),
      );
    }
    if (filterType) list = list.filter((v) => v.type === filterType);
    if (filterQuality) list = list.filter((v) => venueQuality(v) === filterQuality);
    if (filterVibe) list = list.filter((v) => v.vibe_tags.includes(filterVibe));
    if (filterNeighborhood) list = list.filter((v) => v.neighborhood === filterNeighborhood);

    return sortVenues(list, sortKey, sortAsc);
  }, [venues, search, filterType, filterQuality, filterVibe, filterNeighborhood, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => {
    const total = venues.length;
    const withPhoto = venues.filter(
      (v) => v.photo_url || v.daytime_photo_url || v.evening_photo_url,
    ).length;
    const withInsight = venues.filter((v) => v.local_insight).length;
    const withFeedback = venues.filter((v) => v.feedback_score > 0).length;
    const avgScore =
      venues.reduce((s, v) => s + v.feedback_score, 0) / (total || 1);
    const needsAttention = venues.filter((v) => venueQuality(v) !== 'green').length;
    return { total, withPhoto, withInsight, withFeedback, avgScore, needsAttention };
  }, [venues]);

  // Feedback map: place_id -> FeedbackRow[]
  const feedbackByPlace = useMemo(() => {
    const map = new Map<string, FeedbackRow[]>();
    for (const fb of feedback) {
      for (const pid of [fb.loved_place_id, fb.skipped_place_id]) {
        if (!pid) continue;
        const arr = map.get(pid) ?? [];
        arr.push(fb);
        map.set(pid, arr);
      }
    }
    return map;
  }, [feedback]);

  // Pairings map: place_id -> PairingRow[] (top pairings)
  const pairingsByPlace = useMemo(() => {
    const map = new Map<string, PairingRow[]>();
    for (const p of pairings) {
      for (const pid of [p.place_a, p.place_b]) {
        const arr = map.get(pid) ?? [];
        arr.push(p);
        map.set(pid, arr);
      }
    }
    return map;
  }, [pairings]);

  // Name lookup for pairings
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) m.set(v.id, v.name);
    return m;
  }, [venues]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function handleSaved(updated: VenueRow) {
    setVenues((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
  }

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortAsc ? (
        <ChevronUp className="inline h-3 w-3" />
      ) : (
        <ChevronDown className="inline h-3 w-3" />
      )
    ) : null;

  const hasAnyFilter = !!(search || filterType || filterQuality || filterVibe || filterNeighborhood);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-12 md:px-10 md:py-16">
      {/* Header */}
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Curator QA
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Venue quality
          </h1>
        </div>
        <p className="text-sm text-muted [font-variant-numeric:tabular-nums]">
          {filtered.length} of {stats.total} venues
        </p>
      </div>

      {/* Stats bar */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total venues" value={stats.total} />
        <StatCard
          label="With photos"
          value={`${Math.round((stats.withPhoto / (stats.total || 1)) * 100)}%`}
          sub={`${stats.withPhoto} / ${stats.total}`}
        />
        <StatCard
          label="With local insight"
          value={`${Math.round((stats.withInsight / (stats.total || 1)) * 100)}%`}
          sub={`${stats.withInsight} / ${stats.total}`}
        />
        <StatCard
          label="With feedback"
          value={`${Math.round((stats.withFeedback / (stats.total || 1)) * 100)}%`}
          sub={`${stats.withFeedback} / ${stats.total}`}
        />
        <StatCard
          label="Avg feedback"
          value={stats.avgScore.toFixed(1)}
        />
        <StatCard
          label="Needs attention"
          value={stats.needsAttention}
          warn={stats.needsAttention > 0}
        />
      </div>

      {/* Search & filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by name, neighborhood, or slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-card border border-border bg-background py-2 pl-10 pr-4 text-sm text-text placeholder:text-muted focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
          />
        </div>
        <FilterSelect
          value={filterType}
          onChange={setFilterType}
          placeholder="All types"
          options={types.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
        />
        <FilterSelect
          value={filterQuality}
          onChange={setFilterQuality}
          placeholder="All quality"
          options={[
            { value: 'green', label: 'Complete' },
            { value: 'yellow', label: 'Partial' },
            { value: 'red', label: 'Missing' },
          ]}
        />
        <FilterSelect
          value={filterVibe}
          onChange={setFilterVibe}
          placeholder="All vibes"
          options={vibes.map((v) => ({ value: v, label: v }))}
        />
        <FilterSelect
          value={filterNeighborhood}
          onChange={setFilterNeighborhood}
          placeholder="All neighborhoods"
          options={neighborhoods.map((n) => ({ value: n, label: n }))}
        />
        {hasAnyFilter && (
          <button
            onClick={() => {
              setSearch('');
              setFilterType('');
              setFilterQuality('');
              setFilterVibe('');
              setFilterNeighborhood('');
            }}
            className="flex items-center gap-1 rounded-pill px-3 py-2 text-xs font-medium text-muted hover:bg-surface hover:text-text"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-border bg-background">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              <th className="px-4 py-3 w-8"></th>
              <SortableHeader label="Name" col="name" current={sortKey} asc={sortAsc} onSort={handleSort} />
              <SortableHeader label="Type" col="type" current={sortKey} asc={sortAsc} onSort={handleSort} />
              <th className="px-4 py-3">Photo</th>
              <th className="px-4 py-3">Insight</th>
              <SortableHeader label="Score" col="feedback_score" current={sortKey} asc={sortAsc} onSort={handleSort} />
              <th className="px-4 py-3">Vibes</th>
              <th className="px-4 py-3">Status</th>
              <SortableHeader label="Appearances" col="total_appearances" current={sortKey} asc={sortAsc} onSort={handleSort} />
              <SortableHeader label="Updated" col="updated_at" current={sortKey} asc={sortAsc} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const q = venueQuality(v);
              const hasPhoto = !!(v.photo_url || v.daytime_photo_url || v.evening_photo_url);
              const isExpanded = expandedId === v.id;

              return (
                <VenueTableRow
                  key={v.id}
                  venue={v}
                  quality={q}
                  qualityRing={QUALITY_RING[q]}
                  hasPhoto={hasPhoto}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedId(isExpanded ? null : v.id)}
                  feedback={feedbackByPlace.get(v.id) ?? []}
                  pairings={pairingsByPlace.get(v.id) ?? []}
                  nameById={nameById}
                  onSaved={handleSaved}
                />
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-secondary">
            No venues match the current filters.
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold [font-variant-numeric:tabular-nums] ${
          warn ? 'text-amber-600' : 'text-text'
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-card border border-border bg-background px-3 py-2 text-sm text-text focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SortableHeader({
  label,
  col,
  current,
  asc,
  onSort,
}: {
  label: string;
  col: SortKey;
  current: SortKey;
  asc: boolean;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="px-4 py-3">
      <button
        onClick={() => onSort(col)}
        className="flex items-center gap-1 hover:text-text"
      >
        {label}
        {current === col &&
          (asc ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

function VenueTableRow({
  venue: v,
  quality,
  qualityRing,
  hasPhoto,
  isExpanded,
  onToggle,
  feedback,
  pairings,
  nameById,
  onSaved,
}: {
  venue: VenueRow;
  quality: Quality;
  qualityRing: string;
  hasPhoto: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  feedback: FeedbackRow[];
  pairings: PairingRow[];
  nameById: Map<string, string>;
  onSaved: (v: VenueRow) => void;
}) {
  const photoSrc = v.photo_url || v.daytime_photo_url || v.evening_photo_url;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-border border-l-4 transition-colors hover:bg-surface/60 ${qualityRing} ${
          isExpanded ? 'bg-surface/40' : ''
        }`}
      >
        <td className="px-4 py-3">
          {quality === 'green' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : quality === 'yellow' ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          )}
        </td>
        <td className="px-4 py-3 font-medium text-text">{v.name}</td>
        <td className="px-4 py-3 text-secondary capitalize">{v.type.replace(/_/g, ' ')}</td>
        <td className="px-4 py-3">
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={v.name}
              className="h-8 w-12 rounded object-cover"
            />
          ) : (
            <span className="flex h-8 w-12 items-center justify-center rounded bg-surface text-muted">
              <Camera className="h-4 w-4" />
            </span>
          )}
        </td>
        <td className="max-w-[200px] truncate px-4 py-3 text-secondary">
          {v.local_insight ? v.local_insight.slice(0, 60) + (v.local_insight.length > 60 ? '...' : '') : (
            <span className="text-muted italic">none</span>
          )}
        </td>
        <td className="px-4 py-3 [font-variant-numeric:tabular-nums]">
          {v.feedback_score > 0 ? v.feedback_score.toFixed(1) : (
            <span className="text-muted">--</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {v.vibe_tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-block rounded-pill bg-surface px-2 py-0.5 text-[10px] font-medium text-secondary"
              >
                {t}
              </span>
            ))}
            {v.vibe_tags.length > 3 && (
              <span className="text-[10px] text-muted">+{v.vibe_tags.length - 3}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              v.is_active
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-rose-100 text-rose-800'
            }`}
          >
            {v.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-3 [font-variant-numeric:tabular-nums]">{v.total_appearances}</td>
        <td className="px-4 py-3 text-xs text-muted [font-variant-numeric:tabular-nums]">
          <LocalTime iso={v.updated_at} opts={{ dateStyle: 'medium' }} />
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-border">
          <td colSpan={10} className="p-0">
            <VenueEditPanel
              venue={v}
              feedback={feedback}
              pairings={pairings}
              nameById={nameById}
              onSaved={onSaved}
              onClose={onToggle}
            />
          </td>
        </tr>
      )}
    </>
  );
}
