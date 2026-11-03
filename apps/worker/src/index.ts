import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { createCronRunner, type CronRunner } from "./cron";
import { createAccessVerifier } from "./providers/access";
import { createDuitkuProvider } from "./providers/duitku";
import { createAdminRepository } from "./repositories/admin";
import { createProjectsRepository } from "./repositories/projects";
import { createTransactionRepository } from "./repositories/transactions";
import { createWebhookLogRepository } from "./repositories/webhook-logs";
import { createAdminService } from "./services/admin";
import { createCallbackService } from "./services/callbacks";
import { createPaymentsService } from "./services/payments";
import { createRetention } from "./services/retention";
import { createRetryProcessor } from "./services/retries";
import { createPendingSync } from "./services/sync";
import { createWebhookForwarder, deliverWebhook, type DeliverFn } from "./services/webhooks";
import type { AppEnv, Env } from "./types";

interface Runtime {
  app: Hono<AppEnv>;
  cron: CronRunner;
}

const runtimes = new WeakMap<Env, Runtime>();

const now = (): Date => new Date();

function runtimeFor(env: Env): Runtime {
  let runtime = runtimes.get(env);
  if (runtime) {
    return runtime;
  }

  // workerd menolak fetch yang dipanggil tanpa receiver-nya.
  const fetchImpl = fetch.bind(globalThis);
  const transactions = createTransactionRepository(env.DB);
  const logs = createWebhookLogRepository(env.DB);
  const provider = createDuitkuProvider({
    merchantCode: env.DUITKU_MERCHANT_CODE ?? "",
    apiKey: env.DUITKU_API_KEY ?? "",
    baseUrl: env.DUITKU_BASE_URL ?? "https://sandbox.duitku.com",
    fetch: fetchImpl,
  });
  const forwarder = createWebhookForwarder({ fetch: fetchImpl, logs, now });
  const deliver: DeliverFn = (project, payload) =>
    deliverWebhook({ fetch: fetchImpl, project, payload, now });

  const adminVerifier =
    env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD
      ? createAccessVerifier({
          config: { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
          fetch: fetchImpl,
        })
      : null;

  const app = buildApp({
    projects: createProjectsRepository(env.DB),
    sha256Hex,
    panelOrigin: env.PANEL_ORIGIN,
    payments: createPaymentsService({
      transactions,
      provider,
      publicBaseUrl: env.PUBLIC_BASE_URL ?? "",
      now,
    }),
    callbacks: createCallbackService({
      transactions,
      merchantCode: env.DUITKU_MERCHANT_CODE ?? "",
      apiKey: env.DUITKU_API_KEY ?? "",
      now,
    }),
    forwarder,
    admin: createAdminService({
      admin: createAdminRepository(env.DB),
      now,
      generateApiKey,
      generateWebhookSecret,
      sha256Hex,
    }),
    adminVerifier,
  });

  const cron = createCronRunner({
    retries: createRetryProcessor({ transactions, logs, deliver, now }),
    sync: createPendingSync({ transactions, provider, forwarder, now }),
    retention: createRetention({ logs, now }),
  });

  runtime = { app, cron };
  runtimes.set(env, runtime);
  return runtime;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return runtimeFor(env).app.fetch(request, env, ctx);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      runtimeFor(env)
        .cron.run()
        .then((report) => {
          console.log("cron_done", JSON.stringify(report));
        })
        .catch((error: unknown) => {
          console.error("cron_failed", error instanceof Error ? error.message : "unknown");
        }),
    );
  },
} satisfies ExportedHandler<Env>;
