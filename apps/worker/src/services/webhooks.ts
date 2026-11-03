import { hmacSha256Hex } from "@gapura/shared/hmac";
import type { FetchLike } from "../providers/duitku";
import type { ProjectWebhookTarget, WebhookLogRepository } from "../types";
import type { ForwardInstruction, PaymentWebhookPayload } from "./payload";
import { nextAttemptDelayMs } from "./retry-policy";

export type { ForwardInstruction, PaymentWebhookPayload } from "./payload";

export interface DeliveryResult {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
}

export type DeliverFn = (
  project: ProjectWebhookTarget,
  payload: PaymentWebhookPayload,
) => Promise<DeliveryResult>;

export interface WebhookForwarder {
  forward(instruction: ForwardInstruction): Promise<void>;
}

export interface ForwarderDeps {
  fetch: FetchLike;
  logs: WebhookLogRepository;
  now: () => Date;
}

export function webhookSignaturePayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

export interface DeliverWebhookOptions {
  fetch: FetchLike;
  project: ProjectWebhookTarget;
  payload: PaymentWebhookPayload;
  now: () => Date;
}

/** Satu percobaan pengiriman; tidak menyentuh database. */
export async function deliverWebhook(options: DeliverWebhookOptions): Promise<DeliveryResult> {
  const body = JSON.stringify(options.payload);
  const timestamp = Math.floor(options.now().getTime() / 1000);
  const signature = await hmacSha256Hex(
    webhookSignaturePayload(timestamp, body),
    options.project.webhookSecret,
  );

  try {
    const response = await options.fetch(options.project.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Gapura/1",
        "X-Gapura-Event": "payment.status",
        "X-Gapura-Signature": `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      return { ok: true, httpStatus: response.status, error: null };
    }
    return { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
  } catch (cause) {
    return {
      ok: false,
      httpStatus: null,
      error: cause instanceof Error ? cause.message : "network error",
    };
  }
}

/**
 * Percobaan pertama setelah status berubah. Kegagalan dijadwalkan ulang
 * oleh pemroses Cron memakai baris `FAILED` + `next_attempt_at`.
 */
export function createWebhookForwarder(deps: ForwarderDeps): WebhookForwarder {
  return {
    async forward({ project, payload }: ForwardInstruction): Promise<void> {
      const result = await deliverWebhook({ fetch: deps.fetch, project, payload, now: deps.now });
      const now = deps.now();

      await deps.logs.insertAttempt({
        merchantOrderId: payload.merchantOrderId,
        attempt: 1,
        httpStatus: result.httpStatus,
        error: result.error,
        nextAttemptAt: result.ok
          ? null
          : new Date(now.getTime() + nextAttemptDelayMs(1)).toISOString(),
        status: result.ok ? "DELIVERED" : "FAILED",
        createdAt: now.toISOString(),
      });
    },
  };
}
