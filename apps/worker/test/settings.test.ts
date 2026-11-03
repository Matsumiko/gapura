import { describe, expect, it } from "vitest";
import {
  createCredentialCipher,
  type CredentialCipher,
} from "../src/services/credentials";
import { createSettingsRepository } from "../src/repositories/settings";
import {
  SettingsInvalidError,
  SettingsNotFoundError,
  createSettingsService,
} from "../src/services/settings";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import type { AuditEntry } from "../src/types";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function methodResponse(): Response {
  return new Response(
    JSON.stringify({
      paymentFee: [
        { paymentMethod: "BT", paymentName: "PERMATA VA", paymentImage: "", totalFee: "0" },
      ],
      responseCode: "00",
      responseMessage: "SUCCESS",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}\n${schema3}\n${schema4}`);
  const cipher = await createCredentialCipher(KEY);
  const repo = createSettingsRepository({ db, getCipher: async () => cipher });
  const audits: AuditEntry[] = [];
  const service = createSettingsService({
    repo,
    now: () => NOW,
    cipherConfigured: true,
    publicBaseUrl: "https://gapura.test",
    fetch: async () => methodResponse(),
    insertAudit: async (entry) => {
      audits.push(entry);
    },
  });
  return { db, cipher, repo, service, audits };
}

describe("credential cipher", () => {
  it("bolak-balik plaintext dan memakai IV berbeda", async () => {
    const cipher: CredentialCipher = await createCredentialCipher(KEY);
    const first = await cipher.encrypt("rahasia-duitku");
    const second = await cipher.encrypt("rahasia-duitku");

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(await cipher.decrypt(first.ciphertext, first.iv)).toBe("rahasia-duitku");
  });

  it("menolak kunci yang bukan 32 byte", async () => {
    await expect(createCredentialCipher(btoa("pendek"))).rejects.toThrow(/32 byte/);
  });
});

describe("settings service", () => {
  it("menyimpan kredensial terenkripsi dan menampilkan status tanpa secret", async () => {
    const { db, service } = await setup();

    const view = await service.save(
      "sandbox",
      { merchantCode: "DS24636", apiKey: "feb4ec02297b838f6f4d4e20342403e8" },
      "admin-token",
    );

    expect(view).toMatchObject({
      environment: "sandbox",
      merchantCode: "DS24636",
      apiKeySet: true,
      isActive: false,
    });
    const row = await db
      .prepare("SELECT api_key_ciphertext, api_key_iv FROM merchant_settings WHERE environment='sandbox'")
      .first<{ api_key_ciphertext: string; api_key_iv: string }>();
    expect(row?.api_key_ciphertext).not.toContain("feb4ec");
    expect(row?.api_key_iv.length).toBeGreaterThan(0);

    const overview = await service.overview();
    expect(overview.callbackUrl).toBe("https://gapura.test/callback/duitku");
    expect(overview.items.map((item) => item.environment)).toEqual(["sandbox", "production"]);
  });

  it("mengaktifkan satu environment dan membacanya kembali terdekripsi", async () => {
    const { service, repo } = await setup();
    await service.save("sandbox", { merchantCode: "DS24636", apiKey: "secret-sandbox" }, "admin");

    expect(await repo.getActive()).toBeNull();
    await service.activate("sandbox", "admin");

    const overview = await service.overview();
    expect(overview.activeEnvironment).toBe("sandbox");
    expect((await repo.getActive())?.apiKey).toBe("secret-sandbox");
  });

  it("mengubah merchantCode tanpa mengganti apiKey", async () => {
    const { service, repo } = await setup();
    await service.save("sandbox", { merchantCode: "DS1", apiKey: "secret-sandbox" }, "admin");

    await service.save("sandbox", { merchantCode: "DS2" }, "admin");

    const credentials = await repo.get("sandbox");
    expect(credentials?.merchantCode).toBe("DS2");
    expect(credentials?.apiKey).toBe("secret-sandbox");
  });

  it("menolak environment baru tanpa apiKey", async () => {
    const { service } = await setup();

    await expect(service.save("production", { merchantCode: "DS9" }, "admin")).rejects.toBeInstanceOf(
      SettingsInvalidError,
    );
  });

  it("404 saat mengaktifkan environment yang belum punya kredensial", async () => {
    const { service } = await setup();

    await expect(service.activate("production", "admin")).rejects.toBeInstanceOf(
      SettingsNotFoundError,
    );
  });

  it("menguji kredensial lewat getPaymentMethod", async () => {
    const { service } = await setup();
    await service.save("sandbox", { merchantCode: "DS24636", apiKey: "secret-sandbox" }, "admin");

    const result = await service.test("sandbox");

    expect(result).toMatchObject({ environment: "sandbox", count: 1 });
    expect(result.sample[0]).toEqual({ code: "BT", name: "PERMATA VA", totalFee: "0" });
  });

  it("mencatat audit untuk simpan dan aktivasi", async () => {
    const { service, audits } = await setup();
    await service.save("sandbox", { merchantCode: "DS24636", apiKey: "secret-sandbox" }, "admin");
    await service.activate("sandbox", "admin");

    expect(audits.map((entry) => entry.action)).toEqual([
      "save_merchant_settings",
      "activate_environment",
    ]);
    expect(JSON.stringify(audits)).not.toContain("secret-sandbox");
  });
});
