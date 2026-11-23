export function Loader({ label = "Ładowanie danych…" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-24">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="mx-auto mt-16 max-w-lg animate-fade rounded-2xl border border-rose-500/30 bg-surface-900 p-8 text-center"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/15 text-xl text-rose-300">
        !
      </div>
      <h2 className="text-base font-semibold text-white">Nie udało się pobrać danych</h2>
      <p className="mt-1 text-xs text-slate-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-md border border-slate-700/70 bg-surface-850 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-surface-800"
      >
        Spróbuj ponownie
      </button>
    </div>
  );
}

export function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto mt-16 max-w-lg animate-fade rounded-2xl border border-dashed border-slate-800 bg-surface-900 p-10 text-center">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
    </div>
  );
}
