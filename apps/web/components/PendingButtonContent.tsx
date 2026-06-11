import type { ReactNode } from 'react';
import { HeartLoader } from '@/components/HeartLoader';
import { cn } from '@/lib/cn';

interface PendingButtonContentProps {
  pending: boolean;
  pendingLabel: ReactNode;
  children?: ReactNode;
  accessibilityLabel?: string;
  size?: number;
  className?: string;
}

export function PendingButtonContent({
  pending,
  pendingLabel,
  children,
  accessibilityLabel,
  size = 16,
  className,
}: PendingButtonContentProps) {
  if (!pending) return <>{children}</>;

  return (
    <span className={cn('inline-flex items-center justify-center gap-2', className)}>
      <HeartLoader
        size={size}
        color="currentColor"
        accessibilityLabel={accessibilityLabel ?? String(pendingLabel)}
      />
      <span>{pendingLabel}</span>
    </span>
  );
}
