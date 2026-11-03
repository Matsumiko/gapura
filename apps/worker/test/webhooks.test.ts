import { hmacSha256Hex } from "@gapura/shared/hmac";
import { describe, expect, it } from "vitest";
import { createWebhookForwarder, webhookSignaturePayload } from "../src/services/webhooks";
import type { WebhookLogEntry, WebhookLogRepository } from "../src/types";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const PROJECT = {
  id: "proja",
  webhookUrl: "https://a.example/hook",
  webhookSecret: "whsec_a",
  isActive: true,
};
const PAYLOAD = {
  merchantOrderId: "PRJA-INV123",
  projectOrderId: "INV123",
  status: "PAID" as const,
  amount: 150000,
  paymentMethod: "VC",
  reference: "REF-1",
  updatedAt: "2026-11-03T10:00:00.000Z",
};

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function setup(response: Response | Error) {
  const logs: WebhookLogEntry[] = [];
  const repository: WebhookLogRepository = {
    async insertAttempt(entry) {
      logs.push(entry);
    },
  };
  let captured: CapturedRequest | undefined;
  const forwarder = createWebhookForwarder({
    fetch: async (input, init) => {
      captured = { url: String(input), init };
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    logs: repository,
    now: () => NOW,
  });
  return { forwarder, logs, captured: () => captured };
}

describe("webhook forwarder", () => {
  it("mengirim body bertanda tangan HMAC dengan timestamp", async () => {
    const { forwarder, logs, captured } = setup(new Response("ok", { status: 200 }));

    await forwarder.forward({ project: PROJECT, payload: PAYLOAD });

    const request = captured();
    expect(request?.url).toBe("https://a.example/hook");
    expect(request?.init?.method).toBe("POST");

    const headers = request?.init?.headers as Record<string, string>;
    expect(headers["X-Gapura-Event"]).toBe("payment.status");
    const body = String(request?.init?.body);
    expect(JSON.parse(body)).toEqual(PAYLOAD);

    const timestamp = Math.floor(NOW.getTime() / 1000);
    const expectedSignature = await hmacSha256Hex(
      webhookSignaturePayload(timestamp, body),
      PROJECT.webhookSecret,
    );
    expect(headers["X-Gapura-Signature"]).toBe(`t=${timestamp},v1=${expectedSignature}`);

    expect(logs).toEqual([
      {
        merchantOrderId: "PRJA-INV123",
        attempt: 1,
        httpStatus: 200,
        error: null,
        nextAttemptAt: null,
        status: "DELIVERED",
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  it("menjadwalkan retry saat project membalas non-2xx", async () => {
    const { forwarder, logs } = setup(new Response("boom", { status: 500 }));

    await forwarder.forward({ project: PROJECT, payload: PAYLOAD });

    expect(logs[0]).toMatchObject({
      status: "PENDING",
      httpStatus: 500,
      error: "HTTP 500",
      nextAttemptAt: "2026-11-03T10:01:00.000Z",
    });
  });

  it("menjadwalkan retry saat koneksi gagal dan tidak melempar error", async () => {
    const { forwarder, logs } = setup(new Error("connection refused"));

    await expect(forwarder.forward({ project: PROJECT, payload: PAYLOAD })).resolves.toBeUndefined();

    expect(logs[0]).toMatchObject({
      status: "PENDING",
      httpStatus: null,
      error: "connection refused",
      nextAttemptAt: "2026-11-03T10:01:00.000Z",
    });
  });
});
