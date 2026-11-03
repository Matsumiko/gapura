import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminService } from "../src/services/admin";
import { createCredentialCipher } from "../src/services/credentials";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createAdminUserRepository } from "../src/repositories/admin-users";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { createAdminAuthService } from "../src/services/admin-auth";
import { totp } from "../src/services/totp";
import { SESSION_COOKIE } from "../src/routes/auth";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import { adminHeaders, seedAdminSession } from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
const EMAIL = "admin@example.com";
const PASSWORD = "password-yang-panjang";
const SETUP_TOKEN = "setup-token";

async function setup() {
  const db = createTestDatabase(
    `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`,
  );
  const cipher = await createCredentialCipher(KEY);
  const users = createAdminUserRepository(db);
  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => NOW,
  });
  const auth = createAdminAuthService({
    users,
    sessions,
    getCipher: async () => cipher,
    setupToken: SETUP_TOKEN,
    issuer: "Gapura",
    now: () => NOW,
    insertAudit: async () => {},
  });
  const admin = createAdminService({
    admin: createAdminRepository(db),
    now: () => NOW,
    generateApiKey,
    generateWebhookSecret,
    sha256Hex,
  });
  const test = await createTestApp(
    { adminAuth: auth, adminSessions: sessions, admin, now: () => NOW },
    { ADMIN_SETUP_TOKEN: SETUP_TOKEN, CREDENTIALS_KEY: KEY },
  );
  return { ...test, db, users, sessions, auth, admin };
}

function json(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function cookiePair(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function bootstrap() {
  const { app, env } = await setup();
  const start = await app.request(
    "/admin/auth/bootstrap/start",
    json({ setupToken: SETUP_TOKEN, email: EMAIL }),
    env,
  );
  const { secret } = (await start.json()) as { secret: string };
  const finish = await app.request(
    "/admin/auth/bootstrap",
    json({
      setupToken: SETUP_TOKEN,
      email: EMAIL,
      password: PASSWORD,
      secret,
      totpCode: await totp(secret, NOW.getTime()),
    }),
    env,
  );
  const cookie = cookiePair(finish);
  const body = (await finish.json()) as { csrfToken: string; admin: { email: string } };
  return { app, env, secret, finish, cookie, csrfToken: body.csrfToken };
}

describe("route auth admin", () => {
  it("bootstrap memakai setup token, TOTP, lalu cookie sesi", async () => {
    const { app, env, secret, finish, cookie } = await bootstrap();

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(finish.status).toBe(201);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(finish.headers.get("set-cookie")).toContain("HttpOnly");

    const session = await app.request(
      "/admin/auth/session",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(session.status).toBe(200);
    expect((await session.json()) as { admin: { role: string } }).toMatchObject({
      admin: { email: EMAIL, role: "owner" },
    });

    const status = await app.request("/admin/auth/status", { headers: { Cookie: cookie } }, env);
    expect(await status.json()).toMatchObject({
      needsBootstrap: false,
      authenticated: true,
      admin: { email: EMAIL, role: "owner" },
      reauthWindowMinutes: 15,
    });

    const again = await app.request(
      "/admin/auth/bootstrap/start",
      json({ setupToken: SETUP_TOKEN, email: EMAIL }),
      env,
    );
    expect(again.status).toBe(401);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("SETUP_CLOSED");
  });

  it("write admin butuh CSRF lalu reauth TOTP untuk aksi sensitif", async () => {
    const { app, env, cookie, csrfToken, secret } = await bootstrap();
    const body = { name: "Baru", prefix: "NEW", webhookUrl: "https://example.com/hook" };

    const withoutCsrf = await app.request(
      "/admin/projects",
      json(body, { Cookie: cookie }),
      env,
    );
    expect(withoutCsrf.status).toBe(403);
    expect(((await withoutCsrf.json()) as { error: { code: string } }).error.code).toBe(
      "CSRF_INVALID",
    );

    const stale = await app.request(
      "/admin/projects",
      json(body, { Cookie: cookie, "X-CSRF-Token": csrfToken }),
      env,
    );
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      "REAUTH_REQUIRED",
    );

    const reauth = await app.request(
      "/admin/auth/reauth",
      json(
        { totpCode: await totp(secret, NOW.getTime() + 30_000) },
        { Cookie: cookie, "X-CSRF-Token": csrfToken },
      ),
      env,
    );
    expect(reauth.status).toBe(200);
    expect(await reauth.json()).toEqual({ ok: true, reauthenticatedAt: NOW.toISOString() });

    const withCsrf = await app.request(
      "/admin/projects",
      json(body, { Cookie: cookie, "X-CSRF-Token": csrfToken }),
      env,
    );
    expect(withCsrf.status).toBe(201);
  });

  it("login butuh password dan TOTP yang benar", async () => {
    const { app, env, secret } = await bootstrap();
    const nextCode = await totp(secret, NOW.getTime() + 30_000);

    const wrongPassword = await app.request(
      "/admin/auth/login",
      json({ email: EMAIL, password: "salah-panjang", totpCode: nextCode }),
      env,
    );
    expect(wrongPassword.status).toBe(401);
    expect(((await wrongPassword.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_CREDENTIALS",
    );

    const wrongTotp = await app.request(
      "/admin/auth/login",
      json({ email: EMAIL, password: PASSWORD, totpCode: "000000" }),
      env,
    );
    expect(wrongTotp.status).toBe(401);

    const login = await app.request(
      "/admin/auth/login",
      json({ email: EMAIL, password: PASSWORD, totpCode: nextCode }),
      env,
    );
    expect(login.status).toBe(200);
    expect(cookiePair(login)).toContain(`${SESSION_COOKIE}=`);
    expect((await login.json()) as { admin: { role: string } }).toMatchObject({
      admin: { email: EMAIL, role: "owner" },
    });
  });

  it("logout butuh CSRF dan mencabut sesi", async () => {
    const { app, env, cookie, csrfToken } = await bootstrap();

    const withoutCsrf = await app.request(
      "/admin/auth/logout",
      { method: "POST", headers: { Cookie: cookie } },
      env,
    );
    expect(withoutCsrf.status).toBe(403);

    const logout = await app.request(
      "/admin/auth/logout",
      { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken } },
      env,
    );
    expect(logout.status).toBe(200);

    const session = await app.request(
      "/admin/auth/session",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(session.status).toBe(401);
  });

  it("menolak Bearer token lama", async () => {
    const { app, env } = await setup();

    const response = await app.request(
      "/admin/projects",
      { headers: { Authorization: "Bearer legacy-token" } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("menolak viewer yang menulis walau TOTP dan CSRF valid", async () => {
    const { app, env, db } = await setup();
    const viewer = await seedAdminSession(db, { role: "viewer" });

    const response = await app.request(
      "/admin/projects",
      {
        method: "POST",
        headers: adminHeaders(viewer, { "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "X", prefix: "XXX", webhookUrl: "https://x.example/hook" }),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });
});
