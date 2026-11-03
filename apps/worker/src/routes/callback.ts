import type { Hono } from "hono";
import { jsonError } from "../http";
import type { CallbackService } from "../services/callbacks";
import type { WebhookForwarder } from "../services/webhooks";
import type { AppEnv } from "../types";

export interface CallbackRouteDeps {
  callbacks: CallbackService;
  forwarder: WebhookForwarder;
}

function formToRecord(body: Record<string, string | File>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}

export function registerCallbackRoute(app: Hono<AppEnv>, deps: CallbackRouteDeps): void {
  app.post("/callback/duitku", async (c) => {
    const form = await c.req.parseBody();
    const result = await deps.callbacks.handle(formToRecord(form));

    if (result.outcome === "bad_parameter") {
      return jsonError(c, 400, "INVALID_CALLBACK", "Parameter callback tidak lengkap.");
    }
    if (result.outcome === "bad_signature") {
      return jsonError(c, 401, "INVALID_SIGNATURE", "Signature callback tidak valid.");
    }

    if (result.forward) {
      c.executionCtx.waitUntil(
        deps.forwarder.forward(result.forward).catch((error: unknown) => {
          console.error(
            "webhook_forward_failed",
            result.forward?.payload.merchantOrderId,
            error instanceof Error ? error.message : "unknown",
          );
        }),
      );
    }

    // 200 untuk semua hasil lain supaya Duitku berhenti mengulang callback yang sudah diproses.
    return c.text("OK", 200);
  });
}
