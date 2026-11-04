import { describe, expect, it } from "vitest";
import { createCredentialCipher } from "../src/services/credentials";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createAdminUserRepository } from "../src/repositories/admin-users";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { AdminAuthError, createAdminAuthService } from "../src/services/admin-auth";
import { totp } from "../src/services/totp";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import type { AuditEntry } from "../src/types";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const EMAIL = "admin@example.com";
const PASSWORD = "password-yang-panjang";
const SETUP = "setup-token-sekali";

async function setup() {
  const db = createTestDatabase(
    `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`,
  );
  const cipher = await createCredentialCipher(KEY);
  const users = createAdminUserRepository(db);
  const audits: AuditEntry[] = [];
  const service = createAdminAuthService({
    users,
    sessions: createAdminSessionService({
      repo: createAdminSessionRepository(db),
      now: () => NOW,
    }),
    getCipher: async () => cipher,
    setupToken: SETUP,
    issuer: "Gapura",
    now: () => NOW,
    insertAudit: async (entry) => {
      audits.push(entry);
    },
    listAudit: async (limit) => audits.slice(0, limit),
  });
  return { db, users, service, audits };
}

async function bootstrap(service: ReturnType<typeof createAdminAuthService>) {
  const start = await service.startBootstrap({ setupToken: SETUP, email: EMAIL });
  await service.finishBootstrap({
    setupToken: SETUP,
    email: EMAIL,
    password: PASSWORD,
    secret: start.secret,
    totpCode: await totp(start.secret, NOW.getTime()),
  });
  return start.secret;
}

describe("admin auth service", () => {
  it("bootstrap sekali pakai membuat owner dengan TOTP", async () => {
    const { service, users } = await setup();

    expect(await service.status()).toMatchObject({ needsBootstrap: true });
    await bootstrap(service);

    expect(await service.status()).toMatchObject({ needsBootstrap: false });
    const user = await users.findByEmail(EMAIL);
    expect(user).toMatchObject({ role: "owner", totpEnabled: true, isActive: true });
    expect(user?.totpSecretCiphertext).not.toContain("GEZD");
    await expect(
      service.startBootstrap({ setupToken: SETUP, email: EMAIL }),
    ).rejects.toMatchObject({ code: "setup_closed" });
  });

  it("menolak setup token yang salah", async () => {
    const { service } = await setup();

    await expect(
      service.startBootstrap({ setupToken: "salah", email: EMAIL }),
    ).rejects.toMatchObject({ code: "invalid_setup_token" });
    await expect(
      service.finishBootstrap({
        setupToken: "salah",
        email: EMAIL,
        password: PASSWORD,
        secret: "JBSWY3DPEHPK3PXP",
        totpCode: "123456",
      }),
    ).rejects.toMatchObject({ code: "invalid_setup_token" });
  });

  it("login butuh password dan TOTP, lalu dapat sesi", async () => {
    const { service } = await setup();
    const secret = await bootstrap(service);
    const later = NOW.getTime() + 30_000;

    const failed = await service
      .login({ email: EMAIL, password: "salah-panjang", totpCode: await totp(secret, later), ip: null, userAgent: null })
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(AdminAuthError);

    const login = await service.login({
      email: EMAIL,
      password: PASSWORD,
      totpCode: await totp(secret, later),
      ip: "1.2.3.4",
      userAgent: "vitest",
    });
    expect(login.admin).toEqual({ id: expect.any(String), email: EMAIL, role: "owner" });
    expect(login.token.length).toBeGreaterThan(30);
    expect(login.csrfToken.length).toBeGreaterThan(30);
  });

  it("menolak replay kode TOTP yang sama", async () => {
    const { service } = await setup();
    const secret = await bootstrap(service);
    const code = await totp(secret, NOW.getTime() + 30_000);

    await service.login({ email: EMAIL, password: PASSWORD, totpCode: code, ip: null, userAgent: null });

    await expect(
      service.login({ email: EMAIL, password: PASSWORD, totpCode: code, ip: null, userAgent: null }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
