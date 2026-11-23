import { fetchDoubts, type DoubtItem } from "../api/inbox";
import { useAsyncData } from "./useAsyncData";

export function useInbox() {
  return useAsyncData<DoubtItem[]>(fetchDoubts);
}
