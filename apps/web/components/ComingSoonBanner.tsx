// Rendered when match_v2_enabled is off. Tier-1 Barbiecore shell surface,
// funny-not-helpful copy (DESIGN-SYSTEM §3), phone-width column.
import { cn } from '@/lib/cn';

export function ComingSoonBanner({ note, className }: { note?: string; className?: string }) {
  return (
    <main
      className={cn(
        'flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center',
        className,
      )}
    >
      <div className="mx-auto max-w-[420px]">
        <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">
          matching launches soon
        </h1>
        <p className="mt-4 font-body text-lg text-shell-ink/70">
          {note ?? 'we’re still wiring the good part. check back.'}
        </p>
      </div>
    </main>
  );
}
