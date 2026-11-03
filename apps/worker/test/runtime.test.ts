import { sha256Hex } from "@gapura/shared/crypto";
import { describe, expect, it } from "vitest";
import { runtimeFor } from "../src/index";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import type { Env } from "../src/types";
import { createTestDatabase } from "./support/d1";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
const SANDBOX_KEY = "gpk_sandbox_runtime";
const PRODUCTION_KEY = "gpk_production_runtime";
const ADMIN = { Authorization: "Bearer test-token" };

async function seedProject(db: D1Database, id: string, name: string, prefix: string, key: string) {
  await db
    .prepare(
      `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
       VALUES (?, ?, ?, ?, 'https://example.com/hook', 'whsec', 1, '2026-11-04T00:00:00.000Z')`,
    )
    .bind(id, name, prefix, await sha256Hex(key))
    .run();
}

async function setup() {
  const sandboxDb = createTestDatabase(`${schema1}\n${schema2}\n${schema3}\n${schema4}`);
  const productionDb = createTestDatabase(`${schema1}\n${schema2}\n${schema3}\n${schema4}`);
  await seedProject(sandboxDb, "proja", "Sandbox A", "SND", SANDBOX_KEY);
  await seedProject(productionDb, "proja", "Production A", "PRD", PRODUCTION_KEY);

  const env = {
    DB_SANDBOX: sandboxDb,
    DB_PRODUCTION: productionDb,
    ENVIRONMENT: "test",
    PUBLIC_BASE_URL: "https://gapura.test",
    PANEL_ORIGIN: "http://localhost:5173",
    ADMIN_TOKEN: "test-token",
    CREDENTIALS_KEY: KEY,
  } as Env;

  return { env, runtime: runtimeFor(env) };
}

describe("pemisahan route environment", () => {
  it("melayani project dari database masing-masing", async () => {
    const { env, runtime } = await setup();

    const sandbox = await runtime.root.request(
      "/sandbox/v1/me",
      { headers: { "X-Gapura-Key": SANDBOX_KEY } },
      env,
    );
    const production = await runtime.root.request(
      "/production/v1/me",
      { headers: { "X-Gapura-Key": PRODUCTION_KEY } },
      env,
    );
    const cross = await runtime.root.request(
      "/production/v1/me",
      { headers: { "X-Gapura-Key": SANDBOX_KEY } },
      env,
    );

    expect(await sandbox.json()).toEqual({
      project: { id: "proja", name: "Sandbox A", prefix: "SND" },
    });
    expect(await production.json()).toEqual({
      project: { id: "proja", name: "Production A", prefix: "PRD" },
    });
    expect(cross.status).toBe(401);
  });

  it("mempertahankan path lama sebagai sandbox", async () => {
    const { env, runtime } = await setup();

    const legacy = await runtime.root.request(
      "/v1/me",
      { headers: { "X-Gapura-Key": SANDBOX_KEY } },
      env,
    );

    expect(((await legacy.json()) as { project: { name: string } }).project.name).toBe("Sandbox A");
  });

  it("memisahkan admin project per environment", async () => {
    const { env, runtime } = await setup();

    const sandbox = await runtime.root.request("/sandbox/admin/projects", { headers: ADMIN }, env);
    const production = await runtime.root.request(
      "/production/admin/projects",
      { headers: ADMIN },
      env,
    );

    expect(((await sandbox.json()) as { items: Array<{ name: string }> }).items[0]?.name).toBe(
      "Sandbox A",
    );
    expect(((await production.json()) as { items: Array<{ name: string }> }).items[0]?.name).toBe(
      "Production A",
    );
  });

  it("membatasi pengaturan ke environment milik route", async () => {
    const { env, runtime } = await setup();

    const sandboxSettings = await runtime.root.request(
      "/sandbox/admin/settings",
      { headers: ADMIN },
      env,
    );
    const overview = (await sandboxSettings.json()) as {
      callbackUrl: string;
      items: Array<{ environment: string }>;
    };

    expect(overview.callbackUrl).toBe("https://gapura.test/sandbox/callback/duitku");
    expect(overview.items.map((item) => item.environment)).toEqual(["sandbox"]);

    const wrong = await runtime.root.request(
      "/sandbox/admin/settings/production",
      {
        method: "PUT",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify({ merchantCode: "X" }),
      },
      env,
    );
    expect(wrong.status).toBe(400);
  });
});
