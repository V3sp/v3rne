import { fetchStats, type StatsResponse } from "../api/stats";
import { useAsyncData } from "./useAsyncData";

export function useStats() {
  return useAsyncData<StatsResponse>(fetchStats);
}
