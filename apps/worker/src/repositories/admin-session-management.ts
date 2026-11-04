import type { AdminRole } from "../types";

export interface AdminSessionListRecord {
  id: string;
  adminId: string;
  adminEmail: string;
  adminRole: AdminRole;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  admin_id: string;
  admin_email: string;
  admin_role: AdminRole;
  ip: string | null;
  user_agent: string | null;
  expires_at: string;
  last_seen_at: string;
  reauthenticated_at: string | null;
  created_at: string;
}

const SESSION_SELECT = `SELECT s.id, s.admin_id, u.email AS admin_email, u.role AS admin_role,
  s.ip, s.user_agent, s.expires_at, s.last_seen_at, s.reauthenticated_at, s.created_at
  FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id`;

function toRecord(row: SessionRow): AdminSessionListRecord {
  return {
    id: row.id,
    adminId: row.admin_id,
    adminEmail: row.admin_email,
    adminRole: row.admin_role,
    ip: row.ip,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    reauthenticatedAt: row.reauthenticated_at,
    createdAt: row.created_at,
  };
}

export interface AdminSessionManagementRepository {
  list(adminId: string | null, nowIso: string): Promise<AdminSessionListRecord[]>;
  find(id: string): Promise<AdminSessionListRecord | null>;
  revoke(id: string): Promise<boolean>;
  revokeOthers(adminId: string, currentSessionId: string): Promise<number>;
  deleteInactive(nowIso: string, idleBeforeIso: string): Promise<number>;
}

export function createAdminSessionManagementRepository(
  db: D1Database,
): AdminSessionManagementRepository {
  return {
    async list(adminId, nowIso): Promise<AdminSessionListRecord[]> {
      const base = `${SESSION_SELECT} WHERE s.expires_at > ?`;
      const rows = adminId
        ? await db
            .prepare(`${base} AND s.admin_id = ? ORDER BY s.last_seen_at DESC`)
            .bind(nowIso, adminId)
            .all<SessionRow>()
        : await db
            .prepare(`${base} ORDER BY s.last_seen_at DESC`)
            .bind(nowIso)
            .all<SessionRow>();
      return rows.results.map(toRecord);
    },

    async find(id): Promise<AdminSessionListRecord | null> {
      const row = await db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).bind(id).first<SessionRow>();
      return row ? toRecord(row) : null;
    },

    async revoke(id): Promise<boolean> {
      const result = await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id).run();
      return (result.meta.changes ?? 0) === 1;
    },

    async revokeOthers(adminId, currentSessionId): Promise<number> {
      const result = await db
        .prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND id != ?")
        .bind(adminId, currentSessionId)
        .run();
      return Number(result.meta.changes) || 0;
    },

    async deleteInactive(nowIso, idleBeforeIso): Promise<number> {
      const result = await db
        .prepare(
          "DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen_at <= ?",
        )
        .bind(nowIso, idleBeforeIso)
        .run();
      return Number(result.meta.changes) || 0;
    },
  };
}
