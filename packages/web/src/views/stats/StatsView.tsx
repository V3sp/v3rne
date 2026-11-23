import { useState } from "react";
import { ConfigView } from "./ConfigView";
import { StatsDashboard } from "./StatsDashboard";

type StatsTab = "stats" | "config";

const TABS: readonly { id: StatsTab; label: string }[] = [
  { id: "stats", label: "Statystyki postępów" },
  { id: "config", label: "Konfigurator projektów & MCP/CLI" },
];

interface StatsViewProps {
  /** Forwarded to the configurator so the app can refresh projects after a monitoring toggle. */
  onProjectsChanged?: () => void;
}

export function StatsView({ onProjectsChanged }: StatsViewProps) {
  const [tab, setTab] = useState<StatsTab>("stats");

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade">
      <div role="tablist" className="flex gap-2 border-b border-slate-800 pb-3">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                selected
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-800 bg-surface-900 text-slate-400 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "stats" ? (
        <StatsDashboard />
      ) : (
        <ConfigView onChanged={onProjectsChanged} />
      )}
    </div>
  );
}
