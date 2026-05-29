'use client';
// Headless: subscribes to the viewer's notifications and fires a sonner toast on
// each new row (G, spec §3/§5). The toast action deeplinks via the per-type map.
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { subscribeNotifications, type NotificationRow } from '@/lib/after5/realtime';
import { NOTIF_META, hrefForNotification } from '@/lib/after5/notif-map';

export function NotificationToast({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    return subscribeNotifications(userId, (row: NotificationRow) => {
      const meta = NOTIF_META[row.type];
      const href = hrefForNotification(row.type, row.payload as Record<string, unknown>);
      toast(meta.label, { action: { label: 'view', onClick: () => router.push(href) } });
    });
  }, [userId, router]);
  return null;
}
