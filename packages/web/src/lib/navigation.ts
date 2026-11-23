import type { IconName } from "../components/icons";

export type View = "radar" | "project" | "inbox" | "stats";

export interface NavItem {
  view: View;
  label: string;
  icon: IconName;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { view: "radar", label: "Radar Projektów", icon: "radar" },
  { view: "project", label: "Widok Projektu", icon: "project" },
  { view: "inbox", label: "Inbox Wątpliwości", icon: "inbox" },
  { view: "stats", label: "Statystyki & Konfig", icon: "stats" },
];

export const MCP_URL = "http://127.0.0.1:4321/mcp";
