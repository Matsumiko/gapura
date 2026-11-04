import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createProjectsRepository } from "../src/repositories/projects";
import { createAdminService } from "../src/services/admin";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { verifyAdminPassword } from "../src/services/admin-password";
import { totp } from "../src/services/totp";
import type { AdminRole, AppEnv, Env } from "../src/types";
import type { Hono } from "hono";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";
import {
  adminHeaders,
  seedAdminSession,
  type SeededAdminSession,
} from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const PASSWORD = "password-admin-baru";
const NEW_PASSWORD = "password-hasil-reset";

const SCHEMA = `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}\n${schema6}`;

async function setup(
  options: { role?: AdminRole; reauthenticatedAt?: string | null } = {},
) {
  const db = createTestDatabase(SCHEMA);
  const session = await seedAdminSession(db, {
    role: options.role,
    now: NOW,
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
      projects: createProjectsRepository(db),
      admin,
      adminSessions: sessions,
      now: () => NOW,
    },
    { DB_AUTH: db, CREDENTIALS_KEY: KEY },
  );
  return { ...test, db, session, sessions };
}

function jsonRequest(
  session: SeededAdminSession | null,
  body: unknown,
  extra: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: {
      ...(session ? adminHeaders(session) : {}),
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  };
}

async function createAdmin(
  app: Hono<AppEnv>,
  env: Env,
  session: SeededAdminSession,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.request(
    "/admin/admins",
    jsonRequest(session, {
      email: "baru@example.com",
      role: "admin",
      password: PASSWORD,
      ...overrides,
    }),
    env,
  );
  return {
    response,
    body: (await response.json()) as {
      admin: { id: string; email: string; totpEnabled: boolean; isActive: boolean };
      initialPassword: string;
      secret: string;
      otpauthUri: string;
    },
  };
}

async function activate(
  app: Hono<AppEnv>,
  env: Env,
  session: SeededAdminSession,
  id: string,
  secret: string,
  offsetMs = 0,
) {
  const response = await app.request(
    `/admin/admins/${id}/activate`,
    jsonRequest(session, { totpCode: await totp(secret, NOW.getTime() + offsetMs) }),
    env,
  );
  return {
    response,
    body: (await response.json()) as {
      admin: { totpEnabled: boolean };
      recoveryCodes: string[];
    },
  };
}

async function createdAndActivated(
  app: Hono<AppEnv>,
  env: Env,
  session: SeededAdminSession,
) {
  const created = await createAdmin(app, env, session);
  const activated = await activate(app, env, session, created.body.admin.id, created.body.secret);
  return { created: created.body, activated: activated.body };
}

describe("manajemen admin", () => {
  it("owner membuat admin; password dan secret TOTP hanya tampil sekali", async () => {
    const { app, env, session, db } = await setup();

    const { response, body } = await createAdmin(app, env, session);

    expect(response.status).toBe(201);
    expect(body.admin).toMatchObject({
      email: "baru@example.com",
      role: "admin",
      isActive: true,
      totpEnabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(body.initialPassword).toBe(PASSWORD);
    expect(body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.otpauthUri).toContain("otpauth://totp/");
    expect(body.otpauthUri).toContain("Gapura");

    const row = await db
      .prepare("SELECT password_hash, totp_secret_ciphertext FROM admin_users WHERE email = ?")
      .bind("baru@example.com")
      .first<{ password_hash: string; totp_secret_ciphertext: string }>();
    expect(row?.password_hash).not.toBe(PASSWORD);
    expect(await verifyAdminPassword(PASSWORD, row?.password_hash ?? "")).toBe(true);
    expect(row?.totp_secret_ciphertext).not.toContain(body.secret);

    const list = await app.request("/admin/admins", { headers: adminHeaders(session) }, env);
    const text = await list.text();
    expect(list.status).toBe(200);
    expect(text).not.toContain(body.secret);
    expect(text).not.toContain(body.initialPassword);
    expect(text).not.toContain(row?.password_hash ?? "tidak-ada");
    expect(text).not.toContain(row?.totp_secret_ciphertext ?? "tidak-ada");
  });

  it("aktivasi TOTP menghasilkan 8 kode pemulihan sekali pakai", async () => {
    const { app, env, session, db } = await setup();
    const { body: created } = await createAdmin(app, env, session);

    const { response, body } = await activate(
      app,
      env,
      session,
      created.admin.id,
      created.secret,
    );

    expect(response.status).toBe(200);
    expect(body.admin.totpEnabled).toBe(true);
    expect(body.recoveryCodes).toHaveLength(8);
    for (const code of body.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    }

    const rows = await db
      .prepare(
        "SELECT code_hash, used_at FROM admin_recovery_codes WHERE admin_id = ? ORDER BY id",
      )
      .bind(created.admin.id)
      .all<{ code_hash: string; used_at: string | null }>();
    expect(rows.results).toHaveLength(8);
    expect(rows.results.every((row) => row.used_at === null)).toBe(true);
    expect(rows.results.map((row) => row.code_hash)).not.toContain(body.recoveryCodes[0]);

    const list = await app.request("/admin/admins", { headers: adminHeaders(session) }, env);
    const listed = (await list.json()) as {
      items: Array<{ email: string; recoveryCodesRemaining: number }>;
    };
    expect(listed.items.find((item) => item.email === "baru@example.com")).toMatchObject({
      recoveryCodesRemaining: 8,
    });

    const again = await activate(app, env, session, created.admin.id, created.secret);
    expect(again.response.status).toBe(409);
  });

  it("menolak aktivasi dengan kode TOTP salah", async () => {
    const { app, env, session } = await setup();
    const { body: created } = await createAdmin(app, env, session);

    const response = await app.request(
      `/admin/admins/${created.admin.id}/activate`,
      jsonRequest(session, { totpCode: "000000" }),
      env,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_TOTP",
    );
  });

  it("hanya owner dan butuh reauth TOTP untuk mengubah admin", async () => {
    const adminSetup = await setup({ role: "admin" });
    const forbidden = await createAdmin(adminSetup.app, adminSetup.env, adminSetup.session);
    expect(forbidden.response.status).toBe(403);

    const viewerSetup = await setup({ role: "viewer" });
    const viewerRead = await viewerSetup.app.request(
      "/admin/admins",
      { headers: adminHeaders(viewerSetup.session) },
      viewerSetup.env,
    );
    expect(viewerRead.status).toBe(403);

    const staleSetup = await setup({ reauthenticatedAt: null });
    const stale = await createAdmin(staleSetup.app, staleSetup.env, staleSetup.session);
    expect(stale.response.status).toBe(403);
  });

  it("deaktivasi mencabut sesi admin dan menolak akun sendiri", async () => {
    const { app, env, session, db, sessions } = await setup();
    const { created, activated } = await createdAndActivated(app, env, session);
    const issued = await sessions.issue({
      adminId: created.admin.id,
      ip: null,
      userAgent: "vitest",
    });
    expect(issued.token).toBeTruthy();

    const response = await app.request(
      `/admin/admins/${created.admin.id}/deactivate`,
      jsonRequest(session, {}),
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { admin: { isActive: boolean } }).toMatchObject({
      admin: { isActive: false },
    });
    const sessionsLeft = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_sessions WHERE admin_id = ?")
      .bind(created.admin.id)
      .first<{ total: number }>();
    expect(sessionsLeft?.total).toBe(0);
    expect(activated.recoveryCodes).toHaveLength(8);

    const self = await app.request(
      `/admin/admins/${session.adminId}/deactivate`,
      jsonRequest(session, {}),
      env,
    );
    expect(self.status).toBe(409);
    expect(((await self.json()) as { error: { code: string } }).error.code).toBe("SELF_ACTION");
  });

  it("reset password menampilkan password baru sekali dan mencabut sesi", async () => {
    const { app, env, session, db, sessions } = await setup();
    const { created } = await createdAndActivated(app, env, session);
    await sessions.issue({ adminId: created.admin.id, ip: null, userAgent: "vitest" });

    const response = await app.request(
      `/admin/admins/${created.admin.id}/reset-password`,
      jsonRequest(session, { password: NEW_PASSWORD }),
      env,
    );
    const body = (await response.json()) as { newPassword: string };
    expect(response.status).toBe(200);
    expect(body.newPassword).toBe(NEW_PASSWORD);

    const row = await db
      .prepare("SELECT password_hash FROM admin_users WHERE id = ?")
      .bind(created.admin.id)
      .first<{ password_hash: string }>();
    expect(await verifyAdminPassword(NEW_PASSWORD, row?.password_hash ?? "")).toBe(true);
    const sessionsLeft = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_sessions WHERE admin_id = ?")
      .bind(created.admin.id)
      .first<{ total: number }>();
    expect(sessionsLeft?.total).toBe(0);

    const invalid = await app.request(
      `/admin/admins/${created.admin.id}/reset-password`,
      jsonRequest(session, { password: "pendek" }),
      env,
    );
    expect(invalid.status).toBe(400);
  });

  it("reset TOTP mengganti secret, menonaktifkan TOTP, dan menghapus kode pemulihan", async () => {
    const { app, env, session, db } = await setup();
    const { created, activated } = await createdAndActivated(app, env, session);
    expect(activated.recoveryCodes).toHaveLength(8);

    const response = await app.request(
      `/admin/admins/${created.admin.id}/reset-totp`,
      jsonRequest(session, {}),
      env,
    );
    const body = (await response.json()) as {
      admin: { totpEnabled: boolean; recoveryCodesRemaining: number };
      secret: string;
      otpauthUri: string;
    };
    expect(response.status).toBe(200);
    expect(body.admin).toMatchObject({ totpEnabled: false, recoveryCodesRemaining: 0 });
    expect(body.secret).not.toBe(created.secret);
    expect(body.otpauthUri).toContain(body.secret);

    const codes = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_recovery_codes WHERE admin_id = ?")
      .bind(created.admin.id)
      .first<{ total: number }>();
    expect(codes?.total).toBe(0);

    const list = await app.request("/admin/admins", { headers: adminHeaders(session) }, env);
    expect(await list.text()).not.toContain(body.secret);
  });

  it("regenerasi kode pemulihan mengganti kode lama", async () => {
    const { app, env, session } = await setup();
    const { created, activated } = await createdAndActivated(app, env, session);

    const response = await app.request(
      `/admin/admins/${created.admin.id}/recovery-codes`,
      jsonRequest(session, {}),
      env,
    );
    const body = (await response.json()) as { recoveryCodes: string[] };
    expect(response.status).toBe(200);
    expect(body.recoveryCodes).toHaveLength(8);
    expect(body.recoveryCodes).not.toEqual(activated.recoveryCodes);

    const login = await app.request(
      "/admin/auth/recovery-login",
      jsonRequest(null, {
        email: created.admin.email,
        password: PASSWORD,
        recoveryCode: activated.recoveryCodes[0],
      }),
      env,
    );
    expect(login.status).toBe(401);

    const fresh = await app.request(
      "/admin/auth/recovery-login",
      jsonRequest(null, {
        email: created.admin.email,
        password: PASSWORD,
        recoveryCode: body.recoveryCodes[0],
      }),
      env,
    );
    expect(fresh.status).toBe(200);
  });

  it("recovery login memakai password + kode sekali pakai tanpa mematikan TOTP", async () => {
    const { app, env, session, db } = await setup();
    const { created, activated } = await createdAndActivated(app, env, session);

    const login = await app.request(
      "/admin/auth/recovery-login",
      jsonRequest(null, {
        email: created.admin.email,
        password: PASSWORD,
        recoveryCode: activated.recoveryCodes[0],
      }),
      env,
    );
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("__Host-gapura_admin=");
    expect((await login.json()) as { admin: { email: string; role: string } }).toMatchObject({
      admin: { email: created.admin.email, role: "admin" },
    });

    const replay = await app.request(
      "/admin/auth/recovery-login",
      jsonRequest(null, {
        email: created.admin.email,
        password: PASSWORD,
        recoveryCode: activated.recoveryCodes[0],
      }),
      env,
    );
    expect(replay.status).toBe(401);

    const wrongPassword = await app.request(
      "/admin/auth/recovery-login",
      jsonRequest(null, {
        email: created.admin.email,
        password: "password-salah-panjang",
        recoveryCode: activated.recoveryCodes[1],
      }),
      env,
    );
    expect(wrongPassword.status).toBe(401);

    const used = await db
      .prepare(
        "SELECT used_at FROM admin_recovery_codes WHERE admin_id = ? ORDER BY id LIMIT 1",
      )
      .bind(created.admin.id)
      .first<{ used_at: string | null }>();
    expect(used?.used_at).not.toBeNull();

    const user = await db
      .prepare("SELECT totp_enabled FROM admin_users WHERE id = ?")
      .bind(created.admin.id)
      .first<{ totp_enabled: number }>();
    expect(user?.totp_enabled).toBe(1);

    const audit = await db
      .prepare("SELECT action FROM admin_audit WHERE actor_email = ? ORDER BY id")
      .bind(created.admin.email)
      .all<{ action: string }>();
    expect(audit.results.map((row) => row.action)).toContain("recovery_login:success");
  });
});
