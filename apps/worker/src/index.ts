import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { Hono } from "hono";
import { buildApp } from "./app";
import { createCronRunner, type CronRunner } from "./cron";
import { createManagedDuitkuProvider } from "./providers/managed";
import { createAdminRepository } from "./repositories/admin";
import { createAdminMaintenanceRepository } from "./repositories/admin-maintenance";
import { createAdminSessionRepository } from "./repositories/admin-sessions";
import { createAdminUserRepository } from "./repositories/admin-users";
import { createProjectsRepository } from "./repositories/projects";
import { createSettingsRepository } from "./repositories/settings";
import { createTransactionRepository } from "./repositories/transactions";
import { createWebhookLogRepository } from "./repositories/webhook-logs";
import { createAdminService } from "./services/admin";
import { createAdminAuthService } from "./services/admin-auth";
import { createAdminMaintenance, type AdminMaintenance } from "./services/admin-maintenance";
import { createAdminSessionService } from "./services/admin-sessions";
import { createCallbackService } from "./services/callbacks";
import { createCredentialCipher, type CredentialCipher } from "./services/credentials";
import { createCredentialResolver } from "./services/credential-resolver";
import { createPaymentMethodsService } from "./services/payment-methods";
import { createPaymentsService } from "./services/payments";
import { createRetention } from "./services/retention";
import { createRetryProcessor } from "./services/retries";
import { createSettingsService } from "./services/settings";
import { createPendingSync } from "./services/sync";
import { createWebhookForwarder, deliverWebhook, type DeliverFn } from "./services/webhooks";
import type { AppEnv, Env, MerchantEnvironment } from "./types";

interface EnvironmentRuntime {
  environment: MerchantEnvironment;
  app: Hono<AppEnv>;
  cron: CronRunner;
}

export interface RootRuntime {
  root: Hono<AppEnv>;
  sandbox: EnvironmentRuntime;
  production: EnvironmentRuntime;
  /** Pembersihan data auth di `DB_AUTH`; sekali saja karena DB-nya dipakai bersama. */
  adminMaintenance: AdminMaintenance;
}

const runtimes = new WeakMap<Env, RootRuntime>();

const now = (): Date => new Date();

function buildEnvironmentRuntime(
  env: Env,
  db: D1Database,
  environment: MerchantEnvironment,
  shared: { auth: ReturnType<typeof createAdminAuthService>; sessions: ReturnType<typeof createAdminSessionService> },
): EnvironmentRuntime {
  // workerd menolak fetch yang dipanggil tanpa receiver-nya.
  const fetchImpl = fetch.bind(globalThis);
  const transactions = createTransactionRepository(db);
  const logs = createWebhookLogRepository(db);

  let cipherPromise: Promise<CredentialCipher> | null = null;
  const getCipher = (): Promise<CredentialCipher | null> => {
    if (!env.CREDENTIALS_KEY) {
      return Promise.resolve(null);
    }
    cipherPromise ??= createCredentialCipher(env.CREDENTIALS_KEY);
    return cipherPromise;
  };

  const adminRepo = createAdminRepository(db);
  const settingsRepo = createSettingsRepository({ db, getCipher });
  const resolver = createCredentialResolver({
    store: settingsRepo,
    fallback: {
      // Secret lama hanya dipakai sandbox; production harus lewat panel.
      merchantCode: environment === "sandbox" ? (env.DUITKU_MERCHANT_CODE ?? "") : "",
      apiKey: environment === "sandbox" ? (env.DUITKU_API_KEY ?? "") : "",
      environment,
    },
  });
  const provider = createManagedDuitkuProvider({ fetch: fetchImpl, resolver });
  const forwarder = createWebhookForwarder({ fetch: fetchImpl, logs, now });
  const deliver: DeliverFn = (project, payload) =>
    deliverWebhook({ fetch: fetchImpl, project, payload, now });

  const app = buildApp({
    projects: createProjectsRepository(db),
    sha256Hex,
    panelOrigin: env.PANEL_ORIGIN,
    payments: createPaymentsService({
      transactions,
      provider,
      publicBaseUrl: `${env.PUBLIC_BASE_URL ?? ""}/${environment}`,
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
    adminAuth: shared.auth,
    adminSessions: shared.sessions,
    paymentMethods: createPaymentMethodsService({ provider }),
    settings: createSettingsService({
      repo: settingsRepo,
      now,
      cipherConfigured: Boolean(env.CREDENTIALS_KEY),
      publicBaseUrl: `${env.PUBLIC_BASE_URL ?? ""}/${environment}`,
      fetch: fetchImpl,
      insertAudit: (entry) => adminRepo.insertAudit(entry),
      environmentScope: environment,
    }),
  });

  const cron = createCronRunner({
    retries: createRetryProcessor({ transactions, logs, deliver, now }),
    sync: createPendingSync({ transactions, provider, forwarder, now }),
    retention: createRetention({ logs, now }),
  });

  return { environment, app, cron };
}

export function runtimeFor(env: Env): RootRuntime {
  let runtime = runtimes.get(env);
  if (runtime) {
    return runtime;
  }

  const authRepo = createAdminRepository(env.DB_AUTH);
  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(env.DB_AUTH),
    now,
  });
  const adminMaintenance = createAdminMaintenance({
    sessions,
    attempts: createAdminMaintenanceRepository(env.DB_AUTH),
    now,
  });
  const auth = createAdminAuthService({
    users: createAdminUserRepository(env.DB_AUTH),
    sessions,
    getCipher: async () =>
      env.CREDENTIALS_KEY ? createCredentialCipher(env.CREDENTIALS_KEY) : null,
    setupToken: env.ADMIN_SETUP_TOKEN,
    issuer: "Gapura",
    now,
    insertAudit: (entry) => authRepo.insertAudit(entry),
    listAudit: (limit) => authRepo.listAudit(limit),
  });
  const shared = { auth, sessions };

  const sandbox = buildEnvironmentRuntime(env, env.DB_SANDBOX, "sandbox", shared);
  const production = buildEnvironmentRuntime(env, env.DB_PRODUCTION, "production", shared);

  const root = new Hono<AppEnv>();
  root.route("/production", production.app);
  root.route("/sandbox", sandbox.app);
  // Kompatibilitas: path lama (tanpa prefix) tetap sandbox.
  root.route("/", sandbox.app);

  runtime = { root, sandbox, production, adminMaintenance };
  runtimes.set(env, runtime);
  return runtime;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return runtimeFor(env).root.fetch(request, env, ctx);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const runtime = runtimeFor(env);
    const jobs = [
      { name: "sandbox", run: () => runtime.sandbox.cron.run() },
      { name: "production", run: () => runtime.production.cron.run() },
      { name: "admin_maintenance", run: () => runtime.adminMaintenance.run() },
    ];
    ctx.waitUntil(
      Promise.allSettled(jobs.map((job) => job.run()))
        .then((results) => {
          console.log(
            "cron_done",
            JSON.stringify(
              results.map((result, index) => ({
                job: jobs[index]?.name ?? "unknown",
                status: result.status,
                value: result.status === "fulfilled" ? result.value : String(result.reason),
              })),
            ),
          );
        })
        .catch((error: unknown) => {
          console.error("cron_failed", error instanceof Error ? error.message : "unknown");
        }),
    );
  },
} satisfies ExportedHandler<Env>;
