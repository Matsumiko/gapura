import { describe, expect, it } from "vitest";
import { createCredentialCipher } from "../src/services/credentials";
import { createSettingsRepository } from "../src/repositories/settings";
import { createSettingsService } from "../src/services/settings";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const ADMIN = { Authorization: "Bearer test-token" };

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}\n${schema3}\n${schema4}`);
  const cipher = await createCredentialCipher(KEY);
  const repo = createSettingsRepository({ db, getCipher: async () => cipher });
  const settings = createSettingsService({
    repo,
    now: () => NOW,
    cipherConfigured: true,
    publicBaseUrl: "https://gapura.test",
    fetch: async () =>
      new Response(JSON.stringify({ paymentFee: [], responseCode: "00" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    insertAudit: async () => {},
  });
  const test = await createTestApp({ adminToken: "test-token", settings });
  return { ...test, settings };
}

function put(app: Awaited<ReturnType<typeof setup>>["app"], path: string, body: unknown) {
  return app.request(
    path,
    { method: "PUT", headers: { ...ADMIN, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    undefined,
  );
}

describe("route settings admin", () => {
  it("menampilkan dua environment dan callback URL", async () => {
    const { app, env } = await setup();

    const response = await app.request("/admin/settings", { headers: ADMIN }, undefined);
    const body = (await response.json()) as {
      callbackUrl: string;
      items: Array<{ environment: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.callbackUrl).toBe("https://gapura.test/callback/duitku");
    expect(body.items.map((item) => item.environment)).toEqual(["sandbox", "production"]);
    expect(env).toBeDefined();
  });

  it("menyimpan, mengaktifkan, dan menguji kredensial", async () => {
    const { app } = await setup();

    expect(
      (
        await put(app, "/admin/settings/sandbox", {
          merchantCode: "DS24636",
          apiKey: "feb4ec02297b838f6f4d4e20342403e8",
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await app.request(
          "/admin/settings/sandbox/activate",
          { method: "POST", headers: ADMIN },
          undefined,
        )
      ).status,
    ).toBe(200);

    const testResponse = await app.request(
      "/admin/settings/sandbox/test",
      { method: "POST", headers: ADMIN },
      undefined,
    );
    expect(testResponse.status).toBe(200);
    expect((await testResponse.json()) as { count: number }).toMatchObject({ count: 0 });
  });

  it("menolak environment asing dan body tidak valid", async () => {
    const { app } = await setup();

    expect((await put(app, "/admin/settings/staging", { merchantCode: "X" })).status).toBe(400);
    expect((await put(app, "/admin/settings/sandbox", { merchantCode: "" })).status).toBe(400);
    expect((await put(app, "/admin/settings/sandbox", { merchantCode: "X", extra: 1 })).status).toBe(
      400,
    );
  });

  it("mewajibkan token admin", async () => {
    const { app } = await setup();

    expect((await app.request("/admin/settings", {}, undefined)).status).toBe(401);
  });
});
