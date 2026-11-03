import { describe, expect, it } from "vitest";
import { createRetention } from "../src/services/retention";
import { createMemoryWebhookLogs } from "./support/memory-logs";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const OLD = "2026-09-01T10:00:00.000Z";
const RECENT = "2026-11-02T10:00:00.000Z";

async function setup() {
  const logs = createMemoryWebhookLogs();
  await logs.repo.insertAttempt({
    merchantOrderId: "PRJA-LAMA",
    attempt: 1,
    httpStatus: 200,
    error: null,
    nextAttemptAt: null,
    status: "DELIVERED",
    createdAt: OLD,
  });
  await logs.repo.insertAttempt({
    merchantOrderId: "PRJA-MATI",
    attempt: 8,
    httpStatus: 500,
    error: "HTTP 500",
    nextAttemptAt: null,
    status: "DEAD",
    createdAt: OLD,
  });
  await logs.repo.insertAttempt({
    merchantOrderId: "PRJA-RETRY",
    attempt: 1,
    httpStatus: 500,
    error: "HTTP 500",
    nextAttemptAt: "2026-11-03T10:01:00.000Z",
    status: "FAILED",
    createdAt: OLD,
  });
  await logs.repo.insertAttempt({
    merchantOrderId: "PRJA-BARU",
    attempt: 1,
    httpStatus: 200,
    error: null,
    nextAttemptAt: null,
    status: "DELIVERED",
    createdAt: RECENT,
  });
  const retention = createRetention({ logs: logs.repo, now: () => NOW });
  return { retention, logs };
}

describe("retention webhook logs", () => {
  it("memangkas riwayat selesai yang lebih tua dari 30 hari", async () => {
    const { retention, logs } = await setup();

    const pruned = await retention.run();

    expect(pruned).toBe(2);
    expect(logs.entries.map((entry) => entry.merchantOrderId).sort()).toEqual([
      "PRJA-BARU",
      "PRJA-RETRY",
    ]);
  });

  it("tidak pernah memangkas retry yang masih terjadwal", async () => {
    const { retention, logs } = await setup();

    await retention.run();

    const retry = logs.entries.find((entry) => entry.merchantOrderId === "PRJA-RETRY");
    expect(retry?.nextAttemptAt).toBe("2026-11-03T10:01:00.000Z");
  });
});
