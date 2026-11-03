import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { createCronRunner, type CronRunner } from "./cron";
import { createManagedDuitkuProvider } from "./providers/managed";
import { createAdminRepository } from "./repositories/admin";
import { createProjectsRepository } from "./repositories/projects";
import { createTransactionRepository } from "./repositories/transactions";
import { createWebhookLogRepository } from "./repositories/webhook-logs";
import { createAdminService } from "./services/admin";
import { createCallbackService } from "./services/callbacks";
import { createPaymentMethodsService } from "./services/payment-methods";
import { createPaymentsService } from "./services/payments";
import { createRetention } from "./services/retention";
import { createRetryProcessor } from "./services/retries";
import { createPendingSync } from "./services/sync";
import { createWebhookForwarder, deliverWebhook, type DeliverFn } from "./services/webhooks";
import { createCredentialCipher, type CredentialCipher } from "./services/credentials";
import { createCredentialResolver } from "./services/credential-resolver";
import { createSettingsService } from "./services/settings";
import { createSettingsRepository } from "./repositories/settings";
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

  let cipherPromise: Promise<CredentialCipher> | null = null;
  const getCipher = (): Promise<CredentialCipher | null> => {
    if (!env.CREDENTIALS_KEY) {
      return Promise.resolve(null);
    }
    cipherPromise ??= createCredentialCipher(env.CREDENTIALS_KEY);
    return cipherPromise;
  };

  const adminRepo = createAdminRepository(env.DB);
  const settingsRepo = createSettingsRepository({ db: env.DB, getCipher });
  const resolver = createCredentialResolver({
    store: settingsRepo,
    fallback: {
      merchantCode: env.DUITKU_MERCHANT_CODE ?? "",
      apiKey: env.DUITKU_API_KEY ?? "",
      environment: "sandbox",
    },
  });
  const provider = createManagedDuitkuProvider({ fetch: fetchImpl, resolver });
  const forwarder = createWebhookForwarder({ fetch: fetchImpl, logs, now });
  const deliver: DeliverFn = (project, payload) =>
    deliverWebhook({ fetch: fetchImpl, project, payload, now });

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
      credentials: async () => {
        const active = await resolver.getActive();
        return active ? { merchantCode: active.merchantCode, apiKey: active.apiKey } : null;
      },
      now,
    }),
    forwarder,
    admin: createAdminService({
      admin: adminRepo,
      now,
      generateApiKey,
      generateWebhookSecret,
      sha256Hex,
    }),
    adminToken: env.ADMIN_TOKEN,
    paymentMethods: createPaymentMethodsService({ provider }),
    settings: createSettingsService({
      repo: settingsRepo,
      now,
      cipherConfigured: Boolean(env.CREDENTIALS_KEY),
      publicBaseUrl: env.PUBLIC_BASE_URL ?? "",
      fetch: fetchImpl,
      insertAudit: (entry) => adminRepo.insertAudit(entry),
    }),
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
