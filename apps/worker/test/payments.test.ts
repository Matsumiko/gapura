import { describe, expect, it } from "vitest";
import { PaymentProviderError } from "../src/providers/duitku";
import type { CreateInvoiceRequest, CreateInvoiceResponse, PaymentProvider } from "../src/providers/duitku";
import { createPaymentsService } from "../src/services/payments";
import type { ProjectWebhookTarget } from "../src/types";
import { ACTIVE_KEY, createTestApp } from "./support/harness";
import { createMemoryTransactionRepository } from "./support/memory";

const WEBHOOK_TARGETS: Record<string, ProjectWebhookTarget> = {
  proja: { id: "proja", webhookUrl: "https://a.example/hook", webhookSecret: "whsec_a", isActive: true },
  projb: { id: "projb", webhookUrl: "https://b.example/hook", webhookSecret: "whsec_b", isActive: false },
};

const NOW = (): Date => new Date("2026-11-03T10:00:00.000Z");

const VALID_BODY = {
  orderId: "INV123",
  amount: 150000,
  productDetails: "Paket Premium",
  customerName: "Budi Santoso Dengan Nama Yang Panjang",
  email: "budi@example.com",
  paymentMethod: "VC",
  returnUrl: "https://project-a.com/thanks",
};

interface ErrorBody {
  error: { code: string; message: string };
}

interface PaymentBody {
  merchantOrderId: string;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function fakeProvider(result: CreateInvoiceResponse | Error): {
  provider: PaymentProvider;
  calls: CreateInvoiceRequest[];
} {
  const calls: CreateInvoiceRequest[] = [];
  return {
    calls,
    provider: {
      async createInvoice(request) {
        calls.push(request);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
      async getStatus() {
        return { statusCode: "01", reference: null, amount: null };
      },
      async getPaymentMethods() {
        return [];
      },
    },
  };
}

function invoice(): CreateInvoiceResponse {
  return {
    reference: "REF-123",
    paymentUrl: "https://sandbox.duitku.com/topup/REF-123",
    vaNumber: "7007014001444348",
    qrString: "00020101",
  };
}

async function setup(providerResult: CreateInvoiceResponse | Error = invoice()) {
  const memory = createMemoryTransactionRepository(WEBHOOK_TARGETS);
  const { provider, calls } = fakeProvider(providerResult);
  const payments = createPaymentsService({
    transactions: memory.repo,
    provider,
    publicBaseUrl: "https://pay.test",
    now: NOW,
  });
  const test = await createTestApp({ payments });
  return { ...test, memory, calls };
}

function postPayment(app: Awaited<ReturnType<typeof createTestApp>>["app"], body: unknown = VALID_BODY) {
  return app.request(
    "/v1/payments",
    {
      method: "POST",
      headers: { "X-Gapura-Key": ACTIVE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    undefined,
  );
}

describe("POST /v1/payments", () => {
  it("membuat transaksi PENDING dan mengembalikan data pembayaran", async () => {
    const { app, memory, calls } = await setup();

    const response = await postPayment(app);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      merchantOrderId: "PRJA-INV123",
      projectOrderId: "INV123",
      amount: 150000,
      status: "PENDING",
      paymentMethod: "VC",
      paymentUrl: "https://sandbox.duitku.com/topup/REF-123",
      reference: "REF-123",
      vaNumber: "7007014001444348",
      qrString: "00020101",
      createdAt: "2026-11-03T10:00:00.000Z",
      updatedAt: "2026-11-03T10:00:00.000Z",
    });

    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.merchantOrderId).toBe("PRJA-INV123");
    expect(calls[0]?.callbackUrl).toBe("https://pay.test/callback/duitku");
    expect(calls[0]?.customerName).toBe(VALID_BODY.customerName);
  });

  it("mengembalikan transaksi yang sama untuk retry orderId identik", async () => {
    const { app, calls, memory } = await setup();

    const first = await postPayment(app);
    expect(first.status).toBe(201);
    const firstBody = await readJson<PaymentBody>(first);

    const replay = await postPayment(app);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await readJson<PaymentBody>(replay)).toEqual(firstBody);
    expect(calls).toHaveLength(1);
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
  });

  it("menolak orderId sama dengan amount atau paymentMethod berbeda", async () => {
    const { app, calls } = await setup();
    expect((await postPayment(app)).status).toBe(201);

    const differentAmount = await postPayment(app, { ...VALID_BODY, amount: 175000 });
    expect(differentAmount.status).toBe(409);
    expect((await readJson<ErrorBody>(differentAmount)).error.code).toBe("DUPLICATE_ORDER");

    const differentMethod = await postPayment(app, { ...VALID_BODY, paymentMethod: "BT" });
    expect(differentMethod.status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("mengembalikan status terminal saat project mengulang orderId yang sama", async () => {
    const { app, calls, memory } = await setup();
    expect((await postPayment(app)).status).toBe(201);
    await memory.repo.markStatus("PRJA-INV123", "EXPIRED", NOW().toISOString());

    const replay = await postPayment(app);
    expect(replay.status).toBe(200);
    expect((await readJson<PaymentBody & { status: string }>(replay)).status).toBe("EXPIRED");
    expect(calls).toHaveLength(1);
  });

  it("menandai transaksi yang masih dibuat agar project mencoba lagi", async () => {
    const { app, calls, memory } = await setup();
    await memory.repo.insertPending({
      merchantOrderId: "PRJA-INV123",
      projectId: "proja",
      projectOrderId: VALID_BODY.orderId,
      amount: VALID_BODY.amount,
      paymentMethod: VALID_BODY.paymentMethod,
      createdAt: NOW().toISOString(),
    });

    const response = await postPayment(app);
    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect((await readJson<ErrorBody>(response)).error.code).toBe("ORDER_IN_PROGRESS");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["amount nol", { ...VALID_BODY, amount: 0 }],
    ["amount pecahan", { ...VALID_BODY, amount: 1500.5 }],
    ["paymentMethod panjang", { ...VALID_BODY, paymentMethod: "VISA" }],
    ["field asing", { ...VALID_BODY, admin: true }],
    ["email salah", { ...VALID_BODY, email: "bukan-email" }],
  ])("menolak body tidak valid: %s", async (_label, body) => {
    const { app, calls } = await setup();

    const response = await postPayment(app, body);

    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
    expect(calls).toHaveLength(0);
  });

  it("meneruskan expiryPeriod dan creditCardDetail ke provider", async () => {
    const { app, calls } = await setup();

    const response = await postPayment(app, {
      ...VALID_BODY,
      paymentMethod: "VC",
      expiryPeriod: 20,
      creditCardDetail: { acquirer: "014", binWhitelist: ["014", "400000"] },
    });

    expect(response.status).toBe(201);
    expect(calls[0]?.expiryPeriod).toBe(20);
    expect(calls[0]?.creditCardDetail).toEqual({ acquirer: "014", binWhitelist: ["014", "400000"] });
  });

  it("meneruskan data pelanggan dan item opsional ke provider", async () => {
    const { app, calls } = await setup();
    const body = {
      ...VALID_BODY,
      additionalParam: "internal-123",
      merchantUserInfo: "user-9",
      phoneNumber: "08123456789",
      itemDetails: [{ name: "Paket Premium", price: 150000, quantity: 1 }],
      customerDetail: {
        firstName: "Budi",
        lastName: "Santoso",
        email: "budi@example.com",
        billingAddress: { city: "Jakarta", countryCode: "ID" },
      },
    };

    expect((await postPayment(app, body)).status).toBe(201);
    expect(calls[0]).toMatchObject({
      additionalParam: "internal-123",
      merchantUserInfo: "user-9",
      phoneNumber: "08123456789",
      itemDetails: [{ name: "Paket Premium", price: 150000, quantity: 1 }],
      customerDetail: body.customerDetail,
    });
  });

  it("menolak itemDetails yang totalnya tidak sama dengan amount", async () => {
    const { app, calls } = await setup();
    const response = await postPayment(app, {
      ...VALID_BODY,
      itemDetails: [{ name: "Paket", price: 100000, quantity: 1 }],
    });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("menolak creditCardDetail untuk channel selain VC", async () => {
    const { app, calls } = await setup();

    const response = await postPayment(app, {
      ...VALID_BODY,
      paymentMethod: "BT",
      creditCardDetail: { acquirer: "014" },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("meneruskan accountLink OL ke provider tanpa membocorkan credentialCode", async () => {
    const { app, calls } = await setup();

    const accountLink = {
      credentialCode: "B3A72721-7FFB-EC11-812D-B4617B397E08",
      ovo: { paymentDetails: [{ paymentType: "CASH", amount: VALID_BODY.amount }] },
    };
    const response = await postPayment(app, {
      ...VALID_BODY,
      paymentMethod: "OL",
      accountLink,
    });

    expect(response.status).toBe(201);
    expect(calls[0]?.accountLink).toEqual(accountLink);
    expect(JSON.stringify(await readJson<PaymentBody>(response))).not.toContain("credentialCode");
  });

  it("menolak accountLink untuk channel yang tidak membutuhkannya", async () => {
    const { app, calls } = await setup();

    const response = await postPayment(app, {
      ...VALID_BODY,
      paymentMethod: "BT",
      accountLink: {
        credentialCode: "B3A72721-7FFB-EC11-812D-B4617B397E08",
        ovo: { paymentDetails: [{ paymentType: "CASH", amount: VALID_BODY.amount }] },
      },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("menolak OL/SL tanpa accountLink", async () => {
    const { app, calls } = await setup();

    for (const paymentMethod of ["OL", "SL"]) {
      const response = await postPayment(app, { ...VALID_BODY, paymentMethod });
      expect(response.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("menolak orderId yang membuat merchantOrderId melebihi 50 karakter", async () => {
    const { app, calls } = await setup();

    const response = await postPayment(app, { ...VALID_BODY, orderId: "X".repeat(47) });

    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.message).toContain("50 karakter");
    expect(calls).toHaveLength(0);
  });

  it("menerima orderId yang membuat merchantOrderId tepat 50 karakter", async () => {
    const { app } = await setup();

    const response = await postPayment(app, { ...VALID_BODY, orderId: "Y".repeat(45) });

    expect(response.status).toBe(201);
  });

  it("membuang baris PENDING bila Duitku gagal, supaya project bisa mencoba lagi", async () => {
    const { app, memory } = await setup(new PaymentProviderError("REJECTED", "Ditolak Duitku"));

    const response = await postPayment(app);

    expect(response.status).toBe(502);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "PROVIDER_ERROR",
    );
    expect(memory.rows.size).toBe(0);
  });

  it("menjawab 503 bila kredensial Duitku belum diset", async () => {
    const { app } = await setup(
      new PaymentProviderError("PROVIDER_NOT_CONFIGURED", "Kredensial kosong"),
    );

    const response = await postPayment(app);

    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "PROVIDER_NOT_CONFIGURED",
    );
  });
});

describe("GET /v1/payments/:orderId", () => {
  it("mengembalikan transaksi milik project", async () => {
    const { app } = await setup();
    await postPayment(app);

    const response = await app.request(
      "/v1/payments/INV123",
      { headers: { "X-Gapura-Key": ACTIVE_KEY } },
      undefined,
    );

    expect(response.status).toBe(200);
    expect((await readJson<PaymentBody>(response)).merchantOrderId).toBe(
      "PRJA-INV123",
    );
  });

  it("tidak membocorkan transaksi project lain", async () => {
    const { app, memory } = await setup();
    await memory.repo.insertPending({
      merchantOrderId: "PRJB-INV999",
      projectId: "projb",
      projectOrderId: "INV999",
      amount: 1000,
      paymentMethod: "VA",
      createdAt: "2026-11-03T09:00:00.000Z",
    });

    const response = await app.request(
      "/v1/payments/INV999",
      { headers: { "X-Gapura-Key": ACTIVE_KEY } },
      undefined,
    );

    expect(response.status).toBe(404);
  });

  it("mengembalikan 404 untuk order yang tidak ada", async () => {
    const { app } = await setup();

    const response = await app.request(
      "/v1/payments/TIDAKADA",
      { headers: { "X-Gapura-Key": ACTIVE_KEY } },
      undefined,
    );

    expect(response.status).toBe(404);
  });
});
