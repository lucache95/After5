'use client';

import { useState } from 'react';
import {
  ExternalLink,
  Save,
  Heart,
  SkipForward,
  Link2,
  MessageCircle,
} from 'lucide-react';
import type { VenueRow, FeedbackRow, PairingRow } from './page';
import { HeartLoader } from '@/components/HeartLoader';
import { LocalTime } from '@/components/LocalTime';

// ---------------------------------------------------------------------------
// Constants (match database enums)
// ---------------------------------------------------------------------------

const EFFORT_OPTIONS = ['low', 'moderate', 'high'] as const;
const ENERGY_OPTIONS = ['low', 'medium', 'high'] as const;
const PERCEIVED_VALUE_OPTIONS = ['exceeds_price', 'matches', 'overpriced'] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VenueEditPanel({
  venue,
  feedback,
  pairings,
  nameById,
  onSaved,
  onClose,
}: {
  venue: VenueRow;
  feedback: FeedbackRow[];
  pairings: PairingRow[];
  nameById: Map<string, string>;
  onSaved: (v: VenueRow) => void;
  onClose: () => void;
}) {
  const [localInsight, setLocalInsight] = useState(venue.local_insight ?? '');
  const [vibeTags, setVibeTags] = useState(venue.vibe_tags.join(', '));
  const [pairingTags, setPairingTags] = useState(venue.pairing_tags.join(', '));
  const [effort, setEffort] = useState(venue.effort);
  const [energy, setEnergy] = useState(venue.energy);
  const [perceivedValue, setPerceivedValue] = useState(venue.perceived_value ?? '');
  const [timeOfDay, setTimeOfDay] = useState(venue.time_of_day.join(', '));
  const [isActive, setIsActive] = useState(venue.is_active);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);

    const payload: Record<string, unknown> = {
      id: venue.id,
      local_insight: localInsight || null,
      vibe_tags: vibeTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      pairing_tags: pairingTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      effort,
      energy,
      perceived_value: perceivedValue || null,
      time_of_day: timeOfDay
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      is_active: isActive,
    };

    try {
      const res = await fetch('/api/admin/venues', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Save failed');
      } else {
        setSaved(true);
        // Update the parent state with new values
        onSaved({
          ...venue,
          local_insight: payload.local_insight as string | null,
          vibe_tags: payload.vibe_tags as string[],
          pairing_tags: payload.pairing_tags as string[],
          effort: payload.effort as string,
          energy: payload.energy as string,
          perceived_value: payload.perceived_value as string | null,
          time_of_day: payload.time_of_day as string[],
          is_active: payload.is_active as boolean,
          updated_at: new Date().toISOString(),
        });
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  // Derive pairing partner names
  const topPairings = pairings
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 6)
    .map((p) => {
      const partnerId = p.place_a === venue.id ? p.place_b : p.place_a;
      return {
        name: nameById.get(partnerId) ?? partnerId.slice(0, 8),
        appearances: p.appearances,
        loved: p.loved,
      };
    });

  // Feedback: how many loved / skipped
  const lovedCount = feedback.filter((f) => f.loved_place_id === venue.id).length;
  const skippedCount = feedback.filter((f) => f.skipped_place_id === venue.id).length;
  const recentFeedback = feedback
    .filter((f) => f.loved_place_id === venue.id || f.skipped_place_id === venue.id)
    .slice(0, 5);

  const googleLink = venue.google_place_id
    ? `https://www.google.com/maps/place/?q=place_id:${venue.google_place_id}`
    : null;
  const publicLink = `/places/${venue.slug}`;

  return (
    <div className="border-t border-border bg-surface/50 px-6 py-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        {/* Left: Edit form */}
        <div className="space-y-5">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-display text-lg font-semibold text-text">{venue.name}</h3>
            <span className="text-xs text-muted">{venue.neighborhood}</span>
          </div>

          {/* Reference links */}
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              href={publicLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent"
            >
              <Link2 className="h-3 w-3" /> After5 page
            </a>
            {googleLink && (
              <a
                href={googleLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent underline decoration-accent/40 underline-offset-[4px] hover:decoration-accent"
              >
                <ExternalLink className="h-3 w-3" /> Google Places
              </a>
            )}
          </div>

          {/* Local insight */}
          <Field label="Local insight">
            <textarea
              value={localInsight}
              onChange={(e) => setLocalInsight(e.target.value)}
              rows={3}
              className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-muted focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
              placeholder="What makes this place special for a date..."
            />
          </Field>

          {/* Tags row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vibe tags (comma-separated)">
              <input
                type="text"
                value={vibeTags}
                onChange={(e) => setVibeTags(e.target.value)}
                className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm text-text focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
                placeholder="romantic, cozy, lively"
              />
            </Field>
            <Field label="Pairing tags (comma-separated)">
              <input
                type="text"
                value={pairingTags}
                onChange={(e) => setPairingTags(e.target.value)}
                className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm text-text focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
                placeholder="wine, sunset, dessert"
              />
            </Field>
          </div>

          {/* Enum selects */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Effort">
              <EnumSelect value={effort} onChange={setEffort} options={EFFORT_OPTIONS} />
            </Field>
            <Field label="Energy">
              <EnumSelect value={energy} onChange={setEnergy} options={ENERGY_OPTIONS} />
            </Field>
            <Field label="Perceived value">
              <EnumSelect
                value={perceivedValue}
                onChange={setPerceivedValue}
                options={PERCEIVED_VALUE_OPTIONS}
                allowEmpty
              />
            </Field>
            <Field label="Time of day">
              <input
                type="text"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm text-text focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
                placeholder="afternoon, evening"
              />
            </Field>
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-text"
            />
            <span className="text-sm text-text">Active (included in plan generation)</span>
          </label>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-pill bg-text px-5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <HeartLoader size={16} color="currentColor" accessibilityLabel="saving venue" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </button>
            {saved && (
              <span className="text-sm font-medium text-emerald-600">Saved</span>
            )}
            {error && (
              <span className="text-sm font-medium text-rose-600">{error}</span>
            )}
            <button
              onClick={onClose}
              className="ml-auto text-xs text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </div>

        {/* Right: Stats sidebar */}
        <div className="space-y-6 border-l border-border pl-6 lg:pl-8">
          {/* Usage stats */}
          <div>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Usage stats
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="Appearances" value={venue.total_appearances} />
              <MiniStat label="Loved" value={venue.total_loved} icon={<Heart className="h-3 w-3 text-rose-400" />} />
              <MiniStat label="Skipped" value={venue.total_skipped} icon={<SkipForward className="h-3 w-3 text-amber-400" />} />
            </div>
          </div>

          {/* Top pairings */}
          {topPairings.length > 0 && (
            <div>
              <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                Top pairings
              </h4>
              <ul className="space-y-1.5">
                {topPairings.map((p, i) => (
                  <li key={i} className="flex items-center justify-between text-xs">
                    <span className="text-text truncate max-w-[180px]">{p.name}</span>
                    <span className="text-muted [font-variant-numeric:tabular-nums]">
                      {p.appearances}x
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recent feedback */}
          <div>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Feedback ({lovedCount} loved, {skippedCount} skipped)
            </h4>
            {recentFeedback.length === 0 ? (
              <p className="text-xs text-muted italic">No feedback yet</p>
            ) : (
              <ul className="space-y-2">
                {recentFeedback.map((f) => (
                  <li key={f.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      {f.loved_place_id === venue.id ? (
                        <Heart className="h-3 w-3 text-rose-400" />
                      ) : (
                        <SkipForward className="h-3 w-3 text-amber-400" />
                      )}
                      <LocalTime
                        iso={f.created_at}
                        opts={{ dateStyle: 'medium' }}
                        className="text-muted"
                      />
                      {f.pacing_rating && (
                        <span className="text-secondary">pacing: {f.pacing_rating}</span>
                      )}
                    </div>
                    {f.free_text && (
                      <p className="mt-1 flex items-start gap-1 text-secondary">
                        <MessageCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted" />
                        {f.free_text.slice(0, 120)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function EnumSelect({
  value,
  onChange,
  options,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm text-text focus:border-text focus:outline-none focus:ring-1 focus:ring-text"
    >
      {allowEmpty && <option value="">--</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-background px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className="text-base font-semibold text-text [font-variant-numeric:tabular-nums]">
          {value}
        </span>
      </div>
      <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted">{label}</p>
    </div>
  );
}
