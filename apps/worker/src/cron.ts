import type { RetryProcessor, RetryReport } from "./services/retries";
import type { PendingSync, SyncReport } from "./services/sync";
import type { Retention } from "./services/retention";

export interface CronReport {
  retries: RetryReport;
  sync: SyncReport;
  pruned: number;
}

export interface CronRunner {
  run(): Promise<CronReport>;
}

export function createCronRunner(deps: {
  retries: RetryProcessor;
  sync: PendingSync;
  retention: Retention;
}): CronRunner {
  return {
    async run(): Promise<CronReport> {
      const retries = await deps.retries.run();
      const sync = await deps.sync.run();
      const pruned = await deps.retention.run();
      return { retries, sync, pruned };
    },
  };
}
