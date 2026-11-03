import type { WebhookLogEntry, WebhookLogRepository } from "../types";

export function createWebhookLogRepository(db: D1Database): WebhookLogRepository {
  return {
    async insertAttempt(entry: WebhookLogEntry): Promise<void> {
      await db
        .prepare(
          `INSERT INTO webhook_logs
             (merchant_order_id, attempt, http_status, error, next_attempt_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          entry.merchantOrderId,
          entry.attempt,
          entry.httpStatus,
          entry.error,
          entry.nextAttemptAt,
          entry.status,
          entry.createdAt,
        )
        .run();
    },
  };
}
