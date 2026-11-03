import { sha256Hex, generateApiKey, generateWebhookSecret } from "@gapura/shared/crypto";
import { describe, expect, it } from "vitest";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createProjectsRepository } from "../src/repositories/projects";
import { createAdminService } from "../src/services/admin";
import { createAdminSessionService } from "../src/services/admin-sessions";
import type { Hono } from "hono";
import type { AdminRole, AppEnv, Env } from "../src/types";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import {
  adminHeaders,
  seedAdminSession,
  type SeededAdminSession,
} from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-03T10:00:00.000Z");

async function setup(
  options: { role?: AdminRole; reauthenticatedAt?: string | null } = {},
) {
  const db = createTestDatabase(
    `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}`,
  );
  const session = await seedAdminSession(db, {
    role: options.role,
    reauthenticatedAt: options.reauthenticatedAt,
  });
  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => new Date(),
  });
  const admin = createAdminService({
    admin: createAdminRepository(db),
    now: () => NOW,
    generateApiKey,
    generateWebhookSecret,
    sha256Hex,
  });
  const test = await createTestApp({
    projects: createProjectsRepository(db),
    admin,
    adminSessions: sessions,
  });
  return { ...test, db, session };
}

function jsonRequest(
  session: SeededAdminSession,
  body: unknown,
  extra: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: adminHeaders(session, { "Content-Type": "application/json", ...extra }),
    body: JSON.stringify(body),
  };
}

async function createProject(
  app: Hono<AppEnv>,
  env: Env,
  session: SeededAdminSession,
  body: Record<string, unknown> = {
    name: "Project Baru",
    prefix: "PBR",
    webhookUrl: "https://baru.example/hook",
  },
) {
  const response = await app.request("/admin/projects", jsonRequest(session, body), env);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("otorisasi admin", () => {
  it("menolak request tanpa sesi admin", async () => {
    const { app, env } = await setup();
    const response = await app.request("/admin/summary", {}, env);

    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "ADMIN_UNAUTHORIZED",
    );
  });

  it("menolak Bearer token lama karena auth hanya sesi", async () => {
    const { app, env } = await setup();
    const response = await app.request(
      "/admin/summary",
      { headers: { Authorization: "Bearer test-token" } },
      env,
    );

    expect(response.status).toBe(401);
  });

  it("mengizinkan viewer membaca tetapi menolak write dengan 403 FORBIDDEN", async () => {
    const { app, env, session } = await setup({ role: "viewer" });

    const read = await app.request("/admin/summary", { headers: { Cookie: session.cookie } }, env);
    expect(read.status).toBe(200);

    const write = await app.request(
      "/admin/projects",
      jsonRequest(session, { name: "X", prefix: "XXX", webhookUrl: "https://x.example/hook" }),
      env,
    );
    expect(write.status).toBe(403);
    expect(((await write.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("mengizinkan role admin melakukan write", async () => {
    const { app, env, session } = await setup({ role: "admin" });

    const response = await app.request(
      "/admin/projects",
      jsonRequest(session, { name: "X", prefix: "XXX", webhookUrl: "https://x.example/hook" }),
      env,
    );

    expect(response.status).toBe(201);
  });

  it("menolak write tanpa CSRF", async () => {
    const { app, env, session } = await setup();

    const response = await app.request(
      "/admin/projects",
      {
        method: "POST",
        headers: { Cookie: session.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "X", prefix: "XXX", webhookUrl: "https://x.example/hook" }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "CSRF_INVALID",
    );
  });

  it("menolak aksi sensitif bila reauth lebih dari 15 menit", async () => {
    const stale = new Date(Date.now() - 16 * 60_000).toISOString();
    const { app, env, session } = await setup({ reauthenticatedAt: stale });

    const response = await app.request(
      "/admin/projects",
      jsonRequest(session, { name: "X", prefix: "XXX", webhookUrl: "https://x.example/hook" }),
      env,
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "REAUTH_REQUIRED",
    );
  });

  it("mengizinkan preflight panel dengan header CSRF", async () => {
    const { app, env } = await setup();
    const response = await app.request(
      "/admin/summary",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "X-CSRF-Token",
        },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-headers")).toContain("X-CSRF-Token");
  });
});

describe("manajemen project", () => {
  it("membuat project dan mengembalikan kredensial sekali", async () => {
    const { app, env, db, session } = await setup();

    const { response, body } = await createProject(app, env, session);

    expect(response.status).toBe(201);
    expect(body.apiKey).toMatch(/^gpk_[0-9a-f]{64}$/);
    expect(body.webhookSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(body.project).toMatchObject({
      id: "pbr",
      name: "Project Baru",
      prefix: "PBR",
      isActive: true,
    });

    const stored = await db
      .prepare("SELECT api_key_hash, webhook_secret FROM projects WHERE id = 'pbr'")
      .first<{ api_key_hash: string; webhook_secret: string }>();
    expect(stored?.api_key_hash).toBe(await sha256Hex(String(body.apiKey)));
    expect(stored?.api_key_hash).not.toBe(body.apiKey);
    expect(stored?.webhook_secret).toBe(body.webhookSecret);

    const me = await app.request(
      "/v1/me",
      { headers: { "X-Gapura-Key": String(body.apiKey) } },
      env,
    );
    expect(me.status).toBe(200);
  });

  it("menolak prefix yang sudah dipakai", async () => {
    const { app, env, session } = await setup();
    await createProject(app, env, session);

    const duplicate = await createProject(app, env, session, {
      name: "Lain",
      prefix: "PBR",
      webhookUrl: "https://lain.example/hook",
    });

    expect(duplicate.response.status).toBe(409);
  });

  it("menonaktifkan project sehingga API key lama ditolak", async () => {
    const { app, env, session } = await setup();
    const created = await createProject(app, env, session);
    const apiKey = String(created.body.apiKey);

    const patch = await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: adminHeaders(session, { "Content-Type": "application/json" }),
        body: JSON.stringify({ isActive: false }),
      },
      env,
    );

    expect(patch.status).toBe(200);
    const me = await app.request("/v1/me", { headers: { "X-Gapura-Key": apiKey } }, env);
    expect(me.status).toBe(403);
  });

  it("mengedit nama dan webhook URL tanpa mengubah prefix", async () => {
    const { app, env, db, session } = await setup();
    await createProject(app, env, session);

    const response = await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: adminHeaders(session, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: "Project Baru Diubah",
          webhookUrl: "https://baru.example/hook-v2",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { project: { name: string } }).toMatchObject({
      project: { id: "pbr", name: "Project Baru Diubah", prefix: "PBR" },
    });
    const row = await db
      .prepare("SELECT name, prefix, webhook_url FROM projects WHERE id = 'pbr'")
      .first<{ name: string; prefix: string; webhook_url: string }>();
    expect(row).toEqual({
      name: "Project Baru Diubah",
      prefix: "PBR",
      webhook_url: "https://baru.example/hook-v2",
    });
  });

  it("menolak edit webhook URL tidak valid, prefix, atau campuran status", async () => {
    const { app, env, session } = await setup();
    await createProject(app, env, session);

    for (const body of [
      { webhookUrl: "ftp://baru.example/hook" },
      { prefix: "XXX" },
      { isActive: false, name: "Campur" },
      {},
    ]) {
      const response = await app.request(
        "/admin/projects/pbr",
        {
          method: "PATCH",
          headers: adminHeaders(session, { "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        },
        env,
      );
      expect(response.status).toBe(400);
    }
  });

  it("mengembalikan 404 saat mengedit project yang tidak ada", async () => {
    const { app, env, session } = await setup();

    const response = await app.request(
      "/admin/projects/tidak-ada",
      {
        method: "PATCH",
        headers: adminHeaders(session, { "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "X" }),
      },
      env,
    );

    expect(response.status).toBe(404);
  });

  it("merotasi API key dan webhook secret", async () => {
    const { app, env, session } = await setup();
    const created = await createProject(app, env, session);
    const oldKey = String(created.body.apiKey);

    const rotateKey = await app.request(
      "/admin/projects/pbr/rotate-key",
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    const rotated = (await rotateKey.json()) as { apiKey: string };
    expect(rotateKey.status).toBe(200);
    expect(rotated.apiKey).not.toBe(oldKey);

    expect(
      (await app.request("/v1/me", { headers: { "X-Gapura-Key": oldKey } }, env)).status,
    ).toBe(401);
    expect(
      (await app.request("/v1/me", { headers: { "X-Gapura-Key": rotated.apiKey } }, env)).status,
    ).toBe(200);

    const rotateSecret = await app.request(
      "/admin/projects/pbr/rotate-secret",
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(((await rotateSecret.json()) as { webhookSecret: string }).webhookSecret).toMatch(
      /^whsec_/,
    );
  });

  it("mengembalikan 404 untuk project yang tidak ada", async () => {
    const { app, env, session } = await setup();

    expect(
      (
        await app.request(
          "/admin/projects/tidak-ada/rotate-key",
          { method: "POST", headers: adminHeaders(session) },
          env,
        )
      ).status,
    ).toBe(404);
  });
});

describe("ringkasan dan transaksi", () => {
  async function seedTransactions(db: D1Database) {
    await db
      .prepare(
        `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
         VALUES ('proja', 'Project A', 'PRJA', 'hash', 'https://a.example/hook', 'whsec_a', 1, '2026-11-01T00:00:00.000Z')`,
      )
      .run();
    const insert = db.prepare(
      `INSERT INTO transactions (merchant_order_id, project_id, project_order_id, amount, payment_method, status, created_at, updated_at)
       VALUES (?, 'proja', ?, ?, 'VC', ?, ?, ?)`,
    );
    await insert.bind("PRJA-T1", "T1", 100000, "PAID", "2026-11-03T09:00:00.000Z", "2026-11-03T09:05:00.000Z").run();
    await insert.bind("PRJA-T2", "T2", 50000, "PAID", "2026-11-02T09:00:00.000Z", "2026-11-02T09:05:00.000Z").run();
    await insert.bind("PRJA-T3", "T3", 70000, "PAID", "2026-09-15T09:00:00.000Z", "2026-09-15T09:05:00.000Z").run();
    await insert.bind("PRJA-T4", "T4", 25000, "PENDING", "2026-11-03T09:30:00.000Z", "2026-11-03T09:30:00.000Z").run();
  }

  it("menghitung total PAID hari ini dan bulan ini per project", async () => {
    const { app, env, db, session } = await setup();
    await seedTransactions(db);

    const response = await app.request(
      "/admin/summary",
      { headers: { Cookie: session.cookie } },
      env,
    );
    const body = (await response.json()) as {
      today: { count: number; amount: number };
      month: { count: number; amount: number };
      projects: Array<{ projectName: string; todayAmount: number; monthAmount: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.today).toEqual({ count: 1, amount: 100000 });
    expect(body.month).toEqual({ count: 2, amount: 150000 });
    expect(body.projects[0]).toMatchObject({
      projectName: "Project A",
      todayAmount: 100000,
      monthAmount: 150000,
    });
  });

  it("memfilter transaksi dan mengambil detail dengan riwayat webhook", async () => {
    const { app, env, db, session } = await setup();
    await seedTransactions(db);
    await db
      .prepare(
        `INSERT INTO webhook_logs (merchant_order_id, attempt, http_status, error, next_attempt_at, status, created_at)
         VALUES ('PRJA-T1', 1, 500, 'HTTP 500', NULL, 'DEAD', '2026-11-03T09:06:00.000Z')`,
      )
      .run();

    const pending = await app.request(
      "/admin/transactions?status=PENDING&limit=10",
      { headers: { Cookie: session.cookie } },
      env,
    );
    const pendingBody = (await pending.json()) as { items: unknown[]; total: number };
    expect(pendingBody.total).toBe(1);
    expect(pendingBody.items).toHaveLength(1);

    const detail = await app.request(
      "/admin/transactions/PRJA-T1",
      { headers: { Cookie: session.cookie } },
      env,
    );
    const detailBody = (await detail.json()) as {
      transaction: { merchantOrderId: string };
      webhooks: Array<{ status: string; httpStatus: number }>;
    };
    expect(detailBody.transaction.merchantOrderId).toBe("PRJA-T1");
    expect(detailBody.webhooks[0]).toMatchObject({ status: "DEAD", httpStatus: 500 });
  });

  it("mengembalikan 400 untuk filter status yang tidak dikenal", async () => {
    const { app, env, session } = await setup();

    expect(
      (
        await app.request(
          "/admin/transactions?status=LAIN",
          { headers: { Cookie: session.cookie } },
          env,
        )
      ).status,
    ).toBe(400);
  });

  it("menjadwalkan ulang webhook DEAD", async () => {
    const { app, env, db, session } = await setup();
    await seedTransactions(db);
    await db
      .prepare(
        `INSERT INTO webhook_logs (merchant_order_id, attempt, http_status, error, next_attempt_at, status, created_at)
         VALUES ('PRJA-T1', 1, 500, 'HTTP 500', NULL, 'DEAD', '2026-11-03T09:06:00.000Z')`,
      )
      .run();
    const row = await db
      .prepare("SELECT id FROM webhook_logs WHERE merchant_order_id = 'PRJA-T1'")
      .first<{ id: number }>();

    const list = await app.request(
      "/admin/webhooks?status=DEAD",
      { headers: { Cookie: session.cookie } },
      env,
    );
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const retry = await app.request(
      `/admin/webhooks/${row?.id}/retry`,
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(retry.status).toBe(200);

    const updated = await db
      .prepare("SELECT status, attempt, next_attempt_at FROM webhook_logs WHERE id = ?")
      .bind(row?.id)
      .first<{ status: string; attempt: number; next_attempt_at: string }>();
    expect(updated).toEqual({
      status: "FAILED",
      attempt: 1,
      next_attempt_at: NOW.toISOString(),
    });
  });

  it("menolak retry webhook tanpa reauth yang segar", async () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    const { app, env, db, session } = await setup({ reauthenticatedAt: stale });
    await seedTransactions(db);
    await db
      .prepare(
        `INSERT INTO webhook_logs (merchant_order_id, attempt, http_status, error, next_attempt_at, status, created_at)
         VALUES ('PRJA-T1', 1, 500, 'HTTP 500', NULL, 'DEAD', '2026-11-03T09:06:00.000Z')`,
      )
      .run();
    const row = await db
      .prepare("SELECT id FROM webhook_logs WHERE merchant_order_id = 'PRJA-T1'")
      .first<{ id: number }>();

    const response = await app.request(
      `/admin/webhooks/${row?.id}/retry`,
      { method: "POST", headers: adminHeaders(session) },
      env,
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "REAUTH_REQUIRED",
    );
  });
});

describe("audit admin", () => {
  it("mencatat setiap aksi tanpa secret", async () => {
    const { app, env, db, session } = await setup();
    const created = await createProject(app, env, session);
    await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: adminHeaders(session, { "Content-Type": "application/json" }),
        body: JSON.stringify({ isActive: false }),
      },
      env,
    );
    await app.request(
      "/admin/projects/pbr/rotate-key",
      { method: "POST", headers: adminHeaders(session) },
      env,
    );

    const rows = await db
      .prepare("SELECT actor_email, action, detail FROM admin_audit ORDER BY id")
      .all<{ actor_email: string; action: string; detail: string | null }>();

    expect(rows.results.map((row) => row.action)).toEqual([
      "create_project",
      "deactivate_project",
      "rotate_api_key",
    ]);
    expect(rows.results.every((row) => row.actor_email === "admin@example.com")).toBe(true);
    const serialized = JSON.stringify(rows.results);
    expect(serialized).not.toContain(String(created.body.apiKey));
    expect(serialized).not.toContain(String(created.body.webhookSecret));
  });
});
