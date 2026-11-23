import { useInbox } from "../../hooks/useInbox";
import { Mascot } from "../../components/Mascot";
import { ErrorState, Loader } from "../../components/StatusViews";
import { useToast } from "../../components/Toasts";
import { InboxCard } from "./InboxCard";

interface InboxViewProps {
  onOpenTask: (code: string, projectId: string) => void;
  /** Called after a doubt is resolved so the app can refresh the sidebar badge and radar counts. */
  onChanged?: () => void;
}

export function InboxView({ onOpenTask, onChanged }: InboxViewProps) {
  const { state, reload } = useInbox();
  const showToast = useToast();

  if (state.status === "loading") return <Loader label="Ładowanie wątpliwości…" />;
  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={() => void reload()} />;
  }

  const doubts = state.data;
  if (doubts.length === 0) return <EmptyInbox />;

  const handleResolved = () => {
    showToast("Odpowiedź zapisana, zadanie wraca do Ready", "success");
    void reload();
    onChanged?.();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-400">
          Odpowiedź tutaj automatycznie zapisuje komentarz w bazie Portalu, zamyka wątpliwość i
          przestawia status zadania z <span className="font-mono text-amber-300">needs_input</span>{" "}
          na <span className="font-mono text-sky-300">ready</span>.
        </p>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-300">
          {doubts.length} otwarte
        </span>
      </div>

      {doubts.map((item) => (
        <InboxCard
          key={item.comment.id}
          item={item}
          onOpenTask={onOpenTask}
          onResolved={handleResolved}
        />
      ))}
    </div>
  );
}

function EmptyInbox() {
  return (
    <div className="mx-auto mt-10 flex max-w-3xl animate-fade flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-surface-900 px-6 py-12 text-center">
      <Mascot name="hello" size={150} />
      <h2 className="text-base font-semibold text-white">Brak otwartych wątpliwości</h2>
      <p className="max-w-md text-xs leading-relaxed text-slate-400">
        Wszystkie zadania agentów są odblokowane i gotowe do dalszej pracy.
      </p>
    </div>
  );
}
