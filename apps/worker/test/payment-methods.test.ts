import { describe, expect, it } from "vitest";
import { PaymentProviderError } from "../src/providers/duitku";
import { createPaymentMethodsService } from "../src/services/payment-methods";
import { ACTIVE_KEY, createTestApp } from "./support/harness";

function fakeProvider(methods: Array<{ code: string; name: string; image: string; totalFee: string }> | Error) {
  const calls: number[] = [];
  return {
    calls,
    provider: {
      async getPaymentMethods(amount: number) {
        calls.push(amount);
        if (methods instanceof Error) {
          throw methods;
        }
        return methods;
      },
    },
  };
}

async function setup(methods: Parameters<typeof fakeProvider>[0] = [
  { code: "BC", name: "BCA VA", image: "https://images.duitku.com/BC.PNG", totalFee: "5000" },
  { code: "ZZ", name: "CHANNEL BARU", image: "", totalFee: "0" },
]) {
  const fake = fakeProvider(methods);
  const test = await createTestApp({
    paymentMethods: createPaymentMethodsService({ provider: fake.provider }),
  });
  return { ...test, calls: fake.calls };
}

function request(app: Awaited<ReturnType<typeof setup>>["app"], path: string, key = ACTIVE_KEY) {
  return app.request(path, { headers: { "X-Gapura-Key": key } }, undefined);
}

describe("GET /v1/payment-methods", () => {
  it("mengembalikan channel aktif dengan nama katalog dan sistem", async () => {
    const { app } = await setup();

    const response = await request(app, "/v1/payment-methods");
    const body = (await response.json()) as {
      amount: number;
      items: Array<{ code: string; system: string | null; totalFee: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.amount).toBe(10000);
    expect(body.items).toEqual([
      {
        code: "BC",
        name: "BCA VA",
        officialName: "BCA Virtual Account",
        system: "Bank Transfer",
        image: "https://images.duitku.com/BC.PNG",
        totalFee: "5000",
      },
      {
        code: "ZZ",
        name: "CHANNEL BARU",
        officialName: null,
        system: null,
        image: "",
        totalFee: "0",
      },
    ]);
  });

  it("meneruskan nominal dari query", async () => {
    const { app, calls } = await setup();

    const response = await request(app, "/v1/payment-methods?amount=50000");

    expect(response.status).toBe(200);
    expect(calls).toEqual([50000]);
  });

  it.each(["9999", "0", "abc", "100000001", "10000.5"])(
    "menolak amount %s",
    async (amount) => {
      const { app, calls } = await setup();

      const response = await request(app, `/v1/payment-methods?amount=${amount}`);

      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );

  it("mewajibkan API key project", async () => {
    const { app } = await setup();

    const response = await app.request("/v1/payment-methods", {}, undefined);

    expect(response.status).toBe(401);
  });

  it("menjawab 503 bila kredensial Duitku belum diset", async () => {
    const { app } = await setup(new PaymentProviderError("PROVIDER_NOT_CONFIGURED", "kosong"));

    const response = await request(app, "/v1/payment-methods");

    expect(response.status).toBe(503);
  });

  it("menjawab 502 untuk kegagalan provider lain", async () => {
    const { app } = await setup(new PaymentProviderError("HTTP_500", "vendor error"));

    const response = await request(app, "/v1/payment-methods");

    expect(response.status).toBe(502);
  });
});
