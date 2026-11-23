import type { Status } from "@v3rne/shared";
import { apiRequest } from "./client";

export interface VelocityPoint {
  /** ISO week key, e.g. `2026-W47`. */
  week: string;
  count: number;
}

export interface DoubtStats {
  /** `null` until at least one doubt has been resolved. */
  averageMinutes: number | null;
  resolvedCount: number;
  openCount: number;
}

export interface StatusByProject {
  projectId: string;
  projectName: string;
  statuses: Record<Status, number>;
  total: number;
}

export interface RecentEvent {
  id: number;
  projectId: string;
  projectName: string;
  taskId: number;
  taskCode: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string;
  createdAt: string;
}

export interface StatsResponse {
  generatedAt: string;
  velocity: VelocityPoint[];
  doubts: DoubtStats;
  statusByProject: StatusByProject[];
  recentEvents: RecentEvent[];
}

export function fetchStats(): Promise<StatsResponse> {
  return apiRequest<StatsResponse>("/stats");
}
