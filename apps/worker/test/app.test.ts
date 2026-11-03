import { sha256Hex } from "@gapura/shared/crypto";
import { describe, expect, it } from "vitest";
import type { ErrorBody } from "../src/http";
import {
  ACTIVE_KEY,
  INACTIVE_KEY,
  PANEL_ORIGIN,
  createTestApp,
} from "./support/harness";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("GET /health", () => {
  it("menjawab tanpa autentikasi", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/health", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "gapura", environment: "test" });
  });
});

describe("autentikasi API key", () => {
  it("menolak request tanpa header", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/v1/me", {}, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Header X-Gapura-Key wajib diisi." },
    });
  });

  it("menolak API key yang tidak dikenal", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": "gpk_unknown" } }, env);

    expect(response.status).toBe(401);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("UNAUTHORIZED");
  });

  it("menolak project nonaktif dengan 403", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request(
      "/v1/me",
      { headers: { "X-Gapura-Key": INACTIVE_KEY } },
      env,
    );

    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("PROJECT_INACTIVE");
  });

  it("mengembalikan identitas project untuk key yang valid", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": ACTIVE_KEY } }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: { id: "proja", name: "Project A", prefix: "PRJA" },
    });
  });

  it("tidak membocorkan hash, secret, atau webhook URL", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/v1/me", { headers: { "X-Gapura-Key": ACTIVE_KEY } }, env);
    const text = await response.text();

    expect(text).not.toContain(await sha256Hex(ACTIVE_KEY));
    expect(text).not.toContain("webhook");
  });
});

describe("CORS panel", () => {
  it("mengizinkan origin panel yang terdaftar", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request(
      "/v1/me",
      { headers: { Origin: PANEL_ORIGIN, "X-Gapura-Key": ACTIVE_KEY } },
      env,
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(PANEL_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("tidak mengizinkan origin lain", async () => {
    const { app, env } = await createTestApp();
    const response = await app.request("/health", { headers: { Origin: "https://evil.example" } }, env);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("menjawab preflight untuk origin panel", async () => {
    const { app, env } = await createTestApp();
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
    const { app, env } = await createTestApp();
    const response = await app.request("/tidak-ada", {}, env);

    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe("NOT_FOUND");
  });
});
