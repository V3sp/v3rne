import type { ReactNode } from "react";
import type { RecentEvent, StatusByProject, StatsResponse, VelocityPoint } from "../../api/stats";
import { formatRelativeTime, pluralizePl } from "../../lib/format";
import {
  aggregateStatusTotals,
  describeEvent,
  formatDoubtAverage,
  formatWeekLabel,
  isVelocityEmpty,
  sumStatusCounts,
} from "../../lib/stats";
import { STATUS_META, STATUS_ORDER } from "../../lib/status";
import { Mascot } from "../../components/Mascot";
import { ErrorState, Loader } from "../../components/StatusViews";
import { useStats } from "../../hooks/useStats";

const STATUS_BAR_CLASS: Record<(typeof STATUS_ORDER)[number], string> = {
  backlog: "bg-slate-600",
  ready: "bg-sky-500",
  in_progress: "bg-indigo-500",
  needs_input: "bg-amber-400",
  done: "bg-emerald-500",
  cancelled: "bg-surface-700",
};

export function StatsDashboard() {
  const { state, reload } = useStats();

  if (state.status === "loading") return <Loader label="Ładowanie statystyk…" />;
  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={() => void reload()} />;
  }
  return <StatsContent stats={state.data} />;
}

function StatsContent({ stats }: { stats: StatsResponse }) {
  const { doubts } = stats;
  return (
    <div className="space-y-5 animate-fade">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Średni czas odpowiedzi na wątpliwości">
          <span className="text-2xl font-semibold text-white">
            {formatDoubtAverage(doubts.averageMinutes)}
          </span>
        </KpiCard>
        <KpiCard label="Rozwiązane wątpliwości">
          <span className="text-2xl font-semibold text-white">{doubts.resolvedCount}</span>
        </KpiCard>
        <KpiCard
          label="Otwarte wątpliwości"
          highlight={doubts.openCount > 0}
        >
          <span
            className={`text-2xl font-semibold ${doubts.openCount > 0 ? "text-amber-300" : "text-emerald-400"}`}
          >
            {doubts.openCount}
          </span>
        </KpiCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <VelocityCard velocity={stats.velocity} />
        <EventsCard events={stats.recentEvents} />
      </div>

      <StatusByProjectCard rows={stats.statusByProject} />

      <p className="text-right text-[11px] text-slate-500">
        Dane wygenerowane: {formatRelativeTime(stats.generatedAt)}
      </p>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  highlight?: boolean;
  children: ReactNode;
}

function KpiCard({ label, highlight = false, children }: KpiCardProps) {
  return (
    <div
      className={`rounded-xl border bg-surface-900 p-4 ${highlight ? "border-amber-500/40" : "border-slate-800"}`}
    >
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">{children}</div>
    </div>
  );
}

function VelocityCard({ velocity }: { velocity: VelocityPoint[] }) {
  const empty = isVelocityEmpty(velocity);
  const max = Math.max(0, ...velocity.map((point) => point.count));

  return (
    <section className="rounded-xl border border-slate-800 bg-surface-900 p-5 lg:col-span-2">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Ukończone zadania (Velocity)</h3>
          <p className="text-xs text-slate-400">Wyliczane automatycznie z tabeli task_events</p>
        </div>
        {!empty && <Mascot name="sprint" size={96} className="shrink-0" />}
      </header>

      {empty ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Mascot name="zzz" size={150} />
          <p className="text-sm font-medium text-white">
            Brak ukończonych zadań w ostatnich {velocity.length} tygodniach
          </p>
          <p className="max-w-sm text-xs text-slate-400">
            Słupki pojawią się tutaj, gdy zostanie ukończone pierwsze zadanie.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {velocity.map((point, index) => {
            const isCurrent = index === velocity.length - 1;
            const width = max === 0 ? 0 : Math.round((point.count / max) * 100);
            return (
              <div key={point.week}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">
                    {formatWeekLabel(point.week)}
                    {isCurrent && <span className="text-slate-500"> (bieżący)</span>}
                  </span>
                  <span className="font-mono text-indigo-300">
                    {point.count} {pluralizePl(point.count, "zadanie", "zadania", "zadań")}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-surface-950">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EventsCard({ events }: { events: RecentEvent[] }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-surface-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">Ostatnie zdarzenia</h3>
      {events.length === 0 ? (
        <p className="text-xs text-slate-500">Brak zdarzeń do pokazania.</p>
      ) : (
        <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {events.map((event) => {
            const isDoubt = event.eventType.startsWith("doubt_");
            return (
              <li
                key={event.id}
                className={`border-l-2 py-0.5 pl-3 text-xs ${isDoubt ? "border-amber-400" : "border-emerald-400"}`}
              >
                <div className="text-slate-200">
                  <span className="font-mono text-indigo-300">{event.taskCode}</span>{" "}
                  {describeEvent(event)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {event.projectName} • {event.actor} • {formatRelativeTime(event.createdAt)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function StatusByProjectCard({ rows }: { rows: StatusByProject[] }) {
  const totals = aggregateStatusTotals(rows);
  const grandTotal = sumStatusCounts(totals);

  return (
    <section className="space-y-5 rounded-xl border border-slate-800 bg-surface-900 p-5">
      <header>
        <h3 className="text-sm font-semibold text-white">Rozkład statusów per projekt</h3>
        <p className="text-xs text-slate-400">
          Łącznie zadań: <span className="font-mono text-slate-200">{grandTotal}</span>
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((status) => (
          <span
            key={status}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_META[status].className}`}
          >
            {STATUS_META[status].label}: {totals[status]}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Brak projektów do pokazania.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const total = sumStatusCounts(row.statuses);
            return (
              <div key={row.projectId}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-semibold text-white">{row.projectName}</span>
                  <span className="font-mono text-slate-400">
                    {total} {pluralizePl(total, "zadanie", "zadania", "zadań")}
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-surface-950">
                  {STATUS_ORDER.map((status) => {
                    const count = row.statuses[status];
                    if (!count) return null;
                    return (
                      <div
                        key={status}
                        title={`${STATUS_META[status].label}: ${count}`}
                        className={`h-full ${STATUS_BAR_CLASS[status]}`}
                        style={{ width: `${(count / total) * 100}%` }}
                      />
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500">
                  {total === 0
                    ? "Brak zadań w tym projekcie"
                    : STATUS_ORDER.filter((status) => row.statuses[status] > 0)
                        .map((status) => `${STATUS_META[status].label} ${row.statuses[status]}`)
                        .join(" • ")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
