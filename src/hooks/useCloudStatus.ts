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

function getCloudStatusSignature(s: CloudDriveStatus): string {
  return `${s.detected}|${s.mountRoot || ''}|${s.defaultTargetDir || ''}|${s.configuredDir}|${s.configuredAccessible}|${s.freeBytes ?? ''}|${s.totalBytes ?? ''}`;
}

function getCloudJobsSignature(list: CloudTransferJob[]): string {
  if (list.length === 0) return '0';
  return list
    .map(
      (j) =>
        `${j.id}:${j.status}:${j.cancelling ? 1 : 0}:${(j.progress || 0).toFixed(4)}:${j.transferredBytes || 0}:${j.speedBytesPerSec || 0}:${j.copiedFiles || 0}:${j.currentFileName || ''}:${j.error || ''}`,
    )
    .join('|');
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
  const lastStatusSigRef = useRef<string | null>(null);
  const lastJobsSigRef = useRef<string>('0');

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
      const nextStatusSig = getCloudStatusSignature(nextStatus);
      if (nextStatusSig !== lastStatusSigRef.current) {
        lastStatusSigRef.current = nextStatusSig;
        setStatus(nextStatus);
      }

      const safeJobs = Array.isArray(nextJobs) ? nextJobs : [];
      const nextJobsSig = getCloudJobsSignature(safeJobs);
      if (nextJobsSig !== lastJobsSigRef.current) {
        lastJobsSigRef.current = nextJobsSig;
        setJobs(safeJobs);
      }

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
    const intervalMs = fastPolling || activeCount > 0 ? 1500 : queuedCount > 0 ? 4000 : 12000;
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
  }, [fastPolling, activeCount, queuedCount, refresh]);

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
