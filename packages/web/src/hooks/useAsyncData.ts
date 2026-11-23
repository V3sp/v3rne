import { useCallback, useEffect, useState } from "react";
import { describeError } from "../api/client";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** Same contract as useRadarData: the last good data stays on screen while reloading. */
export function useAsyncData<T>(load: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  const reload = useCallback(async () => {
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    try {
      const data = await load();
      setState({ status: "ready", data });
    } catch (err) {
      setState({ status: "error", message: describeError(err) });
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}
