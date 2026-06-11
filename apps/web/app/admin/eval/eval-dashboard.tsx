'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  TrendingUp,
  Bookmark,
  ThumbsUp,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { HeartLoader } from '@/components/HeartLoader';
import { LocalTime } from '@/components/LocalTime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackEntry {
  name: string;
  activations: number;
  saveRate: number;
}

interface VenueEntry {
  placeId: string;
  name: string;
  appearances: number;
  loved: number;
  skipped: number;
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface WorstDate {
  id: string;
  title: string;
  slug: string | null;
  qualityScore: number | null;
  generatedAt: string;
  stopNames: string[];
}

interface EvalData {
  period: string;
  totalGens: number;
  avgQuality: number | null;
  saveRate: number;
  totalSaves: number;
  feedbackPositivity: number | null;
  totalFeedback: number;
  packBreakdown: PackEntry[];
  venueFrequency: VenueEntry[];
  worstDates: WorstDate[];
}

type Period = '7d' | '30d' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalDashboard() {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<EvalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/admin/eval?period=${period}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((json: EvalData) => {
        if (!cancelled) setData(json);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-12 md:px-10 md:py-16">
      {/* Header */}
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Curator analytics
          </p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-5xl">
            Generation quality
          </h1>
        </div>

        {/* Period tabs */}
        <div className="flex items-center gap-1 rounded-card border border-border bg-surface p-1">
          {(['7d', '30d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-[8px] px-4 py-1.5 text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-background text-text shadow-sm'
                  : 'text-secondary hover:text-text'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error states */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <HeartLoader size={24} className="text-muted" accessibilityLabel="loading metrics" />
          <span className="ml-2 text-sm text-muted">Loading metrics...</span>
        </div>
      )}

      {error && (
        <div className="rounded-card border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
          Failed to load evaluation data ({error}).
        </div>
      )}

      {data && !loading && (
        <>
          {/* Row 1: Key metric cards */}
          <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={BarChart3}
              label="Total generations"
              value={data.totalGens.toLocaleString()}
              sub={PERIOD_LABELS[period]}
            />
            <StatCard
              icon={TrendingUp}
              label="Avg quality score"
              value={data.avgQuality !== null ? data.avgQuality.toFixed(1) : '--'}
              sub={data.avgQuality !== null ? `of 10` : 'No scores yet'}
              warn={data.avgQuality !== null && data.avgQuality < 6}
            />
            <StatCard
              icon={Bookmark}
              label="Save rate"
              value={`${data.saveRate}%`}
              sub={`${data.totalSaves} saves / ${data.totalGens} gens`}
            />
            <StatCard
              icon={ThumbsUp}
              label="Feedback positivity"
              value={
                data.feedbackPositivity !== null ? `${data.feedbackPositivity}%` : '--'
              }
              sub={
                data.totalFeedback > 0
                  ? `${data.totalFeedback} responses`
                  : 'No feedback yet'
              }
              warn={data.feedbackPositivity !== null && data.feedbackPositivity < 60}
            />
          </div>

          {/* Row 2: Editorial pack effectiveness */}
          {data.packBreakdown.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-4 font-display text-lg font-semibold text-text">
                Editorial pack effectiveness
              </h2>
              <div className="rounded-card border border-border bg-background p-6">
                <div className="space-y-3">
                  {data.packBreakdown.map((pack) => {
                    const maxActivations = Math.max(
                      ...data.packBreakdown.map((p) => p.activations),
                    );
                    const barPct =
                      maxActivations > 0
                        ? Math.max(4, Math.round((pack.activations / maxActivations) * 100))
                        : 0;
                    const bestSaveRate = Math.max(
                      ...data.packBreakdown.map((p) => p.saveRate),
                    );
                    const isBest =
                      pack.saveRate === bestSaveRate && pack.activations > 0;

                    return (
                      <div key={pack.name} className="flex items-center gap-4">
                        <div className="w-36 shrink-0 truncate text-sm font-medium text-text">
                          {pack.name}
                        </div>
                        <div className="flex-1">
                          <div className="h-6 w-full rounded bg-surface">
                            <div
                              className="flex h-6 items-center rounded bg-accent/20 px-2 text-xs font-medium text-text transition-all duration-300"
                              style={{ width: `${barPct}%` }}
                            >
                              {pack.activations}
                            </div>
                          </div>
                        </div>
                        <div className="flex w-28 shrink-0 items-center gap-2 text-right text-sm">
                          <span className="text-muted">save:</span>
                          <span
                            className={`font-semibold [font-variant-numeric:tabular-nums] ${
                              isBest ? 'text-emerald-600' : 'text-text'
                            }`}
                          >
                            {pack.saveRate}%
                          </span>
                          {isBest && (
                            <span className="rounded-pill bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-800">
                              Best
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* Row 3: Venue health */}
          {data.venueFrequency.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-4 font-display text-lg font-semibold text-text">
                Venue health
              </h2>
              <div className="overflow-x-auto rounded-card border border-border bg-background">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                      <th className="px-4 py-3">Venue</th>
                      <th className="px-4 py-3">Appearances</th>
                      <th className="px-4 py-3">Loved</th>
                      <th className="px-4 py-3">Skipped</th>
                      <th className="px-4 py-3">Sentiment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.venueFrequency.map((v) => (
                      <tr
                        key={v.placeId}
                        className="border-b border-border transition-colors hover:bg-surface/60"
                      >
                        <td className="px-4 py-3 font-medium text-text">{v.name}</td>
                        <td className="px-4 py-3 [font-variant-numeric:tabular-nums]">
                          {v.appearances}
                        </td>
                        <td className="px-4 py-3 [font-variant-numeric:tabular-nums]">
                          {v.loved}
                        </td>
                        <td className="px-4 py-3 [font-variant-numeric:tabular-nums]">
                          {v.skipped}
                        </td>
                        <td className="px-4 py-3">
                          <SentimentBadge sentiment={v.sentiment} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Row 4: Bottom 5 worst dates */}
          {data.worstDates.length > 0 && (
            <section className="mb-8">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="font-display text-lg font-semibold text-text">
                  Bottom 5 dates by quality
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {data.worstDates.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-card border border-border bg-background p-5 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 text-sm font-semibold text-text">
                        {d.title}
                      </h3>
                      <span className="shrink-0 rounded-pill bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 [font-variant-numeric:tabular-nums]">
                        {d.qualityScore?.toFixed(1)}
                      </span>
                    </div>
                    <p className="mb-2 text-xs text-muted">
                      <LocalTime iso={d.generatedAt} opts={{ dateStyle: 'medium' }} />
                    </p>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {d.stopNames.map((name, i) => (
                        <span
                          key={i}
                          className="inline-block rounded-pill bg-surface px-2 py-0.5 text-[10px] font-medium text-secondary"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                    <Link
                      href={`/admin/dates/${d.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent"
                    >
                      Review <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {data.totalGens === 0 && (
            <div className="rounded-card border border-border bg-surface p-10 text-center text-sm text-secondary">
              No generations found for this period. Try expanding the time range.
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" />
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
          {label}
        </p>
      </div>
      <p
        className={`text-2xl font-semibold [font-variant-numeric:tabular-nums] ${
          warn ? 'text-amber-600' : 'text-text'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  const config = {
    positive: {
      label: 'Positive',
      className: 'bg-emerald-100 text-emerald-800',
    },
    neutral: {
      label: 'No data',
      className: 'bg-surface text-muted',
    },
    negative: {
      label: 'Negative',
      className: 'bg-rose-100 text-rose-800',
    },
  } as const;

  const c = config[sentiment];
  return (
    <span
      className={`inline-block rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${c.className}`}
    >
      {c.label}
    </span>
  );
}
