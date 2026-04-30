import { useEffect, useRef } from 'react';
import { AUTO_SYNC_INTERVAL_MS, triggerSync } from './api';

export function useAutoSync(onSync: () => Promise<void>): void {
  const syncInFlightRef = useRef(false);
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    let cancelled = false;

    async function syncAndRefresh() {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        await triggerSync().catch(() => undefined);
        if (!cancelled) {
          await onSyncRef.current();
        }
      } finally {
        syncInFlightRef.current = false;
      }
    }

    void syncAndRefresh();
    const interval = setInterval(() => {
      void syncAndRefresh();
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
}
