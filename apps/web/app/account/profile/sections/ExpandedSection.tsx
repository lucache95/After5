'use client';
// M6 editor section: brand-fit expanded fields. All optional, anti-Tinder
// (no religion/politics/ethnicity). pronouns (segmented pills), height (stored
// in cm), occupation, spotify/tiktok handles. Validated by ExpandedProfileSchema
// at save time in ProfileEditor. Tier-1 shell chrome, lowercase, >=44px targets.
import { cn } from '@/lib/cn';
import { PronounsSchema, type ExpandedProfile, type Pronouns } from '@after5/validators';

const PRONOUN_OPTIONS = PronounsSchema.options;

export function ExpandedSection({
  value,
  onChange,
}: {
  value: ExpandedProfile;
  onChange: (next: ExpandedProfile) => void;
}) {
  const set = (patch: Partial<ExpandedProfile>) => onChange({ ...value, ...patch });
  const inputClass =
    'block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink placeholder:text-shell-ink/35 focus:outline-none focus:ring-2 focus:ring-shell-accent/60';
  const labelClass = 'mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink';

  return (
    <div className="space-y-5">
      <p className="font-body text-[13px] leading-relaxed text-shell-ink/60">
        all optional. share what feels like you.
      </p>

      {/* PRONOUNS */}
      <div>
        <span className={labelClass}>pronouns</span>
        <div role="group" aria-label="pronouns" className="flex flex-wrap gap-2">
          {PRONOUN_OPTIONS.map((opt) => {
            const active = value.pronouns === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                onClick={() => set({ pronouns: active ? undefined : (opt as Pronouns) })}
                className={cn(
                  'inline-flex min-h-[44px] items-center rounded-full px-4 font-body text-sm lowercase transition',
                  active
                    ? 'bg-shell-accent text-white shadow-fun'
                    : 'border border-shell-ink/15 bg-white/70 text-shell-ink hover:border-shell-accent/50',
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* HEIGHT */}
      <div>
        <label htmlFor="height_cm" className={labelClass}>height (cm)</label>
        <input
          id="height_cm"
          type="number"
          inputMode="numeric"
          min={120}
          max={230}
          value={value.height_cm ?? ''}
          onChange={(e) => set({ height_cm: e.target.value === '' ? undefined : Number(e.target.value) })}
          placeholder="optional"
          className={inputClass}
        />
      </div>

      {/* OCCUPATION */}
      <div>
        <label htmlFor="occupation" className={labelClass}>what you do</label>
        <input
          id="occupation"
          value={value.occupation ?? ''}
          onChange={(e) => set({ occupation: e.target.value || undefined })}
          maxLength={60}
          placeholder="barista, nurse, founder…"
          className={inputClass}
        />
      </div>

      {/* SOCIALS */}
      <div>
        <label htmlFor="spotify" className={labelClass}>spotify</label>
        <input
          id="spotify"
          value={value.socials?.spotify ?? ''}
          onChange={(e) => set({ socials: { ...value.socials, spotify: e.target.value || undefined } })}
          maxLength={60}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="username"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="tiktok" className={labelClass}>tiktok</label>
        <input
          id="tiktok"
          value={value.socials?.tiktok ?? ''}
          onChange={(e) => set({ socials: { ...value.socials, tiktok: e.target.value || undefined } })}
          maxLength={60}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="username"
          className={inputClass}
        />
      </div>
    </div>
  );
}
