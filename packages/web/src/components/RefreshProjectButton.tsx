import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { describeError } from "../api/client";
import { refreshProjectGit } from "../api/projects";
import { Icon } from "./icons";
import { useToast } from "./Toasts";

interface RefreshProjectButtonProps {
  projectId: string;
  projectName: string;
  /** Called after a successful refresh so the caller can reload the git snapshot. */
  onRefreshed?: () => void;
}

/** Stops the event from reaching a parent that opens the project (the radar card is clickable). */
export function RefreshProjectButton({ projectId, projectName, onRefreshed }: RefreshProjectButtonProps) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);

  const refresh = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await refreshProjectGit(projectId);
      showToast(`Odświeżono ${projectName}`, "success");
      onRefreshed?.();
    } catch (err) {
      showToast(describeError(err), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => void refresh(event)}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => event.stopPropagation()}
      disabled={busy}
      aria-label={`Odśwież ${projectName}`}
      title="Odśwież Git"
      className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-surface-850 px-2 py-1 text-[11px] text-slate-300 transition hover:border-indigo-500/40 hover:text-white disabled:cursor-wait disabled:opacity-60"
    >
      <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Odświeżanie…" : "Odśwież"}
    </button>
  );
}
