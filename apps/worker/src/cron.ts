import type { RetryReport, RetryProcessor } from "./services/retries";
import type { PendingSync, SyncReport } from "./services/sync";

export interface CronReport {
  retries: RetryReport;
  sync: SyncReport;
}

export interface CronRunner {
  run(): Promise<CronReport>;
}

export function createCronRunner(deps: { retries: RetryProcessor; sync: PendingSync }): CronRunner {
  return {
    async run(): Promise<CronReport> {
      const retries = await deps.retries.run();
      const sync = await deps.sync.run();
      return { retries, sync };
    },
  };
}
