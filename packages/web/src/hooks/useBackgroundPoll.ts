import { useEffect, useRef } from "react";
import { isPollDue } from "../lib/poll";

/** Calls `callback` every `intervalMs` while the tab is visible. Stops while hidden and catches up on return. */
export function useBackgroundPoll(callback: () => void, intervalMs: number): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastRunAt = Date.now();

    const run = () => {
      lastRunAt = Date.now();
      callbackRef.current();
    };
    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      if (isPollDue(lastRunAt, Date.now(), intervalMs)) run();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, [intervalMs]);
}
