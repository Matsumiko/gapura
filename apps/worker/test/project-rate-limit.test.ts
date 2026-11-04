import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv, Env } from "../src/types";
import {
  ACTIVE_KEY,
  INACTIVE_KEY,
  createTestApp,
  fixtureProjects,
  repoFrom,
} from "./support/harness";
import { createTestDatabase } from "./support/d1";
import schema1 from "../migrations/0001_init.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";

async function seedProjects(db: D1Database): Promise<D1Database> {
  await db
    .prepare(
      `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
       VALUES ('proja', 'Project A', 'PRJA', 'hash-a', 'https://a.example/hook', 'whsec-a', 1, '2026-11-04T00:00:00.000Z')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
       VALUES ('projb', 'Project B', 'PRJB', 'hash-b', 'https://b.example/hook', 'whsec-b', 1, '2026-11-04T00:00:00.000Z')`,
    )
    .run();
  return db;
}

async function setup(options: { limit?: string; window?: string } = {}) {
  const db = await seedProjects(createTestDatabase(`${schema1}\n${schema6}`));
  const projects = await fixtureProjects();
  const projectB = projects[1];
  if (projectB) {
    projectB.isActive = true;
  }
  let current = new Date("2026-11-04T10:00:00.000Z");
  const test = await createTestApp(
    { projects: repoFrom(projects), now: () => current },
    {
      DB_SANDBOX: db,
      RATE_LIMIT_MAX: options.limit ?? "2",
      RATE_LIMIT_WINDOW_SECONDS: options.window ?? "60",
    },
  );
  return {
    ...test,
    db,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function hit(app: Hono<AppEnv>, env: Env, key = ACTIVE_KEY) {
  return app.request("/v1/me", { headers: { "X-Gapura-Key": key } }, env);
}

describe("rate limit project untuk /v1/*", () => {
  it("mengizinkan sampai batas lalu menjawab 429 dengan info retry", async () => {
    const { app, env } = await setup();

    const first = await hit(app, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("1");

    expect((await hit(app, env)).status).toBe(200);

    const limited = await hit(app, env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("X-RateLimit-Remaining")).toBe("0");
    const body = (await limited.json()) as {
      error: { code: string };
      retryAfterSeconds: number;
      resetAt: string;
    };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.retryAfterSeconds).toBe(60);
    expect(body.resetAt).toBe("2026-11-04T10:01:00.000Z");
  });

  it("menghitung per project, bukan global", async () => {
    const { app, env } = await setup({ limit: "1" });

    expect((await hit(app, env)).status).toBe(200);
    expect((await hit(app, env)).status).toBe(429);
    expect((await hit(app, env, INACTIVE_KEY)).status).toBe(200);
  });

  it("membuka window baru setelah periode berakhir", async () => {
    const { app, env, advance } = await setup({ limit: "1" });

    expect((await hit(app, env)).status).toBe(200);
    expect((await hit(app, env)).status).toBe(429);

    advance(61_000);
    const next = await hit(app, env);
    expect(next.status).toBe(200);
    expect(next.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("tidak mengaktifkan limit bila binding D1 tidak tersedia", async () => {
    const { app, env } = await createTestApp({}, { RATE_LIMIT_MAX: "1" });
    expect((await hit(app, env)).status).toBe(200);
    expect((await hit(app, env)).status).toBe(200);
  });
});
