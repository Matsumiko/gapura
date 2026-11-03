import { sha256Hex } from "@gapura/shared/crypto";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { createDuitkuProvider } from "./providers/duitku";
import { createProjectsRepository } from "./repositories/projects";
import { createTransactionRepository } from "./repositories/transactions";
import { createWebhookLogRepository } from "./repositories/webhook-logs";
import { createCallbackService } from "./services/callbacks";
import { createPaymentsService } from "./services/payments";
import { createWebhookForwarder } from "./services/webhooks";
import type { AppEnv, Env } from "./types";

const apps = new WeakMap<Env, Hono<AppEnv>>();

const now = (): Date => new Date();

function appFor(env: Env): Hono<AppEnv> {
  let app = apps.get(env);
  if (!app) {
    // workerd menolak fetch yang dipanggil tanpa receiver-nya.
    const fetchImpl = fetch.bind(globalThis);
    const transactions = createTransactionRepository(env.DB);
    const logs = createWebhookLogRepository(env.DB);
    app = buildApp({
      projects: createProjectsRepository(env.DB),
      sha256Hex,
      panelOrigin: env.PANEL_ORIGIN,
      payments: createPaymentsService({
        transactions,
        provider: createDuitkuProvider({
          merchantCode: env.DUITKU_MERCHANT_CODE ?? "",
          apiKey: env.DUITKU_API_KEY ?? "",
          baseUrl: env.DUITKU_BASE_URL ?? "https://sandbox.duitku.com",
          fetch: fetchImpl,
        }),
        publicBaseUrl: env.PUBLIC_BASE_URL ?? "",
        now,
      }),
      callbacks: createCallbackService({
        transactions,
        merchantCode: env.DUITKU_MERCHANT_CODE ?? "",
        apiKey: env.DUITKU_API_KEY ?? "",
        now,
      }),
      forwarder: createWebhookForwarder({ fetch: fetchImpl, logs, now }),
    });
    apps.set(env, app);
  }
  return app;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return appFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
