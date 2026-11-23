import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "info" | "success" | "warn";

type ShowToast = (message: string, tone?: ToastTone) => void;

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const TOAST_DURATION_MS = 3200;

const TONE_CLASSNAMES: Record<ToastTone, string> = {
  info: "bg-surface-800/95 border-indigo-500/40 text-slate-100",
  success: "bg-emerald-950/95 border-emerald-500/40 text-emerald-200",
  warn: "bg-amber-950/95 border-amber-500/40 text-amber-200",
};

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((message, tone = "info") => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex animate-fade items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs shadow-xl ${TONE_CLASSNAMES[item.tone]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast wymaga ToastProvider");
  return show;
}
