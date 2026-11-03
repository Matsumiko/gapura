import { hmacSha256Hex } from "@gapura/shared/hmac";
import type { FetchLike } from "../providers/duitku";
import type {
  PaymentStatus,
  ProjectWebhookTarget,
  WebhookLogRepository,
} from "../types";

export interface PaymentWebhookPayload {
  merchantOrderId: string;
  projectOrderId: string;
  status: PaymentStatus;
  amount: number;
  paymentMethod: string | null;
  reference: string | null;
  updatedAt: string;
}

export interface ForwardInstruction {
  project: ProjectWebhookTarget;
  payload: PaymentWebhookPayload;
}

export interface WebhookForwarder {
  forward(instruction: ForwardInstruction): Promise<void>;
}

export interface ForwarderDeps {
  fetch: FetchLike;
  logs: WebhookLogRepository;
  now: () => Date;
}

/** Retry pertama dijadwalkan 1 menit setelah gagal; pemrosesnya (Cron) menyusul di Fase 3. */
const FIRST_RETRY_DELAY_MS = 60_000;

export function webhookSignaturePayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

export function createWebhookForwarder(deps: ForwarderDeps): WebhookForwarder {
  return {
    async forward({ project, payload }: ForwardInstruction): Promise<void> {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(deps.now().getTime() / 1000);
      const signature = await hmacSha256Hex(
        webhookSignaturePayload(timestamp, body),
        project.webhookSecret,
      );

      let httpStatus: number | null = null;
      let error: string | null = null;
      let delivered = false;

      try {
        const response = await deps.fetch(project.webhookUrl, {
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
        httpStatus = response.status;
        delivered = response.ok;
        if (!delivered) {
          error = `HTTP ${response.status}`;
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "network error";
      }

      const createdAt = deps.now().toISOString();
      await deps.logs.insertAttempt({
        merchantOrderId: payload.merchantOrderId,
        attempt: 1,
        httpStatus,
        error,
        nextAttemptAt: delivered
          ? null
          : new Date(deps.now().getTime() + FIRST_RETRY_DELAY_MS).toISOString(),
        status: delivered ? "DELIVERED" : "PENDING",
        createdAt,
      });
    },
  };
}
