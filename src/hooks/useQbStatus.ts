import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QbConnectionStatus, QbTorrentItem } from '@shared/types';
import { api } from '@/lib/api';
import { getTorrentStateMeta } from '@/lib/format';

export interface UseQbStatusResult {
  status: QbConnectionStatus | null;
  torrents: QbTorrentItem[];
  loading: boolean;
  launching: boolean;
  activeCount: number;
  completedCount: number;
  totalDlSpeed: number;
  totalUlSpeed: number;
  refresh: () => Promise<void>;
  launchQb: () => Promise<{ ok: boolean; error?: string }>;
}

export function useQbStatus(fastPolling: boolean): UseQbStatusResult {
  const [status, setStatus] = useState<QbConnectionStatus | null>(null);
  const [torrents, setTorrents] = useState<QbTorrentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const isFetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const conn = await api.qbTestConnection();
      setStatus(conn);
      if (conn.connected) {
        const list = await api.qbGetTorrents();
        setTorrents(Array.isArray(list) ? list : []);
      } else {
        setTorrents([]);
      }
    } catch (err) {
      setStatus({
        ok: false,
        connected: false,
        qbRunning: false,
        exeExists: false,
        error: err instanceof Error ? err.message : '连接检测失败',
      });
      setTorrents([]);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const intervalMs = fastPolling ? 2000 : 6000;
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
  }, [fastPolling, refresh]);

  const launchQb = useCallback(async () => {
    setLaunching(true);
    try {
      const res = await api.qbLaunch();
      if (!res.ok) {
        return { ok: false, error: res.error || '无法启动 qBittorrent' };
      }
      // Give qBittorrent WebUI a short moment to boot up, then re-poll
      let lastConn: QbConnectionStatus | null = null;
      for (const delay of [900, 1800, 2600]) {
        await new Promise((r) => window.setTimeout(r, delay));
        const conn = await api.qbTestConnection();
        lastConn = conn;
        setStatus(conn);
        if (conn.connected) {
          const list = await api.qbGetTorrents();
          setTorrents(Array.isArray(list) ? list : []);
          return { ok: true };
        }
      }
      await refresh();
      return {
        ok: false,
        error:
          lastConn?.error ||
          'qBittorrent 已启动，但 WebUI 暂未就绪，请在「偏好设置」检查端口与密码',
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '启动失败' };
    } finally {
      setLaunching(false);
    }
  }, [refresh]);

  const stats = useMemo(() => {
    let activeCount = 0;
    let completedCount = 0;
    let totalDlSpeed = 0;
    let totalUlSpeed = 0;
    for (const t of torrents) {
      const meta = getTorrentStateMeta(t.state);
      if (meta.category === 'downloading') activeCount += 1;
      if (t.progress >= 0.999 || meta.category === 'completed') completedCount += 1;
      totalDlSpeed += t.dlspeed || 0;
      totalUlSpeed += t.upspeed || 0;
    }
    return { activeCount, completedCount, totalDlSpeed, totalUlSpeed };
  }, [torrents]);

  return {
    status,
    torrents,
    loading,
    launching,
    ...stats,
    refresh,
    launchQb,
  };
}
