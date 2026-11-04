import type { AdminRole, AuditEntry } from "../types";

export interface ManagedAdminView {
  id: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedAdminRecord extends ManagedAdminView {
  passwordHash: string;
  totpSecretCiphertext: string | null;
  totpSecretIv: string | null;
  totpLastCounter: number | null;
}

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  is_active: number;
  totp_enabled: number;
  totp_last_counter: number | null;
  totp_secret_ciphertext: string | null;
  totp_secret_iv: string | null;
  created_at: string;
  updated_at: string;
  recovery_codes_remaining: number;
}

const ADMIN_SELECT = `SELECT u.id, u.email, u.password_hash, u.role, u.is_active, u.totp_enabled,
  u.totp_last_counter, u.totp_secret_ciphertext, u.totp_secret_iv, u.created_at, u.updated_at,
  (SELECT COUNT(*) FROM admin_recovery_codes r
    WHERE r.admin_id = u.id AND r.used_at IS NULL) AS recovery_codes_remaining
  FROM admin_users u`;

function toRecord(row: AdminRow): ManagedAdminRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    totpEnabled: row.totp_enabled === 1,
    totpLastCounter: row.totp_last_counter,
    recoveryCodesRemaining: Number(row.recovery_codes_remaining) || 0,
    passwordHash: row.password_hash,
    totpSecretCiphertext: row.totp_secret_ciphertext,
    totpSecretIv: row.totp_secret_iv,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toView(row: AdminRow): ManagedAdminView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    totpEnabled: row.totp_enabled === 1,
    recoveryCodesRemaining: Number(row.recovery_codes_remaining) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AdminManagementRepository {
  list(): Promise<ManagedAdminView[]>;
  findById(id: string): Promise<ManagedAdminRecord | null>;
  findByEmail(email: string): Promise<ManagedAdminRecord | null>;
  create(input: {
    id: string;
    email: string;
    passwordHash: string;
    role: "admin" | "viewer";
    totpSecretCiphertext: string;
    totpSecretIv: string;
    now: string;
  }): Promise<boolean>;
  setActive(id: string, active: boolean, now: string): Promise<boolean>;
  setPasswordHash(id: string, hash: string, now: string): Promise<boolean>;
  setTotpSecret(
    id: string,
    input: { ciphertext: string; iv: string },
    now: string,
  ): Promise<boolean>;
  enableTotp(id: string, counter: number, now: string): Promise<boolean>;
  revokeSessionsFor(adminId: string): Promise<number>;
  insertAudit(entry: AuditEntry): Promise<void>;
}

export function createAdminManagementRepository(db: D1Database): AdminManagementRepository {
  return {
    async list(): Promise<ManagedAdminView[]> {
      const rows = await db
        .prepare(`${ADMIN_SELECT} ORDER BY u.created_at ASC, u.email ASC`)
        .all<AdminRow>();
      return rows.results.map(toView);
    },

    async findById(id: string): Promise<ManagedAdminRecord | null> {
      const row = await db.prepare(`${ADMIN_SELECT} WHERE u.id = ?`).bind(id).first<AdminRow>();
      return row ? toRecord(row) : null;
    },

    async findByEmail(email: string): Promise<ManagedAdminRecord | null> {
      const row = await db
        .prepare(`${ADMIN_SELECT} WHERE u.email = ?`)
        .bind(email.toLowerCase())
        .first<AdminRow>();
      return row ? toRecord(row) : null;
    },

    async create(input): Promise<boolean> {
      const result = await db
        .prepare(
          `INSERT INTO admin_users
             (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
              totp_enabled, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
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

    async setActive(id: string, active: boolean, now: string): Promise<boolean> {
      const result = await db
        .prepare("UPDATE admin_users SET is_active = ?, updated_at = ? WHERE id = ?")
        .bind(active ? 1 : 0, now, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async setPasswordHash(id: string, hash: string, now: string): Promise<boolean> {
      const result = await db
        .prepare("UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .bind(hash, now, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async setTotpSecret(
      id: string,
      input: { ciphertext: string; iv: string },
      now: string,
    ): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE admin_users
              SET totp_secret_ciphertext = ?, totp_secret_iv = ?, totp_enabled = 0,
                  totp_last_counter = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .bind(input.ciphertext, input.iv, now, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async enableTotp(id: string, counter: number, now: string): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE admin_users
              SET totp_enabled = 1, totp_last_counter = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(counter, now, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async revokeSessionsFor(adminId: string): Promise<number> {
      const result = await db
        .prepare("DELETE FROM admin_sessions WHERE admin_id = ?")
        .bind(adminId)
        .run();
      return Number(result.meta.changes) || 0;
    },

    async insertAudit(entry: AuditEntry): Promise<void> {
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
