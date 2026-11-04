import { describe, expect, it } from "vitest";
import { createAdminMaintenanceRepository } from "../src/repositories/admin-maintenance";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { createAdminMaintenance } from "../src/services/admin-maintenance";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");

async function setup() {
  const db = createTestDatabase(
    `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`,
  );
  await db
    .prepare(
      `INSERT INTO admin_users
         (id, email, password_hash, role, totp_secret_ciphertext, totp_secret_iv,
          totp_enabled, is_active, created_at, updated_at)
       VALUES ('admin-1', 'admin@example.com', 'hash', 'owner', 'cipher', 'iv', 1, 1, ?, ?)`,
    )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();

  const insertSession = db.prepare(
    `INSERT INTO admin_sessions
       (id, admin_id, token_hash, csrf_hash, ip, user_agent, expires_at, last_seen_at, created_at)
     VALUES (?, 'admin-1', ?, 'csrf', NULL, NULL, ?, ?, ?)`,
  );
  await insertSession
    .bind("expired", "token-expired", "2026-11-01T10:00:00.000Z", NOW.toISOString(), NOW.toISOString())
    .run();
  await insertSession
    .bind("active", "token-active", "2026-11-05T10:00:00.000Z", NOW.toISOString(), NOW.toISOString())
    .run();

  const insertAttempt = db.prepare(
    `INSERT INTO admin_login_attempts (email, ip, kind, success, created_at)
     VALUES ('admin@example.com', NULL, 'password', 0, ?)`,
  );
  await insertAttempt.bind("2026-10-01T10:00:00.000Z").run();
  await insertAttempt.bind("2026-11-03T10:00:00.000Z").run();

  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => NOW,
  });
  const maintenance = createAdminMaintenance({
    sessions,
    attempts: createAdminMaintenanceRepository(db),
    now: () => NOW,
  });
  return { db, maintenance };
}

describe("pemeliharaan auth", () => {
  it("menghapus sesi kedaluwarsa dan percobaan login lebih dari 30 hari", async () => {
    const { db, maintenance } = await setup();

    const report = await maintenance.run();

    expect(report).toEqual({
      loginAttemptsPruned: 1,
      loginAttemptsCutoff: "2026-10-05T10:00:00.000Z",
    });
    const sessions = await db
      .prepare("SELECT id FROM admin_sessions ORDER BY id")
      .all<{ id: string }>();
    expect(sessions.results.map((row) => row.id)).toEqual(["active"]);
    const attempts = await db
      .prepare("SELECT created_at FROM admin_login_attempts ORDER BY id")
      .all<{ created_at: string }>();
    expect(attempts.results.map((row) => row.created_at)).toEqual([
      "2026-11-03T10:00:00.000Z",
    ]);
  });

  it("idempoten saat dijalankan berulang", async () => {
    const { maintenance } = await setup();

    await maintenance.run();
    expect(await maintenance.run()).toMatchObject({ loginAttemptsPruned: 0 });
  });
});
