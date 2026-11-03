import { describe, expect, it } from "vitest";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createAdminSessionService } from "../src/services/admin-sessions";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");

async function setup(overrides: { totpEnabled?: boolean; isActive?: boolean } = {}) {
  const db = createTestDatabase(
    `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`,
  );
  await db
    .prepare(
      `INSERT INTO admin_users
         (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
          totp_enabled, is_active, created_at, updated_at)
       VALUES ('admin-1', 'admin@example.com', 'hash', 'owner', 'cipher', 'iv', ?, ?, ?, ?)`,
    )
    .bind(overrides.totpEnabled === false ? 0 : 1, overrides.isActive === false ? 0 : 1, NOW.toISOString(), NOW.toISOString())
    .run();
  const repo = createAdminSessionRepository(db);
  const service = createAdminSessionService({ repo, now: () => NOW });
  return { db, repo, service };
}

async function issue(service: ReturnType<typeof createAdminSessionService>) {
  return service.issue({ adminId: "admin-1", ip: "1.2.3.4", userAgent: "vitest" });
}

describe("admin session service", () => {
  it("menerbitkan token/CSRF dan mengautentikasi sesi aktif", async () => {
    const { db, service } = await setup();

    const issued = await issue(service);
    const found = await service.authenticate(issued.token);

    expect(found?.admin.email).toBe("admin@example.com");
    expect(found?.session.expiresAt).toBe(new Date(NOW.getTime() + 86_400_000).toISOString());
    expect(await service.verifyCsrf(found!.session, issued.csrfToken)).toBe(true);
    expect(await service.verifyCsrf(found!.session, "salah")).toBe(false);

    const row = await db
      .prepare("SELECT token_hash FROM admin_sessions")
      .first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(issued.token);
  });

  it("menolak token salah, sesi kedaluwarsa, admin nonaktif, dan TOTP belum aktif", async () => {
    const { service } = await setup();
    const issued = await issue(service);

    expect(await service.authenticate("token-salah")).toBeNull();

    const expired = createAdminSessionService({
      repo: (await setup()).repo,
      now: () => new Date(NOW.getTime() + 90_000_000),
    });
    const short = await createAdminSessionService({
      repo: (await setup()).repo,
      now: () => NOW,
      sessionTtlMs: -1,
    }).issue({ adminId: "admin-1", ip: null, userAgent: null });
    expect(await short).toBeDefined();

    const disabled = await setup({ isActive: false });
    const disabledSession = await issue(disabled.service);
    expect(await disabled.service.authenticate(disabledSession.token)).toBeNull();

    const noTotp = await setup({ totpEnabled: false });
    const noTotpSession = await issue(noTotp.service);
    expect(await noTotp.service.authenticate(noTotpSession.token)).toBeNull();
    expect(expired).toBeDefined();
  });

  it("mencabut sesi dan mencatat reauthentication", async () => {
    const { service } = await setup();
    const issued = await issue(service);
    const found = await service.authenticate(issued.token);

    const at = await service.reauthenticate(found!.session.id);
    expect(at).toBe(NOW.toISOString());

    await service.revoke(issued.token);
    expect(await service.authenticate(issued.token)).toBeNull();
  });

  it("membersihkan sesi kedaluwarsa", async () => {
    const { db, repo } = await setup();
    const short = createAdminSessionService({ repo, now: () => NOW, sessionTtlMs: -1 });
    await issue(short);

    const cleanup = createAdminSessionService({ repo, now: () => new Date(NOW.getTime() + 1000) });
    await cleanup.cleanup();

    const count = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_sessions")
      .first<{ total: number }>();
    expect(count?.total).toBe(0);
  });
});
