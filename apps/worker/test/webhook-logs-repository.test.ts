import { describe, expect, it } from "vitest";
import { createWebhookLogRepository } from "../src/repositories/webhook-logs";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import { createTestDatabase } from "./support/d1";

const NOW = "2026-11-03T10:00:00.000Z";
const DUE = "2026-11-03T09:59:00.000Z";
const FUTURE = "2026-11-03T11:00:00.000Z";

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}`);
  const repo = createWebhookLogRepository(db);
  return { db, repo };
}

async function seed(
  repo: Awaited<ReturnType<typeof setup>>["repo"],
  overrides: Partial<Parameters<typeof repo.insertAttempt>[0]> = {},
): Promise<void> {
  await repo.insertAttempt({
    merchantOrderId: "PRJA-INV123",
    attempt: 1,
    httpStatus: 500,
    error: "HTTP 500",
    nextAttemptAt: DUE,
    status: "FAILED",
    createdAt: "2026-11-03T09:58:00.000Z",
    ...overrides,
  });
}

describe("webhook log repository", () => {
  it("hanya mengambil baris FAILED yang sudah jatuh tempo", async () => {
    const { repo } = await setup();
    await seed(repo);
    await seed(repo, { attempt: 2, nextAttemptAt: FUTURE });
    await seed(repo, { attempt: 3, status: "DELIVERED", nextAttemptAt: null });
    await seed(repo, { attempt: 4, status: "DEAD", nextAttemptAt: null });

    const due = await repo.findDue(NOW, 10);

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ merchantOrderId: "PRJA-INV123", attempt: 1, nextAttemptAt: DUE });
  });

  it("menghormati batas batch", async () => {
    const { repo } = await setup();
    await seed(repo, { merchantOrderId: "A" });
    await seed(repo, { merchantOrderId: "B" });

    expect(await repo.findDue(NOW, 1)).toHaveLength(1);
  });

  it("claim hanya berhasil pada jadwal yang sama", async () => {
    const { repo } = await setup();
    await seed(repo);
    const [due] = await repo.findDue(NOW, 10);
    if (!due) {
      throw new Error("baris due tidak ditemukan");
    }

    expect(await repo.claim(due.id, "salah", FUTURE)).toBe(false);
    expect(await repo.claim(due.id, DUE, FUTURE)).toBe(true);
    expect(await repo.findDue(NOW, 10)).toHaveLength(0);
    expect(await repo.findDue(FUTURE, 10)).toHaveLength(1);
  });

  it("clearSchedule menghentikan pemilihan ulang", async () => {
    const { repo } = await setup();
    await seed(repo);
    const [due] = await repo.findDue(NOW, 10);
    if (!due) {
      throw new Error("baris due tidak ditemukan");
    }

    await repo.clearSchedule(due.id);

    expect(await repo.findDue(FUTURE, 10)).toHaveLength(0);
  });

  it("memangkas hanya riwayat selesai yang lama", async () => {
    const { db, repo } = await setup();
    await seed(repo, {
      merchantOrderId: "LAMA-LUNAS",
      status: "DELIVERED",
      nextAttemptAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await seed(repo, {
      merchantOrderId: "BARU-LUNAS",
      status: "DELIVERED",
      nextAttemptAt: null,
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    await seed(repo, { merchantOrderId: "RETRY", status: "FAILED", createdAt: "2026-09-01T00:00:00.000Z" });

    const pruned = await repo.pruneTerminalBefore("2026-10-04T10:00:00.000Z");

    expect(pruned).toBe(1);
    const rows = await db
      .prepare("SELECT merchant_order_id FROM webhook_logs ORDER BY merchant_order_id")
      .all<{ merchant_order_id: string }>();
    expect(rows.results.map((row) => row.merchant_order_id)).toEqual(["BARU-LUNAS", "RETRY"]);
  });

  it("markDead mengubah status dan membuang jadwal", async () => {
    const { db, repo } = await setup();
    await seed(repo);
    const [due] = await repo.findDue(NOW, 10);
    if (!due) {
      throw new Error("baris due tidak ditemukan");
    }

    await repo.markDead(due.id);

    const row = await db
      .prepare("SELECT status, next_attempt_at FROM webhook_logs WHERE id = ?")
      .bind(due.id)
      .first<{ status: string; next_attempt_at: string | null }>();
    expect(row).toEqual({ status: "DEAD", next_attempt_at: null });
  });
});
