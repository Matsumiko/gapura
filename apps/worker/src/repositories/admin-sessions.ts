import type {
  AdminSession,
  AdminSessionRepository,
  AdminUser,
} from "../types";

interface JoinedRow {
  id: string;
  admin_id: string;
  csrf_hash: string;
  ip: string | null;
  user_agent: string | null;
  expires_at: string;
  last_seen_at: string;
  reauthenticated_at: string | null;
  created_at: string;
  admin_email: string;
  admin_role: "owner" | "admin" | "viewer";
  admin_active: number;
  totp_enabled: number;
  totp_last_counter: number | null;
}

function toSession(row: JoinedRow): AdminSession {
  return {
    id: row.id,
    adminId: row.admin_id,
    csrfHash: row.csrf_hash,
    ip: row.ip,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    reauthenticatedAt: row.reauthenticated_at,
    createdAt: row.created_at,
  };
}

function toAdmin(row: JoinedRow): AdminUser {
  return {
    id: row.admin_id,
    email: row.admin_email,
    role: row.admin_role,
    isActive: row.admin_active === 1,
    totpEnabled: row.totp_enabled === 1,
    totpLastCounter: row.totp_last_counter,
  };
}

export function createAdminSessionRepository(db: D1Database): AdminSessionRepository {
  return {
    async create(input): Promise<void> {
      await db
        .prepare(
          `INSERT INTO admin_sessions
             (id, admin_id, token_hash, csrf_hash, ip, user_agent, expires_at, last_seen_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.adminId,
          input.tokenHash,
          input.csrfHash,
          input.ip,
          input.userAgent,
          input.expiresAt,
          input.now,
          input.now,
        )
        .run();
    },

    async find(tokenHash: string): Promise<{ session: AdminSession; admin: AdminUser } | null> {
      const row = await db
        .prepare(
          `SELECT s.id, s.admin_id, s.csrf_hash, s.ip, s.user_agent, s.expires_at, s.last_seen_at,
                  s.reauthenticated_at, s.created_at,
                  u.email AS admin_email, u.role AS admin_role, u.is_active AS admin_active,
                  u.totp_enabled, u.totp_last_counter
             FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
            WHERE s.token_hash = ?`,
        )
        .bind(tokenHash)
        .first<JoinedRow>();
      return row ? { session: toSession(row), admin: toAdmin(row) } : null;
    },

    async touch(id: string, now: string): Promise<void> {
      await db
        .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    },

    async revoke(id: string): Promise<void> {
      await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id).run();
    },

    async setReauthenticated(id: string, at: string): Promise<void> {
      await db
        .prepare("UPDATE admin_sessions SET reauthenticated_at = ? WHERE id = ?")
        .bind(at, id)
        .run();
    },

    async deleteExpired(now: string): Promise<void> {
      await db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now).run();
    },
  };
}
