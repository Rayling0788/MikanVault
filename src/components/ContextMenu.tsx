import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  dividerBefore?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    const width = el?.offsetWidth || 210;
    const height = el?.offsetHeight || items.length * 38 + 16;
    const maxLeft = Math.max(8, window.innerWidth - width - 12);
    const maxTop = Math.max(8, window.innerHeight - height - 12);
    setPos({
      left: Math.min(Math.max(8, x), maxLeft),
      top: Math.min(Math.max(8, y), maxTop),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const onDismiss = () => onClose();

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      className="glass-panel fixed z-50 min-w-[202px] overflow-hidden rounded-xl border border-white/[0.11] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.88)]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.dividerBefore && <div className="my-1.5 h-px bg-white/[0.08]" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              item.danger
                ? 'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300'
                : 'text-slate-200 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            {item.icon && <span className="shrink-0 opacity-85">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};
