// M6 read-only profile card shown on the reveal surface (post-lock). Tier-3
// neutral surface per DESIGN-SYSTEM §1/§8 — mobile-first, no AI-slop. Renders a
// native scroll-snap photo carousel (no new dependency), name+age heading,
// pronouns, place, labelled prompt cards, and vibe sticker chips. NO PII
// (instagram/email) unless explicitly passed by the post-reveal caller.
import Image from 'next/image';
import { Polaroid } from '@/components/Polaroid';

export interface ProfileCardPrompt {
  label: string;
  answer: string;
}

export interface ProfileCardProps {
  name: string;
  age: number | null;
  place: string | null;
  pronouns?: string | null;
  occupation?: string | null;
  height_cm?: number | null;
  photos: string[]; // signed clear URLs, primary first
  vibe_tags: string[];
  prompts: ProfileCardPrompt[];
  // Post-reveal contact, only when the caller decides to surface it.
  instagram_handle?: string | null;
}

export function ProfileCard({
  name,
  age,
  place,
  pronouns,
  occupation,
  height_cm,
  photos,
  vibe_tags,
  prompts,
  instagram_handle,
}: ProfileCardProps) {
  const heading = age != null ? `${name}, ${age}` : name;
  const meta = [place, pronouns, occupation, height_cm ? `${height_cm} cm` : null].filter(Boolean) as string[];

  return (
    <article className="mx-auto w-full max-w-[420px] overflow-hidden rounded-3xl bg-profile-base text-profile-ink shadow-fun">
      {/* PHOTOS */}
      {photos.length === 0 ? (
        <div className="flex justify-center bg-profile-base px-5 pt-6">
          <Polaroid src={null} alt={name} label={name.toLowerCase()} size="xl" tone="dating" />
        </div>
      ) : photos.length === 1 ? (
        <div className="flex justify-center bg-profile-base px-5 pt-6">
          <Polaroid src={photos[0]} alt={name} size="xl" tone="dating" />
        </div>
      ) : (
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label={`${name}'s photos`}
        >
          {photos.map((url, i) => (
            <div key={url} className="relative aspect-[4/5] w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl bg-shell-pink/30">
              <Image src={url} alt={i === 0 ? name : `${name}, photo ${i + 1}`} fill sizes="320px" className="object-cover" />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-5 p-5">
        {/* IDENTITY */}
        <header>
          <h2 className="font-heading text-3xl lowercase text-profile-ink">{heading}</h2>
          {meta.length > 0 && (
            <p className="mt-1 font-body text-[14px] lowercase text-profile-ink/60">{meta.join(' · ')}</p>
          )}
        </header>

        {/* VIBE CHIPS */}
        {vibe_tags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="vibe tags">
            {vibe_tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full bg-profile-ink/[0.06] px-3 py-1 font-body text-[13px] lowercase text-profile-ink/80"
              >
                {tag.toLowerCase()}
              </li>
            ))}
          </ul>
        )}

        {/* PROMPTS */}
        {prompts.length > 0 && (
          <div className="space-y-3">
            {prompts.map((p) => (
              <div key={p.label} className="rounded-2xl bg-profile-ink/[0.04] p-4">
                <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-profile-ink/45">{p.label}</p>
                <p className="mt-1.5 font-body text-[16px] leading-relaxed text-profile-ink">{p.answer}</p>
              </div>
            ))}
          </div>
        )}

        {/* OPTIONAL POST-REVEAL CONTACT */}
        {instagram_handle && (
          <p className="font-body text-[14px] lowercase text-profile-ink/70">@{instagram_handle}</p>
        )}
      </div>
    </article>
  );
}
