import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "../api/client";
import { fetchTaskDetail, type TaskDetail } from "../views/project/api";

export type TaskDetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; task: TaskDetail };

export function useTaskDetail(code: string) {
  const [state, setState] = useState<TaskDetailState>({ status: "loading" });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const task = await fetchTaskDetail(code);
      if (requestId === requestRef.current) setState({ status: "ready", task });
    } catch (err) {
      if (requestId === requestRef.current) {
        setState({ status: "error", message: describeError(err) });
      }
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
