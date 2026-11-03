import { sha256Hex } from "@gapura/shared/crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { ErrorBody } from "../src/http";
import type { Env, ProjectRecord, ProjectRepository } from "../src/types";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const PANEL_ORIGIN = "http://localhost:5173";

interface FixtureProject extends ProjectRecord {
  apiKeyHash: string;
}

function repoFrom(projects: FixtureProject[]): ProjectRepository {
  const byHash = new Map(projects.map((project) => [project.apiKeyHash, project]));
  return {
    findByApiKeyHash: async (apiKeyHash) => byHash.get(apiKeyHash) ?? null,
  };
}

function makeEnv(): Env {
  return { DB: {} as D1Database, ENVIRONMENT: "test", PANEL_ORIGIN };
}

async function setup() {
  const activeKey = "gpk_active_test_key";
  const inactiveKey = "gpk_inactive_test_key";
  const projects: FixtureProject[] = [
    {
      id: "proja",
      name: "Project A",
      prefix: "PRJA",
      webhookUrl: "https://a.example/hook",
      isActive: true,
      apiKeyHash: await sha256Hex(activeKey),
    },
    {
      id: "projb",
      name: "Project B",
      prefix: "PRJB",
      webhookUrl: "https://b.example/hook",
      isActive: false,
      apiKeyHash: await sha256Hex(inactiveKey),
    },
  ];
  const app = buildApp({ projects: repoFrom(projects), sha256Hex, panelOrigin: PANEL_ORIGIN });
  return { app, env: makeEnv(), activeKey, inactiveKey };
}

describe("GET /health", () => {
  it("menjawab tanpa autentikasi", async () => {
    const { app, env } = await setup();
    const response = await app.request("/health", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "gapura", environment: "test" });
  });
});

describe("autentikasi API key", () => {
  it("menolak request tanpa header", async () => {
    const { app, env } = await setup();
    const response = await app.request("/v1/me", {}, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Header X-Gapura-Key wajib diisi." },
    });
  });

  it("menolak API key yang tidak dikenal", async () => {
    const { app, env } = await setup();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": "gpk_unknown" } }, env);

    expect(response.status).toBe(401);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("menolak project nonaktif dengan 403", async () => {
    const { app, env, inactiveKey } = await setup();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": inactiveKey } }, env);

    expect(response.status).toBe(403);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("PROJECT_INACTIVE");
  });

  it("mengembalikan identitas project untuk key yang valid", async () => {
    const { app, env, activeKey } = await setup();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": activeKey } }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: { id: "proja", name: "Project A", prefix: "PRJA" },
    });
  });

  it("tidak membocorkan hash, secret, atau webhook URL", async () => {
    const { app, env, activeKey } = await setup();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": activeKey } }, env);
    const text = await response.text();

    expect(text).not.toContain(await sha256Hex(activeKey));
    expect(text).not.toContain("webhook");
  });
});

describe("CORS panel", () => {
  it("mengizinkan origin panel yang terdaftar", async () => {
    const { app, env, activeKey } = await setup();
    const response = await app.request(
      "/v1/me",
      { headers: { Origin: PANEL_ORIGIN, "X-Gapura-Key": activeKey } },
      env,
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(PANEL_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("tidak mengizinkan origin lain", async () => {
    const { app, env } = await setup();
    const response = await app.request("/health", { headers: { Origin: "https://evil.example" } }, env);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("menjawab preflight untuk origin panel", async () => {
    const { app, env } = await setup();
    const response = await app.request(
      "/v1/me",
      {
        method: "OPTIONS",
        headers: {
          Origin: PANEL_ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "X-Gapura-Key",
        },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(PANEL_ORIGIN);
    expect(response.headers.get("access-control-allow-headers")).toContain("X-Gapura-Key");
  });
});

describe("routing", () => {
  it("mengembalikan JSON 404 untuk endpoint tak dikenal", async () => {
    const { app, env } = await setup();
    const response = await app.request("/tidak-ada", {}, env);

    expect(response.status).toBe(404);
    const body = await readJson<ErrorBody>(response);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
