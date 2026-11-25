import { useCallback, useMemo, useRef, useState } from 'react';
import type { MikanRelease } from '@shared/types';
import { parseSizeTextToBytes } from '@/lib/format';

export interface ReleaseSelectionState {
  selectedIds: Set<string>;
  selectedReleases: MikanRelease[];
  selectedCount: number;
  allVisibleSelected: boolean;
  totalSizeBytes: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string, shiftKey?: boolean) => void;
  selectAll: () => void;
  invertSelection: () => void;
  clear: () => void;
}

export function useReleaseSelection(visibleReleases: MikanRelease[]): ReleaseSelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  const toggle = useCallback(
    (id: string, shiftKey = false) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastClickedIdRef.current) {
          const startIdx = visibleReleases.findIndex((r) => r.id === lastClickedIdRef.current);
          const endIdx = visibleReleases.findIndex((r) => r.id === id);
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            const shouldSelect = !prev.has(id);
            for (let i = lo; i <= hi; i += 1) {
              if (shouldSelect) {
                next.add(visibleReleases[i].id);
              } else {
                next.delete(visibleReleases[i].id);
              }
            }
            lastClickedIdRef.current = id;
            return next;
          }
        }

        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        lastClickedIdRef.current = id;
        return next;
      });
    },
    [visibleReleases]
  );

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of visibleReleases) {
        next.add(r.id);
      }
      return next;
    });
  }, [visibleReleases]);

  const invertSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of visibleReleases) {
        if (next.has(r.id)) {
          next.delete(r.id);
        } else {
          next.add(r.id);
        }
      }
      return next;
    });
  }, [visibleReleases]);

  const clear = useCallback(() => {
    lastClickedIdRef.current = null;
    setSelectedIds(new Set());
  }, []);

  const selectedReleases = useMemo(
    () => visibleReleases.filter((r) => selectedIds.has(r.id)),
    [visibleReleases, selectedIds]
  );

  const allVisibleSelected = useMemo(
    () =>
      visibleReleases.length > 0 && visibleReleases.every((r) => selectedIds.has(r.id)),
    [visibleReleases, selectedIds]
  );

  const totalSizeBytes = useMemo(
    () =>
      selectedReleases.reduce(
        (sum, r) => sum + (r.sizeBytes && r.sizeBytes > 0 ? r.sizeBytes : parseSizeTextToBytes(r.size)),
        0
      ),
    [selectedReleases]
  );

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    selectedReleases,
    selectedCount: selectedReleases.length,
    allVisibleSelected,
    totalSizeBytes,
    isSelected,
    toggle,
    selectAll,
    invertSelection,
    clear,
  };
}
