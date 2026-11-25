import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 4200);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-toast-in pointer-events-auto glass-panel flex items-start gap-3 rounded-xl border border-white/[0.1] px-4 py-3 shadow-2xl shadow-black/60"
          >
            <div className="mt-0.5 shrink-0">
              {t.kind === 'success' && <CheckCircle2 className="h-4.5 w-4.5 text-[#22C55E]" />}
              {t.kind === 'error' && <AlertTriangle className="h-4.5 w-4.5 text-[#FF7A2F]" />}
              {t.kind === 'info' && <Info className="h-4.5 w-4.5 text-[#38BDF8]" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-slate-100 leading-snug">{t.title}</div>
              {t.description && (
                <div className="mt-0.5 text-[12px] text-slate-400 leading-relaxed break-words">
                  {t.description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
              aria-label="关闭通知"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
