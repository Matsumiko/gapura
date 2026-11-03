import { describe, expect, it } from "vitest";
import { createRetryProcessor } from "../src/services/retries";
import type { DeliverFn } from "../src/services/webhooks";
import type { ForwardInstruction } from "../src/services/payload";
import type { DeliveryResult } from "../src/services/webhooks";
import type { ProjectWebhookTarget } from "../src/types";
import { createMemoryWebhookLogs } from "./support/memory-logs";
import { createMemoryTransactionRepository } from "./support/memory";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const DUE = "2026-11-03T09:59:00.000Z";
const TARGETS: Record<string, ProjectWebhookTarget> = {
  proja: { id: "proja", webhookUrl: "https://a.example/hook", webhookSecret: "whsec_a", isActive: true },
};

const DELIVERED: DeliveryResult = { ok: true, httpStatus: 200, error: null };
const FAILED: DeliveryResult = { ok: false, httpStatus: 500, error: "HTTP 500" };

async function setup(
  attempt: number,
  deliverResult: DeliveryResult = DELIVERED,
  options: { withTransaction?: boolean } = {},
) {
  const memory = createMemoryTransactionRepository(TARGETS);
  if (options.withTransaction !== false) {
    await memory.repo.insertPending({
      merchantOrderId: "PRJA-INV123",
      projectId: "proja",
      projectOrderId: "INV123",
      amount: 150000,
      paymentMethod: "VC",
      createdAt: "2026-11-03T09:30:00.000Z",
    });
  }

  const logs = createMemoryWebhookLogs();
  await logs.repo.insertAttempt({
    merchantOrderId: "PRJA-INV123",
    attempt,
    httpStatus: 500,
    error: "HTTP 500",
    nextAttemptAt: DUE,
    status: "FAILED",
    createdAt: "2026-11-03T09:58:00.000Z",
  });

  const sent: ForwardInstruction[] = [];
  const deliver: DeliverFn = async (project, payload) => {
    sent.push({ project, payload });
    return deliverResult;
  };
  const processor = createRetryProcessor({
    transactions: memory.repo,
    logs: logs.repo,
    deliver,
    now: () => NOW,
  });

  return { processor, logs, memory, sent };
}

describe("retry processor", () => {
  it("mengirim ulang percobaan berikutnya dan menandai DELIVERED", async () => {
    const { processor, logs, sent } = await setup(1);

    const report = await processor.run();

    expect(report).toEqual({ due: 1, attempted: 1, delivered: 1, failed: 0, dead: 0 });
    expect(sent[0]?.payload).toMatchObject({ merchantOrderId: "PRJA-INV123", status: "PENDING" });
    expect(logs.entries.map((entry) => [entry.attempt, entry.status, entry.nextAttemptAt])).toEqual([
      [1, "FAILED", null],
      [2, "DELIVERED", null],
    ]);
  });

  it("menjadwalkan backoff 5 menit setelah percobaan kedua gagal", async () => {
    const { processor, logs } = await setup(2, FAILED);

    const report = await processor.run();

    expect(report.failed).toBe(1);
    const latest = logs.entries.at(-1);
    expect(latest).toMatchObject({
      attempt: 3,
      status: "FAILED",
      nextAttemptAt: "2026-11-03T10:05:00.000Z",
    });
  });

  it("menandai DEAD pada percobaan kedelapan yang gagal", async () => {
    const { processor, logs } = await setup(7, FAILED);

    const report = await processor.run();

    expect(report.dead).toBe(1);
    expect(logs.entries.at(-1)).toMatchObject({
      attempt: 8,
      status: "DEAD",
      nextAttemptAt: null,
    });
  });

  it("tidak mengirim ulang bila baris sudah diambil proses lain", async () => {
    const { processor, logs, sent } = await setup(1);
    await logs.repo.claim(1, DUE, "2026-11-03T10:05:00.000Z");

    const report = await processor.run();

    expect(report).toMatchObject({ due: 0, attempted: 0 });
    expect(sent).toHaveLength(0);
  });

  it("menandai DEAD bila transaksi sudah tidak ada", async () => {
    const { processor, logs, sent } = await setup(1, DELIVERED, { withTransaction: false });

    const report = await processor.run();

    expect(report.dead).toBe(1);
    expect(sent).toHaveLength(0);
    expect(logs.entries[0]?.status).toBe("DEAD");
  });

  it("melewati baris yang belum jatuh tempo", async () => {
    const { processor, logs } = await setup(1);
    const future = logs.entries[0];
    if (future) {
      future.nextAttemptAt = "2026-11-03T11:00:00.000Z";
    }

    const report = await processor.run();

    expect(report.due).toBe(0);
  });
});
