'use client';
import { Drawer } from 'vaul';
import { Polaroid } from '@/components/Polaroid';
import type { PartyProfile } from '../lock-view';

export function RevealModal({
  open, onOpenChange, person,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  person: PartyProfile;
}) {
  const name = person.first_name ?? 'your match';
  const place = person.neighborhood ?? person.city ?? null;
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          aria-label={`profile of ${name}`}
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-shell-base p-6 pb-10 outline-none"
        >
          <Drawer.Title className="sr-only">{name}&apos;s profile</Drawer.Title>
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
          <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
            <Polaroid src={person.clear_photo_url ?? ''} alt={name} size="lg" tone="dating" />
            <h2 className="mt-4 font-heading text-3xl lowercase text-shell-ink">
              {name}{person.age != null ? `, ${person.age}` : ''}
            </h2>
            {place && <p className="mt-1 font-body text-shell-ink/70">{place.toLowerCase()}</p>}
            {person.vibe_tags.length > 0 && (
              <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="vibe tags">
                {person.vibe_tags.map((tag) => (
                  <li key={tag} className="rounded-full bg-shell-pink px-3 py-1 font-body text-sm lowercase text-shell-ink">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
