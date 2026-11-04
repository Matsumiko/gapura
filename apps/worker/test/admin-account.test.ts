import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminRecoveryRepository } from "../src/repositories/admin-recovery";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { createAdminService } from "../src/services/admin";
import { hashAdminPassword, verifyAdminPassword } from "../src/services/admin-password";
import { createAdminRecoveryService } from "../src/services/admin-recovery";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";
import {
  adminHeaders,
  seedAdminSession,
  TEST_CREDENTIALS_KEY,
  type SeededAdminSession,
} from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const PASSWORD = "password-akun-lama";
const NEW_PASSWORD = "password-akun-baru-panjang";
const SCHEMA = `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}\n${schema6}`;

async function setup(options: { reauthenticatedAt?: string | null; role?: "owner" | "admin" | "viewer" } = {}) {
  const db = createTestDatabase(SCHEMA);
  const session = await seedAdminSession(db, {
    now: NOW,
    role: options.role,
    passwordHash: await hashAdminPassword(PASSWORD),
    reauthenticatedAt:
      options.reauthenticatedAt === undefined ? NOW.toISOString() : options.reauthenticatedAt,
  });
  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => NOW,
  });
  const admin = createAdminService({
    admin: createAdminRepository(db),
    now: () => NOW,
    generateApiKey,
    generateWebhookSecret,
    sha256Hex,
  });
  const test = await createTestApp(
    {
      projects: {
        async findByApiKeyHash() {
          return null;
        },
      },
      admin,
      adminSessions: sessions,
      now: () => NOW,
    },
    { DB_AUTH: db, CREDENTIALS_KEY: TEST_CREDENTIALS_KEY },
  );
  return { ...test, db, session, sessions };
}

function request(
  session: SeededAdminSession,
  path: string,
  body?: unknown,
  method = "POST",
): RequestInit {
  return {
    method,
    headers: adminHeaders(session, body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describe("pengaturan akun sendiri", () => {
  it("menampilkan email, role, dan jumlah kode pemulihan", async () => {
    const { app, env, session } = await setup();
    const response = await app.request("/admin/account", { headers: adminHeaders(session) }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      account: { email: string; role: string; totpEnabled: boolean };
    };
    expect(body.account.email).toBe(session.email);
    expect(body.account.role).toBe("owner");
    expect(body.account.totpEnabled).toBe(true);
  });

  it("mengubah email setelah verifikasi password, lalu mencabut sesi lain", async () => {
    const { app, env, db, session, sessions } = await setup();
    const other = await sessions.issue({ adminId: session.adminId, ip: null, userAgent: "other" });
    expect(other.token).not.toBe(session.token);

    const response = await app.request(
      "/admin/account/email",
      request(session, "/admin/account/email", {
        email: "baru@example.com",
        password: PASSWORD,
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      account: { email: string };
      revokedSessions: number;
    };
    expect(body.account.email).toBe("baru@example.com");
    expect(body.revokedSessions).toBe(1);

    const old = await db
      .prepare("SELECT id FROM admin_sessions WHERE admin_id = ?")
      .bind(session.adminId)
      .all<{ id: string }>();
    expect(old.results).toHaveLength(1);
    expect(old.results[0]?.id).toBeDefined();
    const user = await db
      .prepare("SELECT email FROM admin_users WHERE id = ?")
      .bind(session.adminId)
      .first<{ email: string }>();
    expect(user?.email).toBe("baru@example.com");
  });

  it("menolak email yang sudah dipakai dan password salah", async () => {
    const { app, env, db, session } = await setup();
    await db
      .prepare(
        `INSERT INTO admin_users
           (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
            totp_enabled, is_active, created_at, updated_at)
         SELECT 'lain', 'lain@example.com', password_hash, 'viewer',
                totp_secret_ciphertext, totp_secret_iv, 1, 1, ?, ?
           FROM admin_users WHERE id = ?`,
      )
      .bind(NOW.toISOString(), NOW.toISOString(), session.adminId)
      .run();

    const conflict = await app.request(
      "/admin/account/email",
      request(session, "/admin/account/email", {
        email: "lain@example.com",
        password: PASSWORD,
      }),
      env,
    );
    expect(conflict.status).toBe(409);

    const wrong = await app.request(
      "/admin/account/password",
      request(session, "/admin/account/password", {
        currentPassword: "password-salah-sekali",
        newPassword: NEW_PASSWORD,
      }),
      env,
    );
    expect(wrong.status).toBe(400);
  });

  it("mengganti password, mencabut sesi lain, dan menolak sesi tanpa reauth", async () => {
    const { app, env, db, session, sessions } = await setup();
    await sessions.issue({ adminId: session.adminId, ip: null, userAgent: "other" });

    const changed = await app.request(
      "/admin/account/password",
      request(session, "/admin/account/password", {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
      env,
    );
    expect(changed.status).toBe(200);
    const body = (await changed.json()) as { revokedSessions: number };
    expect(body.revokedSessions).toBe(1);

    const user = await db
      .prepare("SELECT password_hash FROM admin_users WHERE id = ?")
      .bind(session.adminId)
      .first<{ password_hash: string }>();
    expect(await verifyAdminPassword(PASSWORD, user?.password_hash ?? "")).toBe(false);
    expect(await verifyAdminPassword(NEW_PASSWORD, user?.password_hash ?? "")).toBe(true);

    const stale = await setup({ reauthenticatedAt: null });
    const denied = await stale.app.request(
      "/admin/account/password",
      request(stale.session, "/admin/account/password", {
        currentPassword: PASSWORD,
        newPassword: "password-ketiga-yang-panjang",
      }),
      stale.env,
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    expect(deniedBody.error.code).toBe("REAUTH_REQUIRED");
  });

  it("mengizinkan viewer mengubah kredensial akunnya sendiri", async () => {
    const { app, env, session } = await setup({ role: "viewer" });
    const response = await app.request(
      "/admin/account/password",
      request(session, "/admin/account/password", {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
      env,
    );
    expect(response.status).toBe(200);
  });

  it("membuat ulang 8 kode pemulihan dan menonaktifkan kode lama", async () => {
    const { app, env, db, session } = await setup();
    const recovery = createAdminRecoveryService({
      repo: createAdminRecoveryRepository(db),
      now: () => NOW,
    });
    const first = await recovery.issue(session.adminId);
    const firstCode = first[0] ?? "";

    const response = await app.request(
      "/admin/account/recovery-codes",
      request(session, "/admin/account/recovery-codes", {
        password: PASSWORD,
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { codes: string[] };
    expect(body.codes).toHaveLength(8);
    expect(body.codes).not.toContain(firstCode);
    expect(await recovery.consume(session.adminId, firstCode)).toBe(false);
    expect(await recovery.consume(session.adminId, body.codes[0] ?? "")).toBe(true);

    const row = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_recovery_codes WHERE admin_id = ? AND used_at IS NULL")
      .bind(session.adminId)
      .first<{ total: number }>();
    expect(row?.total).toBe(7);
  });
});
