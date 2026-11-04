import type { AuditEntry } from "../types";

export interface AdminAccountRepository {
  countRecoveryCodes(adminId: string): Promise<number>;
  revokeOtherSessions(adminId: string, currentSessionId: string): Promise<number>;
  insertAudit(entry: AuditEntry): Promise<void>;
}

export function createAdminAccountRepository(db: D1Database): AdminAccountRepository {
  return {
    async countRecoveryCodes(adminId) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS total FROM admin_recovery_codes WHERE admin_id = ? AND used_at IS NULL",
        )
        .bind(adminId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    async revokeOtherSessions(adminId, currentSessionId) {
      const result = await db
        .prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND id != ?")
        .bind(adminId, currentSessionId)
        .run();
      return Number(result.meta.changes) || 0;
    },

    async insertAudit(entry) {
      await db
        .prepare(
          `INSERT INTO admin_audit (actor_email, action, target, detail, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(entry.actorEmail, entry.action, entry.target, entry.detail, entry.createdAt)
        .run();
    },
  };
}
