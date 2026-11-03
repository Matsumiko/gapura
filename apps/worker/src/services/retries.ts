import type { TransactionRepository, WebhookLogRepository } from "../types";
import { paymentPayload } from "./payload";
import type { DeliverFn } from "./webhooks";
import { isFinalAttempt, nextAttemptDelayMs } from "./retry-policy";

export interface RetryReport {
  due: number;
  attempted: number;
  delivered: number;
  failed: number;
  dead: number;
}

export interface RetryProcessorDeps {
  transactions: TransactionRepository;
  logs: WebhookLogRepository;
  deliver: DeliverFn;
  now: () => Date;
  batchSize?: number;
  leaseMs?: number;
}

export interface RetryProcessor {
  run(): Promise<RetryReport>;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 5 * 60_000;

export function createRetryProcessor(deps: RetryProcessorDeps): RetryProcessor {
  return {
    async run(): Promise<RetryReport> {
      const startedAt = deps.now();
      const due = await deps.logs.findDue(
        startedAt.toISOString(),
        deps.batchSize ?? DEFAULT_BATCH_SIZE,
      );
      const report: RetryReport = {
        due: due.length,
        attempted: 0,
        delivered: 0,
        failed: 0,
        dead: 0,
      };

      for (const row of due) {
        const leaseUntil = new Date(
          startedAt.getTime() + (deps.leaseMs ?? DEFAULT_LEASE_MS),
        ).toISOString();
        if (!(await deps.logs.claim(row.id, row.nextAttemptAt, leaseUntil))) {
          continue;
        }

        const joined = await deps.transactions.findWithProject(row.merchantOrderId);
        if (!joined || isFinalAttempt(row.attempt)) {
          await deps.logs.markDead(row.id);
          report.dead += 1;
          continue;
        }

        const nextAttempt = row.attempt + 1;
        const result = await deps.deliver(joined.project, paymentPayload(joined.transaction));
        const finishedAt = deps.now();
        const final = !result.ok && isFinalAttempt(nextAttempt);

        await deps.logs.insertAttempt({
          merchantOrderId: row.merchantOrderId,
          attempt: nextAttempt,
          httpStatus: result.httpStatus,
          error: result.error,
          nextAttemptAt:
            result.ok || final
              ? null
              : new Date(finishedAt.getTime() + nextAttemptDelayMs(row.attempt)).toISOString(),
          status: result.ok ? "DELIVERED" : final ? "DEAD" : "FAILED",
          createdAt: finishedAt.toISOString(),
        });
        await deps.logs.clearSchedule(row.id);

        report.attempted += 1;
        if (result.ok) {
          report.delivered += 1;
        } else if (final) {
          report.dead += 1;
        } else {
          report.failed += 1;
        }
      }

      return report;
    },
  };
}
