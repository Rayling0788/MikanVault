import { useCallback, useEffect, useState } from 'react';
import type { ResolvedTheme, ThemeMode } from '@shared/types';
import { api } from '@/lib/api';

const THEME_STORAGE_KEY = 'mikanvault_theme';

function readStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'dark';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredThemeMode()),
  );

  const applyResolvedTheme = useCallback((nextResolved: ResolvedTheme) => {
    setResolvedTheme(nextResolved);
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.dataset.theme = nextResolved;
      root.classList.remove('dark', 'light');
      root.classList.add(nextResolved);
      root.style.colorScheme = nextResolved;
    }
    void api.windowSetTheme?.(nextResolved)?.catch?.(() => {});
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(mode));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Ignore storage quota errors
    }

    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      applyResolvedTheme(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [mode, applyResolvedTheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const cycleMode = useCallback(() => {
    setModeState((prev) =>
      prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark',
    );
  }, []);

  return {
    mode,
    resolvedTheme,
    setMode,
    cycleMode,
  };
}
