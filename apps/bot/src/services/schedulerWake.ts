type SchedulerWakeHandler = (reason: string) => void;

let activeHandler: SchedulerWakeHandler | null = null;

/**
 * Connect in-process bot actions to the adaptive scheduler without coupling
 * interaction handlers to the Scheduler instance owned by index.ts.
 */
export function registerSchedulerWake(
  handler: SchedulerWakeHandler,
): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** Wake the scheduler after an action creates or changes a timed boundary. */
export function requestSchedulerWake(reason: string): void {
  activeHandler?.(reason);
}
