import type { ReactNode } from "react";

export function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
      {message}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
        active ? "border-indigo-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export function SegmentButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] transition ${
        active ? "bg-surface-800 text-white" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
