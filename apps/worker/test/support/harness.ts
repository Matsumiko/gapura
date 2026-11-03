import { sha256Hex } from "@gapura/shared/crypto";
import { buildApp, type AppDeps } from "../../src/app";
import type { AdminService } from "../../src/services/admin";
import type { CallbackService } from "../../src/services/callbacks";
import type { PaymentsService } from "../../src/services/payments";
import type { WebhookForwarder } from "../../src/services/webhooks";
import type { AppEnv, Env, ProjectRecord, ProjectRepository } from "../../src/types";
import type { Hono } from "hono";

export const PANEL_ORIGIN = "http://localhost:5173";
export const ACTIVE_KEY = "gpk_active_test_key";
export const INACTIVE_KEY = "gpk_inactive_test_key";

export interface FixtureProject extends ProjectRecord {
  apiKeyHash: string;
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    PANEL_ORIGIN,
    PUBLIC_BASE_URL: "https://pay.test",
    DUITKU_MERCHANT_CODE: "D0001",
    DUITKU_API_KEY: "duitku-secret",
    ...overrides,
  };
}

export async function fixtureProjects(): Promise<FixtureProject[]> {
  return [
    {
      id: "proja",
      name: "Project A",
      prefix: "PRJA",
      webhookUrl: "https://a.example/hook",
      isActive: true,
      apiKeyHash: await sha256Hex(ACTIVE_KEY),
    },
    {
      id: "projb",
      name: "Project B",
      prefix: "PRJB",
      webhookUrl: "https://b.example/hook",
      isActive: false,
      apiKeyHash: await sha256Hex(INACTIVE_KEY),
    },
  ];
}

export function repoFrom(projects: FixtureProject[]): ProjectRepository {
  const byHash = new Map(projects.map((project) => [project.apiKeyHash, project]));
  return {
    findByApiKeyHash: async (apiKeyHash) => byHash.get(apiKeyHash) ?? null,
  };
}

const unusedPayments: PaymentsService = {
  async create() {
    throw new Error("payments.create tidak diharapkan di test ini");
  },
  async get() {
    return null;
  },
};

const unusedCallbacks: CallbackService = {
  async handle() {
    return { outcome: "ignored" };
  },
};

const unusedAdmin = {
  async summary() {
    throw new Error("admin.summary tidak diharapkan di test ini");
  },
  async listProjects() {
    throw new Error("admin.listProjects tidak diharapkan di test ini");
  },
  async createProject() {
    throw new Error("admin.createProject tidak diharapkan di test ini");
  },
  async setProjectActive() {
    throw new Error("admin.setProjectActive tidak diharapkan di test ini");
  },
  async rotateApiKey() {
    throw new Error("admin.rotateApiKey tidak diharapkan di test ini");
  },
  async rotateWebhookSecret() {
    throw new Error("admin.rotateWebhookSecret tidak diharapkan di test ini");
  },
  async listTransactions() {
    throw new Error("admin.listTransactions tidak diharapkan di test ini");
  },
  async getTransaction() {
    throw new Error("admin.getTransaction tidak diharapkan di test ini");
  },
  async listWebhooks() {
    throw new Error("admin.listWebhooks tidak diharapkan di test ini");
  },
  async retryWebhook() {
    throw new Error("admin.retryWebhook tidak diharapkan di test ini");
  },
} satisfies AdminService;

const unusedForwarder: WebhookForwarder = {
  async forward() {
    throw new Error("forwarder.forward tidak diharapkan di test ini");
  },
};

export interface TestApp {
  app: Hono<AppEnv>;
  deps: AppDeps;
  env: Env;
  ctx: ExecutionContext;
  flushBackground: () => Promise<void>;
}

export async function createTestApp(
  overrides: Partial<AppDeps> = {},
  envOverrides: Partial<Env> = {},
): Promise<TestApp> {
  const projects = overrides.projects ?? repoFrom(await fixtureProjects());
  const deps: AppDeps = {
    projects,
    sha256Hex,
    panelOrigin: PANEL_ORIGIN,
    payments: unusedPayments,
    callbacks: unusedCallbacks,
    forwarder: unusedForwarder,
    admin: unusedAdmin,
    adminToken: undefined as string | undefined,
    ...overrides,
  };
  const background: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(task: Promise<unknown>) {
      background.push(task);
    },
    passThroughOnException() {},
  } as ExecutionContext;

  return {
    app: buildApp(deps),
    deps,
    env: makeEnv(envOverrides),
    ctx,
    async flushBackground() {
      await Promise.all(background);
    },
  };
}

export { buildApp };
