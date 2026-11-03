import { sha256Hex, generateApiKey, generateWebhookSecret } from "@gapura/shared/crypto";
import { describe, expect, it } from "vitest";
import { createAdminRepository } from "../src/repositories/admin";
import { createProjectsRepository } from "../src/repositories/projects";
import { createAdminService } from "../src/services/admin";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const ADMIN = { Authorization: "Bearer test-token" };

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}\n${schema3}`);
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
    adminToken: "test-token",
  });
  return { ...test, db, admin };
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { ...ADMIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function createProject(
  app: Awaited<ReturnType<typeof setup>>["app"],
  env: Awaited<ReturnType<typeof setup>>["env"],
  body: Record<string, unknown> = {
    name: "Project Baru",
    prefix: "PBR",
    webhookUrl: "https://baru.example/hook",
  },
) {
  const response = await app.request("/admin/projects", jsonRequest(body), env);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("otorisasi admin", () => {
  it("menolak request tanpa token admin", async () => {
    const { app, env } = await setup();
    const response = await app.request("/admin/summary", {}, env);

    expect(response.status).toBe(401);
  });

  it("menolak token admin yang salah", async () => {
    const { app, env } = await setup();
    const response = await app.request(
      "/admin/summary",
      { headers: { Authorization: "Bearer salah" } },
      env,
    );

    expect(response.status).toBe(401);
  });

  it("menonaktifkan endpoint admin bila ADMIN_TOKEN belum diset", async () => {
    const withoutToken = await createTestApp({ adminToken: undefined });

    const response = await withoutToken.app.request("/admin/summary", {}, withoutToken.env);

    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "ADMIN_NOT_CONFIGURED",
    );
  });

  it("mengizinkan preflight panel dengan header Authorization", async () => {
    const { app, env } = await setup();
    const response = await app.request(
      "/admin/summary",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization",
        },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("manajemen project", () => {
  it("membuat project dan mengembalikan kredensial sekali", async () => {
    const { app, env, db } = await setup();

    const { response, body } = await createProject(app, env);

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
    const { app, env } = await setup();
    await createProject(app, env);

    const duplicate = await createProject(app, env, {
      name: "Lain",
      prefix: "PBR",
      webhookUrl: "https://lain.example/hook",
    });

    expect(duplicate.response.status).toBe(409);
  });

  it("menonaktifkan project sehingga API key lama ditolak", async () => {
    const { app, env } = await setup();
    const created = await createProject(app, env);
    const apiKey = String(created.body.apiKey);

    const patch = await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      },
      env,
    );

    expect(patch.status).toBe(200);
    const me = await app.request("/v1/me", { headers: { "X-Gapura-Key": apiKey } }, env);
    expect(me.status).toBe(403);
  });

  it("mengedit nama dan webhook URL tanpa mengubah prefix", async () => {
    const { app, env, db } = await setup();
    await createProject(app, env);

    const response = await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: { ...ADMIN, "Content-Type": "application/json" },
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
    const { app, env } = await setup();
    await createProject(app, env);

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
          headers: { ...ADMIN, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
      expect(response.status).toBe(400);
    }
  });

  it("mengembalikan 404 saat mengedit project yang tidak ada", async () => {
    const { app, env } = await setup();

    const response = await app.request(
      "/admin/projects/tidak-ada",
      {
        method: "PATCH",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      },
      env,
    );

    expect(response.status).toBe(404);
  });

  it("merotasi API key dan webhook secret", async () => {
    const { app, env } = await setup();
    const created = await createProject(app, env);
    const oldKey = String(created.body.apiKey);

    const rotateKey = await app.request(
      "/admin/projects/pbr/rotate-key",
      { method: "POST", headers: ADMIN },
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
      { method: "POST", headers: ADMIN },
      env,
    );
    expect(((await rotateSecret.json()) as { webhookSecret: string }).webhookSecret).toMatch(
      /^whsec_/,
    );
  });

  it("mengembalikan 404 untuk project yang tidak ada", async () => {
    const { app, env } = await setup();

    expect(
      (await app.request("/admin/projects/tidak-ada/rotate-key", { method: "POST", headers: ADMIN }, env))
        .status,
    ).toBe(404);
  });
});

describe("ringkasan dan transaksi", () => {
  async function seedTransactions(db: Awaited<ReturnType<typeof setup>>["db"]) {
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
    const { app, env, db } = await setup();
    await seedTransactions(db);

    const response = await app.request("/admin/summary", { headers: ADMIN }, env);
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
    const { app, env, db } = await setup();
    await seedTransactions(db);
    await db
      .prepare(
        `INSERT INTO webhook_logs (merchant_order_id, attempt, http_status, error, next_attempt_at, status, created_at)
         VALUES ('PRJA-T1', 1, 500, 'HTTP 500', NULL, 'DEAD', '2026-11-03T09:06:00.000Z')`,
      )
      .run();

    const pending = await app.request(
      "/admin/transactions?status=PENDING&limit=10",
      { headers: ADMIN },
      env,
    );
    const pendingBody = (await pending.json()) as { items: unknown[]; total: number };
    expect(pendingBody.total).toBe(1);
    expect(pendingBody.items).toHaveLength(1);

    const detail = await app.request("/admin/transactions/PRJA-T1", { headers: ADMIN }, env);
    const detailBody = (await detail.json()) as {
      transaction: { merchantOrderId: string };
      webhooks: Array<{ status: string; httpStatus: number }>;
    };
    expect(detailBody.transaction.merchantOrderId).toBe("PRJA-T1");
    expect(detailBody.webhooks[0]).toMatchObject({ status: "DEAD", httpStatus: 500 });
  });

  it("mengembalikan 400 untuk filter status yang tidak dikenal", async () => {
    const { app, env } = await setup();

    expect(
      (await app.request("/admin/transactions?status=LAIN", { headers: ADMIN }, env)).status,
    ).toBe(400);
  });

  it("menjadwalkan ulang webhook DEAD", async () => {
    const { app, env, db } = await setup();
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

    const list = await app.request("/admin/webhooks?status=DEAD", { headers: ADMIN }, env);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const retry = await app.request(
      `/admin/webhooks/${row?.id}/retry`,
      { method: "POST", headers: ADMIN },
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
});

describe("audit admin", () => {
  it("mencatat setiap aksi tanpa secret", async () => {
    const { app, env, db } = await setup();
    const created = await createProject(app, env);
    await app.request(
      "/admin/projects/pbr",
      {
        method: "PATCH",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      },
      env,
    );
    await app.request("/admin/projects/pbr/rotate-key", { method: "POST", headers: ADMIN }, env);

    const rows = await db
      .prepare("SELECT actor_email, action, detail FROM admin_audit ORDER BY id")
      .all<{ actor_email: string; action: string; detail: string | null }>();

    expect(rows.results.map((row) => row.action)).toEqual([
      "create_project",
      "deactivate_project",
      "rotate_api_key",
    ]);
    expect(rows.results.every((row) => row.actor_email === "admin-token")).toBe(true);
    const serialized = JSON.stringify(rows.results);
    expect(serialized).not.toContain(String(created.body.apiKey));
    expect(serialized).not.toContain(String(created.body.webhookSecret));
  });
});
