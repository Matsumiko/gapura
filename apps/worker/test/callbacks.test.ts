import { describe, expect, it } from "vitest";
import { callbackSignature } from "../src/providers/duitku";
import { createCallbackService } from "../src/services/callbacks";
import type { ForwardInstruction, WebhookForwarder } from "../src/services/webhooks";
import type { ProjectWebhookTarget } from "../src/types";
import { createTestApp } from "./support/harness";
import { createMemoryTransactionRepository } from "./support/memory";

const MERCHANT_CODE = "D0001";
const API_KEY = "duitku-secret";
const NOW = (): Date => new Date("2026-11-03T10:00:00.000Z");

const TARGETS: Record<string, ProjectWebhookTarget> = {
  proja: { id: "proja", webhookUrl: "https://a.example/hook", webhookSecret: "whsec_a", isActive: true },
};

type CallbackFields = {
  merchantCode: string;
  amount: string;
  merchantOrderId: string;
  resultCode: string;
  reference: string;
  paymentCode: string;
};

function baseFields(): CallbackFields {
  return {
    merchantCode: MERCHANT_CODE,
    amount: "150000",
    merchantOrderId: "PRJA-INV123",
    resultCode: "00",
    reference: "REF-1",
    paymentCode: "VC",
  };
}

async function setup() {
  const memory = createMemoryTransactionRepository(TARGETS);
  await memory.repo.insertPending({
    merchantOrderId: "PRJA-INV123",
    projectId: "proja",
    projectOrderId: "INV123",
    amount: 150000,
    paymentMethod: "VC",
    createdAt: "2026-11-03T09:00:00.000Z",
  });

  const callbacks = createCallbackService({
    transactions: memory.repo,
    merchantCode: MERCHANT_CODE,
    apiKey: API_KEY,
    now: NOW,
  });
  const forwards: ForwardInstruction[] = [];
  const forwarder: WebhookForwarder = {
    async forward(instruction) {
      forwards.push(instruction);
    },
  };
  const test = await createTestApp({ callbacks, forwarder });
  return { ...test, memory, forwards };
}

async function signedFields(overrides: Partial<CallbackFields> = {}): Promise<Record<string, string>> {
  const fields: CallbackFields = { ...baseFields(), ...overrides };
  return {
    ...fields,
    signature: await callbackSignature(fields.merchantCode, fields.amount, fields.merchantOrderId, API_KEY),
  };
}

function postCallback(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  ctx: ExecutionContext,
  fields: Record<string, string>,
) {
  return app.request(
    "/callback/duitku",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    undefined,
    ctx,
  );
}

describe("POST /callback/duitku", () => {
  it("menandai PAID dan meneruskan status ke webhook project", async () => {
    const { app, ctx, memory, forwards, flushBackground } = await setup();

    const response = await postCallback(app, ctx, await signedFields());
    await flushBackground();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PAID");
    expect(memory.rows.get("PRJA-INV123")?.reference).toBe("REF-1");
    expect(forwards).toHaveLength(1);
    expect(forwards[0]?.project.id).toBe("proja");
    expect(forwards[0]?.payload).toEqual({
      merchantOrderId: "PRJA-INV123",
      projectOrderId: "INV123",
      status: "PAID",
      amount: 150000,
      paymentMethod: "VC",
      reference: "REF-1",
      updatedAt: "2026-11-03T10:00:00.000Z",
    });
  });

  it("tidak meneruskan ulang saat Duitku mengulang callback", async () => {
    const { app, ctx, forwards, flushBackground } = await setup();
    const fields = await signedFields();

    await postCallback(app, ctx, fields);
    await flushBackground();
    const second = await postCallback(app, ctx, fields);
    await flushBackground();

    expect(second.status).toBe(200);
    expect(forwards).toHaveLength(1);
  });

  it("menolak signature salah tanpa mengubah status", async () => {
    const { app, ctx, memory, forwards, flushBackground } = await setup();
    const fields = { ...baseFields(), signature: "0".repeat(64) };

    const response = await postCallback(app, ctx, fields);
    await flushBackground();

    expect(response.status).toBe(401);
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
    expect(forwards).toHaveLength(0);
  });

  it("menolak merchantCode lain", async () => {
    const { app, ctx } = await setup();
    const fields = await signedFields({ merchantCode: "D9999" });

    expect((await postCallback(app, ctx, fields)).status).toBe(401);
  });

  it("mengabaikan callback dengan nominal tidak cocok", async () => {
    const { app, ctx, memory, forwards, flushBackground } = await setup();
    const fields = await signedFields({ amount: "1000" });

    const response = await postCallback(app, ctx, fields);
    await flushBackground();

    expect(response.status).toBe(200);
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
    expect(forwards).toHaveLength(0);
  });

  it("mengabaikan order yang tidak dikenal", async () => {
    const { app, ctx, forwards, flushBackground } = await setup();
    const fields = await signedFields({ merchantOrderId: "PRJA-TIDAKADA" });

    const response = await postCallback(app, ctx, fields);
    await flushBackground();

    expect(response.status).toBe(200);
    expect(forwards).toHaveLength(0);
  });

  it("menolak callback tanpa parameter wajib", async () => {
    const { app, ctx } = await setup();

    const response = await postCallback(app, ctx, {
      merchantCode: MERCHANT_CODE,
      amount: "150000",
      merchantOrderId: "PRJA-INV123",
      resultCode: "00",
    });

    expect(response.status).toBe(400);
  });

  it("menandai FAILED untuk resultCode selain 00", async () => {
    const { app, ctx, memory, flushBackground } = await setup();

    await postCallback(app, ctx, await signedFields({ resultCode: "01" }));
    await flushBackground();

    expect(memory.rows.get("PRJA-INV123")?.status).toBe("FAILED");
  });
});
