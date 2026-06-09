'use client';
import type { ReactNode } from 'react';

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-shell-ink/30" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-shell-base p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="font-heading text-lg lowercase text-shell-ink">{title}</p>
          <button aria-label="close" onClick={onClose} className="min-h-[44px] px-2 text-shell-ink/60">
            done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
