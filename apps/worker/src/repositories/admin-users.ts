import type { AdminUserRecord, AdminUserRepository } from "../types";

interface Row {
  id: string;
  email: string;
  password_hash: string;
  role: "owner" | "admin" | "viewer";
  totp_secret_ciphertext: string | null;
  totp_secret_iv: string | null;
  totp_enabled: number;
  totp_last_counter: number | null;
  is_active: number;
}

function toRecord(row: Row): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    totpEnabled: row.totp_enabled === 1,
    totpLastCounter: row.totp_last_counter,
    passwordHash: row.password_hash,
    totpSecretCiphertext: row.totp_secret_ciphertext,
    totpSecretIv: row.totp_secret_iv,
  };
}

const SELECT = `SELECT id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
  totp_enabled, totp_last_counter, is_active FROM admin_users`;

export function createAdminUserRepository(db: D1Database): AdminUserRepository {
  return {
    async count(): Promise<number> {
      const row = await db.prepare("SELECT COUNT(*) AS total FROM admin_users").first<{ total: number }>();
      return row?.total ?? 0;
    },

    async findByEmail(email: string): Promise<AdminUserRecord | null> {
      const row = await db.prepare(`${SELECT} WHERE email = ?`).bind(email.toLowerCase()).first<Row>();
      return row ? toRecord(row) : null;
    },

    async findById(id: string): Promise<AdminUserRecord | null> {
      const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<Row>();
      return row ? toRecord(row) : null;
    },

    async create(input): Promise<boolean> {
      const result = await db
        .prepare(
          `INSERT INTO admin_users
             (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
              totp_enabled, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.id,
          input.email.toLowerCase(),
          input.passwordHash,
          input.role,
          input.totpSecretCiphertext,
          input.totpSecretIv,
          input.now,
          input.now,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async setTotpCounter(id: string, counter: number, now: string): Promise<void> {
      await db
        .prepare("UPDATE admin_users SET totp_last_counter = ?, updated_at = ? WHERE id = ?")
        .bind(counter, now, id)
        .run();
    },

    async recordAttempt(input): Promise<void> {
      await db
        .prepare(
          "INSERT INTO admin_login_attempts (email, ip, kind, success, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(input.email, input.ip, input.kind, input.success ? 1 : 0, input.createdAt)
        .run();
    },

    async recentFailures(email: string, ip: string | null, sinceIso: string): Promise<number> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS total FROM admin_login_attempts
            WHERE success = 0 AND created_at >= ?
              AND (email = ? OR (? IS NOT NULL AND ip = ?))`,
        )
        .bind(sinceIso, email.toLowerCase(), ip, ip)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },
  };
}
