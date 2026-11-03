import type { StatusProvider } from "../providers/duitku";
import type { PaymentStatus, TransactionRepository } from "../types";
import { paymentPayload } from "./payload";
import type { WebhookForwarder } from "./webhooks";

export interface SyncReport {
  checked: number;
  updated: number;
  failed: number;
}

export interface PendingSyncDeps {
  transactions: TransactionRepository;
  provider: StatusProvider;
  forwarder: WebhookForwarder;
  now: () => Date;
  staleAfterMs?: number;
  batchSize?: number;
}

export interface PendingSync {
  run(): Promise<SyncReport>;
}

const DEFAULT_STALE_AFTER_MS = 10 * 60_000;
const DEFAULT_BATCH_SIZE = 10;

/** statusCode Duitku: 00 success, 01 pending, 02 canceled. */
export function mapDuitkuStatus(statusCode: string): PaymentStatus | null {
  if (statusCode === "00") {
    return "PAID";
  }
  if (statusCode === "02") {
    return "EXPIRED";
  }
  return null;
}

/**
 * Menyelaraskan transaksi PENDING yang lama dengan Duitku, untuk callback yang hilang.
 * Hanya transisi yang benar-benar berubah yang diteruskan ke project.
 */
export function createPendingSync(deps: PendingSyncDeps): PendingSync {
  return {
    async run(): Promise<SyncReport> {
      const report: SyncReport = { checked: 0, updated: 0, failed: 0 };
      const cutoff = new Date(
        deps.now().getTime() - (deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
      ).toISOString();
      const rows = await deps.transactions.findPendingWithProjectBefore(
        cutoff,
        deps.batchSize ?? DEFAULT_BATCH_SIZE,
      );

      for (const row of rows) {
        report.checked += 1;
        let result;
        try {
          result = await deps.provider.getStatus(row.transaction.merchantOrderId);
        } catch {
          report.failed += 1;
          continue;
        }

        const status = mapDuitkuStatus(result.statusCode);
        if (!status) {
          continue;
        }

        const updatedAt = deps.now().toISOString();
        const changed = await deps.transactions.markStatus(
          row.transaction.merchantOrderId,
          status,
          updatedAt,
        );
        if (!changed) {
          continue;
        }

        await deps.forwarder.forward({
          project: row.project,
          payload: paymentPayload({ ...row.transaction, status, updatedAt }),
        });
        report.updated += 1;
      }

      return report;
    },
  };
}
