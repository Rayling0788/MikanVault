import React, { useEffect, useRef } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';

interface TopBarProps {
  title: string;
  subtitle?: string;
  canGoBack?: boolean;
  onGoBack?: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (query: string) => void;
  onClearSearch: () => void;
  isPreviewMode?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  canGoBack = false,
  onGoBack,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  isPreviewMode = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) {
      onSearchSubmit(trimmed);
    }
  };

  return (
    <header className="titlebar-drag flex h-[54px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.055] bg-[#0B0D11]/85 px-6 pr-[152px] backdrop-blur-md">
      {/* Left: Back button + Breadcrumb */}
      <div className="flex min-w-0 items-center gap-3">
        {canGoBack && onGoBack && (
          <button
            type="button"
            onClick={onGoBack}
            className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-300 transition hover:border-white/[0.16] hover:bg-white/[0.09] hover:text-white"
            aria-label="返回"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-[14.5px] font-semibold tracking-tight text-slate-100">
            {title}
          </h1>
          {subtitle && (
            <span className="hidden truncate text-[12px] text-slate-500 sm:inline">
              {subtitle}
            </span>
          )}
          {isPreviewMode && (
            <span className="titlebar-no-drag rounded-md border border-[#FF7A2F]/30 bg-[#FF7A2F]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#FF9E4F]">
              预览模式
            </span>
          )}
        </div>
      </div>

      {/* Right: Global Mikan Search Bar */}
      <form
        onSubmit={handleSubmit}
        className="titlebar-no-drag relative w-full max-w-[340px]"
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索番剧、字幕组或关键词..."
          className="input-cinema h-[34px] w-full rounded-xl pr-16 pl-9 text-[12.5px] placeholder:text-slate-500"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {searchQuery ? (
            <button
              type="button"
              onClick={onClearSearch}
              className="rounded-md p-1 text-slate-400 transition hover:bg-white/[0.08] hover:text-white"
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              Ctrl K
            </kbd>
          )}
        </div>
      </form>
    </header>
  );
};
