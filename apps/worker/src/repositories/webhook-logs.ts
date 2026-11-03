import type { DueWebhookAttempt, WebhookLogEntry, WebhookLogRepository } from "../types";

interface DueRow {
  id: number;
  merchant_order_id: string;
  attempt: number;
  next_attempt_at: string;
}

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

    async findDue(nowIso: string, limit: number): Promise<DueWebhookAttempt[]> {
      const rows = await db
        .prepare(
          `SELECT id, merchant_order_id, attempt, next_attempt_at
             FROM webhook_logs
            WHERE status = 'FAILED' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
            ORDER BY next_attempt_at
            LIMIT ?`,
        )
        .bind(nowIso, limit)
        .all<DueRow>();
      return rows.results.map((row) => ({
        id: row.id,
        merchantOrderId: row.merchant_order_id,
        attempt: row.attempt,
        nextAttemptAt: row.next_attempt_at,
      }));
    },

    async claim(id: number, expectedNextAttemptAt: string, leaseUntil: string): Promise<boolean> {
      const result = await db
        .prepare(
          "UPDATE webhook_logs SET next_attempt_at = ? WHERE id = ? AND next_attempt_at = ?",
        )
        .bind(leaseUntil, id, expectedNextAttemptAt)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async clearSchedule(id: number): Promise<void> {
      await db.prepare("UPDATE webhook_logs SET next_attempt_at = NULL WHERE id = ?").bind(id).run();
    },

    async markDead(id: number): Promise<void> {
      await db
        .prepare("UPDATE webhook_logs SET status = 'DEAD', next_attempt_at = NULL WHERE id = ?")
        .bind(id)
        .run();
    },
  };
}
