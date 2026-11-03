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

  it("menolak orderId yang sudah dipakai project", async () => {
    const { app, calls } = await setup();

    expect((await postPayment(app)).status).toBe(201);
    const duplicate = await postPayment(app);

    expect(duplicate.status).toBe(409);
    expect((await readJson<ErrorBody>(duplicate)).error.code).toBe(
      "DUPLICATE_ORDER",
    );
    expect(calls).toHaveLength(1);
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
