import { useState, type FormEvent } from "react";
import { resolveDoubt, type DoubtItem } from "../../api/inbox";
import { ApiError, describeError } from "../../api/client";
import { formatRelativeTime } from "../../lib/format";
import { PRIORITY_META } from "../../lib/status";

interface InboxCardProps {
  item: DoubtItem;
  onOpenTask: (code: string, projectId: string) => void;
  onResolved: () => void;
}

export function InboxCard({ item, onOpenTask, onResolved }: InboxCardProps) {
  const { comment, task } = item;
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priority = PRIORITY_META[task.priority];
  const canSubmit = reply.trim().length > 0 && !submitting;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      await resolveDoubt(comment.id, reply.trim());
      onResolved();
    } catch (err) {
      // Already resolved elsewhere: the list is stale, so refresh instead of reporting an error.
      if (err instanceof ApiError && err.code === "already_resolved") {
        onResolved();
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="space-y-3 rounded-xl border border-amber-500/35 bg-surface-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-200">
            {task.projectName}
          </span>
          <button
            type="button"
            onClick={() => onOpenTask(task.code, task.projectId)}
            className="font-mono text-xs text-indigo-400 hover:underline"
          >
            {task.code}
          </button>
          <span className="truncate text-xs font-semibold text-white">{task.title}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`font-medium ${priority.textClassName}`}>{priority.label}</span>
          <span className="text-slate-500" title={new Date(comment.createdAt).toLocaleString("pl-PL")}>
            • {formatRelativeTime(comment.createdAt)}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-100">
        <div className="mb-1 font-mono text-[11px] text-amber-300">@{comment.authorName} pyta:</div>
        <p className="whitespace-pre-wrap">{comment.body}</p>
      </div>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          disabled={submitting}
          aria-label={`Odpowiedź na wątpliwość ${task.code}`}
          placeholder="Wpisz swoją decyzję / odpowiedź dla agenta..."
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-surface-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Zapisywanie…" : "Odpowiedz i odblokuj (→ Ready)"}
        </button>
      </form>

      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </article>
  );
}
