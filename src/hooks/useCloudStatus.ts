import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudDriveStatus, CloudTransferJob } from '@shared/types';
import { api } from '@/lib/api';

export interface UseCloudStatusResult {
  status: CloudDriveStatus | null;
  jobs: CloudTransferJob[];
  loading: boolean;
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  failedOrCancelledCount: number;
  totalSpeed: number;
  totalUploadedBytes: number;
  refresh: () => Promise<void>;
}

export function useCloudStatus(
  fastPolling: boolean,
  onUploadCompleted?: () => void,
): UseCloudStatusResult {
  const [status, setStatus] = useState<CloudDriveStatus | null>(null);
  const [jobs, setJobs] = useState<CloudTransferJob[]>([]);
  const [loading, setLoading] = useState(true);
  const isFetchingRef = useRef(false);
  const initializedRef = useRef(false);
  const prevCompletedRef = useRef(0);
  const onCompletedRef = useRef(onUploadCompleted);

  useEffect(() => {
    onCompletedRef.current = onUploadCompleted;
  }, [onUploadCompleted]);

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const [nextStatus, nextJobs] = await Promise.all([
        api.cloudGetStatus(),
        api.cloudListJobs(),
      ]);
      setStatus(nextStatus);
      const safeJobs = Array.isArray(nextJobs) ? nextJobs : [];
      setJobs(safeJobs);

      const completedNow = safeJobs.filter((j) => j.status === 'completed').length;
      if (initializedRef.current && completedNow > prevCompletedRef.current) {
        onCompletedRef.current?.();
      }
      prevCompletedRef.current = completedNow;
      initializedRef.current = true;
    } catch {
      // Preserve last snapshot on transient error
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const {
    activeCount,
    queuedCount,
    completedCount,
    failedOrCancelledCount,
    totalSpeed,
    totalUploadedBytes,
  } = useMemo(() => {
    let active = 0;
    let queued = 0;
    let completed = 0;
    let failedOrCancelled = 0;
    let speed = 0;
    let uploaded = 0;

    for (const job of jobs) {
      if (job.status === 'copying') {
        active += 1;
        speed += job.speedBytesPerSec || 0;
      } else if (job.status === 'queued') {
        queued += 1;
      } else if (job.status === 'completed') {
        completed += 1;
        uploaded += job.totalBytes || 0;
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        failedOrCancelled += 1;
      }
    }

    return {
      activeCount: active,
      queuedCount: queued,
      completedCount: completed,
      failedOrCancelledCount: failedOrCancelled,
      totalSpeed: speed,
      totalUploadedBytes: uploaded,
    };
  }, [jobs]);

  useEffect(() => {
    const intervalMs = fastPolling || activeCount > 0 ? 1500 : 5000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fastPolling, activeCount, refresh]);

  return {
    status,
    jobs,
    loading,
    activeCount,
    queuedCount,
    completedCount,
    failedOrCancelledCount,
    totalSpeed,
    totalUploadedBytes,
    refresh,
  };
}
