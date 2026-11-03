import { createAdminSessionRepository } from "../../src/repositories/admin-sessions";
import { createAdminSessionService } from "../../src/services/admin-sessions";
import { hashAdminPassword } from "../../src/services/admin-password";
import { createCredentialCipher } from "../../src/services/credentials";
import { SESSION_COOKIE } from "../../src/routes/auth";
import type { AdminRole } from "../../src/types";
import { PANEL_ORIGIN } from "./harness";

export const TEST_ADMIN_ID = "admin-test";
export const TEST_ADMIN_EMAIL = "admin@example.com";
export const TEST_ADMIN_PASSWORD = "password-yang-panjang";
export const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
export const TEST_CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));

let passwordHash: Promise<string> | null = null;

/** Hash Argon2id dihitung sekali per file test supaya tetap cepat. */
export function testAdminPasswordHash(): Promise<string> {
  passwordHash ??= hashAdminPassword(TEST_ADMIN_PASSWORD);
  return passwordHash;
}

export interface SeededAdminSession {
  adminId: string;
  email: string;
  role: AdminRole;
  cookie: string;
  csrfToken: string;
  token: string;
  reauthenticatedAt: string | null;
}

export interface SeedAdminSessionOptions {
  role?: AdminRole;
  email?: string;
  adminId?: string;
  passwordHash?: string;
  totpSecret?: string;
  reauthenticatedAt?: string | null;
  now?: Date;
}

/** Seed admin user (TOTP aktif) lalu terbitkan sesi lewat service asli. */
export async function seedAdminSession(
  db: D1Database,
  options: SeedAdminSessionOptions = {},
): Promise<SeededAdminSession> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const adminId = options.adminId ?? TEST_ADMIN_ID;
  const email = options.email ?? TEST_ADMIN_EMAIL;
  const role = options.role ?? "owner";
  const cipher = await createCredentialCipher(TEST_CREDENTIALS_KEY);
  const encrypted = await cipher.encrypt(options.totpSecret ?? TEST_TOTP_SECRET);

  await db
    .prepare(
      `INSERT INTO admin_users
         (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
          totp_enabled, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .bind(
      adminId,
      email,
      options.passwordHash ?? "unused-test-hash",
      role,
      encrypted.ciphertext,
      encrypted.iv,
      nowIso,
      nowIso,
    )
    .run();

  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => now,
  });
  const issued = await sessions.issue({ adminId, ip: null, userAgent: "vitest" });

  const reauthenticatedAt =
    options.reauthenticatedAt === undefined ? nowIso : options.reauthenticatedAt;
  if (reauthenticatedAt) {
    await db
      .prepare("UPDATE admin_sessions SET reauthenticated_at = ? WHERE admin_id = ?")
      .bind(reauthenticatedAt, adminId)
      .run();
  }

  return {
    adminId,
    email,
    role,
    cookie: `${SESSION_COOKIE}=${issued.token}`,
    csrfToken: issued.csrfToken,
    token: issued.token,
    reauthenticatedAt,
  };
}

/** Header Cookie + CSRF untuk request tulis admin. */
export function adminHeaders(
  session: SeededAdminSession,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Cookie: session.cookie,
    "X-CSRF-Token": session.csrfToken,
    Origin: PANEL_ORIGIN,
    ...extra,
  };
}
