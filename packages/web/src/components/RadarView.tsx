import type { ReactNode } from "react";
import { summarizeRadar, type RadarEntry } from "../lib/radar";
import { formatProgressLabel, pluralizePl } from "../lib/format";
import { Mascot } from "./Mascot";
import { ProjectCard } from "./ProjectCard";

interface RadarViewProps {
  entries: readonly RadarEntry[];
  onOpenProject: (projectId: string) => void;
  onOpenInbox: () => void;
  onProjectRefreshed?: () => void;
}

export function RadarView({ entries, onOpenProject, onOpenInbox, onProjectRefreshed }: RadarViewProps) {
  const summary = summarizeRadar(entries);
  const activeEntries = entries.filter((entry) => entry.project.active);

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Monitorowane projekty">
          <span className="text-2xl font-semibold text-white">{summary.monitored}</span>
          <span className="font-mono text-xs text-emerald-400">aktywne</span>
        </KpiCard>
        <KpiCard label="Postęp globalny">
          <span className="text-2xl font-semibold text-white">
            {formatProgressLabel(summary.progress)}
          </span>
          <span className="text-xs text-slate-400">zadań ukończonych</span>
        </KpiCard>
        <KpiCard
          label="Otwarte wątpliwości"
          onClick={onOpenInbox}
          className={summary.openDoubts > 0 ? "border-amber-500/40 hover:border-amber-400/60" : ""}
        >
          <span
            className={`text-2xl font-semibold ${summary.openDoubts > 0 ? "text-amber-300" : "text-emerald-400"}`}
          >
            {summary.openDoubts}
          </span>
          <span className="text-xs text-slate-400">
            {summary.openDoubts > 0 ? "czekają na decyzję →" : "wszystko odblokowane"}
          </span>
        </KpiCard>
        <KpiCard label="Alerty dryfu plan.md">
          <span
            className={`text-2xl font-semibold ${summary.driftAlerts > 0 ? "text-indigo-300" : "text-slate-300"}`}
          >
            {summary.driftAlerts}
          </span>
          <span className="text-xs text-slate-400">
            {pluralizePl(summary.driftAlerts, "zmieniony plan", "zmienione plany", "zmienionych planów")}
          </span>
        </KpiCard>
      </div>

      {activeEntries.length === 0 ? (
        <EmptyRadar />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {activeEntries.map((entry) => (
            <ProjectCard
              key={entry.project.id}
              entry={entry}
              onOpen={onOpenProject}
              onRefreshed={onProjectRefreshed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

function KpiCard({ label, children, onClick, className = "" }: KpiCardProps) {
  const base = `rounded-xl border border-slate-800 bg-surface-900 p-4 text-left transition ${className}`;
  const content = (
    <>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">{children}</div>
    </>
  );

  if (!onClick) return <div className={base}>{content}</div>;
  return (
    <button type="button" onClick={onClick} className={`block w-full cursor-pointer ${base}`}>
      {content}
    </button>
  );
}

function EmptyRadar() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-800 bg-surface-900 px-6 py-14 text-center">
      <Mascot name="hello" size={160} />
      <h2 className="text-base font-semibold text-white">Witaj w V3rne!</h2>
      <p className="max-w-md text-xs leading-relaxed text-slate-400">
        Witaj! Nie monitorujesz jeszcze żadnych repozytoriów. Dodaj projekty do{" "}
        <span className="font-mono text-slate-300">config.yaml</span>, a pojawią się tutaj wraz
        ze stanem Gita i postępem zadań.
      </p>
    </div>
  );
}
