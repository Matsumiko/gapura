import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createProjectsRepository } from "../src/repositories/projects";
import { createAdminService } from "../src/services/admin";
import { createAdminSessionService } from "../src/services/admin-sessions";
import { adminHeaders, seedAdminSession } from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";
import schema1 from "../migrations/0001_init.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";

const NOW = new Date("2026-11-04T10:00:00.000Z");

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema3}\n${schema5}\n${schema6}`);
  await db
    .prepare(
      `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
       VALUES ('proja', 'Project A', 'PRJA', 'hash-a', 'https://a.example/hook', 'whsec-a', 1, ?)`,
    )
    .bind(NOW.toISOString())
    .run();
  await db
    .prepare(
      `INSERT INTO transactions (merchant_order_id, project_id, project_order_id, amount, status, created_at, updated_at)
       VALUES ('PRJA-1', 'proja', '1', 1000, 'PAID', ?, ?)`,
    )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
  const statuses = ["PENDING", "FAILED", "FAILED", "DELIVERED", "DEAD"];
  for (const status of statuses) {
    await db
      .prepare(
        `INSERT INTO webhook_logs (merchant_order_id, attempt, status, created_at)
         VALUES ('PRJA-1', 1, ?, ?)`,
      )
      .bind(status, NOW.toISOString())
      .run();
  }

  const session = await seedAdminSession(db, { now: NOW, reauthenticatedAt: NOW.toISOString() });
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
    { DB_AUTH: db },
  );
  return { ...test, session };
}

describe("GET /admin/webhooks/counts", () => {
  it("mengembalikan total per status, bukan jumlah baris yang dimuat", async () => {
    const { app, env, session } = await setup();

    const response = await app.request(
      "/admin/webhooks/counts",
      { headers: adminHeaders(session) },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pending: 1,
      failed: 2,
      delivered: 1,
      dead: 1,
      total: 5,
    });
  });

  it("butuh sesi admin", async () => {
    const { app, env } = await setup();
    const response = await app.request("/admin/webhooks/counts", {}, env);
    expect(response.status).toBe(401);
  });
});
