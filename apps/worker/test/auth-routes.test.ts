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
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(6)));
const EMAIL = "admin@example.com";
const PASSWORD = "password-yang-panjang";

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`);
  const cipher = await createCredentialCipher(KEY);
  const users = createAdminUserRepository(db);
  const sessions = createAdminSessionService({ repo: createAdminSessionRepository(db), now: () => NOW });
  const auth = createAdminAuthService({
    users,
    sessions,
    getCipher: async () => cipher,
    setupToken: "setup-token",
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
    { adminAuth: auth, adminSessions: sessions, adminToken: "legacy-token", admin },
    { ADMIN_SETUP_TOKEN: "setup-token" },
  );
  return { ...test, sessions };
}

function json(body: unknown, cookie?: string) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

describe("route auth admin", () => {
  it("bootstrap memakai setup token, TOTP, lalu cookie sesi", async () => {
    const { app, env } = await setup();

    const status = await app.request("/admin/auth/status", {}, env);
    expect(((await status.json()) as { needsBootstrap: boolean }).needsBootstrap).toBe(true);

    const start = await app.request(
      "/admin/auth/bootstrap/start",
      json({ setupToken: "setup-token", email: EMAIL }),
      env,
    );
    const { secret } = (await start.json()) as { secret: string };

    const finish = await app.request(
      "/admin/auth/bootstrap",
      json({
        setupToken: "setup-token",
        email: EMAIL,
        password: PASSWORD,
        secret,
        totpCode: await totp(secret, NOW.getTime()),
      }),
      env,
    );
    expect(finish.status).toBe(201);
    const cookie = finish.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-gapura_admin=");
    expect(cookie).toContain("HttpOnly");
    const issue = (await finish.json()) as { csrfToken: string; admin: { email: string } };
    expect(issue.admin.email).toBe(EMAIL);

    const cookiePair = cookie.split(";")[0] ?? "";
    const session = await app.request("/admin/auth/session", { headers: { Cookie: cookiePair } }, env);
    expect(session.status).toBe(200);
  });

  it("write admin butuh CSRF saat memakai cookie", async () => {
    const { app, env } = await setup();
    const start = await app.request(
      "/admin/auth/bootstrap/start",
      json({ setupToken: "setup-token", email: EMAIL }),
      env,
    );
    const { secret } = (await start.json()) as { secret: string };
    const finish = await app.request(
      "/admin/auth/bootstrap",
      json({
        setupToken: "setup-token",
        email: EMAIL,
        password: PASSWORD,
        secret,
        totpCode: await totp(secret, NOW.getTime()),
      }),
      env,
    );
    const cookie = (finish.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const { csrfToken } = (await finish.json()) as { csrfToken: string };
    const body = { name: "Baru", prefix: "NEW", webhookUrl: "https://example.com/hook" };

    const without = await app.request("/admin/projects", json(body, cookie), env);
    expect(without.status).toBe(403);

    const withCsrf = await app.request(
      "/admin/projects",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-CSRF-Token": csrfToken,
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify(body),
      },
      env,
    );
    expect(withCsrf.status).toBe(201);
  });
});
