import { describe, expect, it } from "vitest";
import { createManagedDuitkuProvider } from "../src/providers/managed";
import type { MerchantCredentials } from "../src/types";
import type { CredentialResolver } from "../src/services/credential-resolver";

function methodResponse(): Response {
  return new Response(
    JSON.stringify({
      paymentFee: [{ paymentMethod: "BT", paymentName: "PERMATA VA", paymentImage: "", totalFee: "0" }],
      responseCode: "00",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function setup(credentials: MerchantCredentials | null) {
  const calls: Array<{ url: string; body: string }> = [];
  const resolver: CredentialResolver = { getActive: async () => credentials };
  const provider = createManagedDuitkuProvider({
    resolver,
    fetch: async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return methodResponse();
    },
  });
  return { provider, calls };
}

function credentials(overrides: Partial<MerchantCredentials> = {}): MerchantCredentials {
  return {
    environment: "sandbox",
    merchantCode: "DS1",
    apiKey: "key-1",
    updatedAt: "2026-11-04T10:00:00.000Z",
    updatedBy: "admin",
    ...overrides,
  };
}

describe("managed Duitku provider", () => {
  it("menolak bila tidak ada kredensial aktif", async () => {
    const { provider } = setup(null);

    await expect(provider.getPaymentMethods(10000)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("memakai kredensial sandbox dari store", async () => {
    const { provider, calls } = setup(credentials());

    await provider.getPaymentMethods(10000);

    expect(calls[0]?.url).toBe(
      "https://sandbox.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod",
    );
    const body = JSON.parse(String(calls[0]?.body)) as { merchantcode: string };
    expect(body.merchantcode).toBe("DS1");
  });

  it("memakai host produksi untuk environment production", async () => {
    const { provider, calls } = setup(credentials({ environment: "production", merchantCode: "PRD1" }));

    await provider.getPaymentMethods(10000);

    expect(calls[0]?.url).toContain("https://passport.duitku.com/");
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ merchantcode: "PRD1" });
  });

  it("membuat klien baru saat versi kredensial berubah", async () => {
    let current = credentials();
    const calls: string[] = [];
    const provider = createManagedDuitkuProvider({
      resolver: { getActive: async () => current },
      fetch: async (_input, init) => {
        calls.push(String(init?.body ?? ""));
        return methodResponse();
      },
    });

    await provider.getPaymentMethods(10000);
    current = credentials({ merchantCode: "DS2", updatedAt: "2026-11-04T11:00:00.000Z" });
    await provider.getPaymentMethods(10000);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("DS2");
  });
});
