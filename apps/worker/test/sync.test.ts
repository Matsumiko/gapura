import { describe, expect, it } from "vitest";
import type { StatusProvider } from "../src/providers/duitku";
import { createPendingSync } from "../src/services/sync";
import type { WebhookForwarder } from "../src/services/webhooks";
import type { ForwardInstruction } from "../src/services/payload";
import type { PaymentStatus, ProjectWebhookTarget } from "../src/types";
import { createMemoryTransactionRepository } from "./support/memory";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const OLD = "2026-11-03T09:00:00.000Z";
const TARGETS: Record<string, ProjectWebhookTarget> = {
  proja: { id: "proja", webhookUrl: "https://a.example/hook", webhookSecret: "whsec_a", isActive: true },
};

interface ProviderStub extends StatusProvider {
  calls: string[];
}

function provider(statusCode: string | Error): ProviderStub {
  const calls: string[] = [];
  return {
    calls,
    async getStatus(merchantOrderId) {
      calls.push(merchantOrderId);
      if (statusCode instanceof Error) {
        throw statusCode;
      }
      return { statusCode, reference: "REF-1", amount: 150000 };
    },
  };
}

async function setup(
  statusCode: string | Error,
  createdAt = OLD,
  status: PaymentStatus = "PENDING",
) {
  const memory = createMemoryTransactionRepository(TARGETS);
  await memory.repo.insertPending({
    merchantOrderId: "PRJA-INV123",
    projectId: "proja",
    projectOrderId: "INV123",
    amount: 150000,
    paymentMethod: "VC",
    createdAt,
  });
  if (status !== "PENDING") {
    await memory.repo.markStatus("PRJA-INV123", status, createdAt);
  }

  const stub = provider(statusCode);
  const sent: ForwardInstruction[] = [];
  const forwarder: WebhookForwarder = {
    async forward(instruction) {
      sent.push(instruction);
    },
  };
  const sync = createPendingSync({
    transactions: memory.repo,
    provider: stub,
    forwarder,
    now: () => NOW,
  });
  return { sync, memory, sent, calls: stub.calls };
}

describe("pending transaction sync", () => {
  it("menandai PAID dan meneruskan hasil untuk statusCode 00", async () => {
    const { sync, memory, sent } = await setup("00");

    const report = await sync.run();

    expect(report).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PAID");
    expect(sent[0]?.payload).toMatchObject({
      merchantOrderId: "PRJA-INV123",
      status: "PAID",
      updatedAt: NOW.toISOString(),
    });
  });

  it("tidak mengubah apa pun untuk statusCode 01 (masih pending)", async () => {
    const { sync, memory, sent } = await setup("01");

    const report = await sync.run();

    expect(report).toEqual({ checked: 1, updated: 0, failed: 0 });
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
    expect(sent).toHaveLength(0);
  });

  it("menandai EXPIRED untuk statusCode 02 (canceled)", async () => {
    const { sync, memory, sent } = await setup("02");

    await sync.run();

    expect(memory.rows.get("PRJA-INV123")?.status).toBe("EXPIRED");
    expect(sent[0]?.payload.status).toBe("EXPIRED");
  });

  it("melewati transaksi yang belum cukup lama", async () => {
    const { sync, calls } = await setup("00", "2026-11-03T09:55:00.000Z");

    const report = await sync.run();

    expect(report.checked).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("melewati transaksi yang bukan PENDING", async () => {
    const { sync, calls } = await setup("00", OLD, "PAID");

    const report = await sync.run();

    expect(report.checked).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("mencatat kegagalan provider tanpa mengubah status", async () => {
    const { sync, memory } = await setup(new Error("timeout"));

    const report = await sync.run();

    expect(report).toEqual({ checked: 1, updated: 0, failed: 1 });
    expect(memory.rows.get("PRJA-INV123")?.status).toBe("PENDING");
  });
});
