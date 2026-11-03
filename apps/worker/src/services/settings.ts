import type { MerchantSettingsInput } from "@gapura/shared/admin";
import { createDuitkuProvider, type FetchLike } from "../providers/duitku";
import type {
  AuditEntry,
  MerchantEnvironment,
  MerchantSettingsView,
  SettingsRepository,
} from "../types";

export class SettingsUnavailableError extends Error {
  constructor(message = "CREDENTIALS_KEY belum diset di Worker.") {
    super(message);
    this.name = "SettingsUnavailableError";
  }
}

export class SettingsNotFoundError extends Error {
  constructor(message = "Kredensial environment belum ada.") {
    super(message);
    this.name = "SettingsNotFoundError";
  }
}

export class SettingsInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsInvalidError";
  }
}

export interface SettingsOverview {
  activeEnvironment: MerchantEnvironment | null;
  callbackUrl: string;
  credentialsKeyConfigured: boolean;
  items: MerchantSettingsView[];
}

export interface SettingsTestResult {
  environment: MerchantEnvironment;
  count: number;
  sample: Array<{ code: string; name: string; totalFee: string }>;
}

export interface SettingsService {
  overview(): Promise<SettingsOverview>;
  save(
    environment: MerchantEnvironment,
    input: MerchantSettingsInput,
    actor: string,
  ): Promise<MerchantSettingsView>;
  activate(environment: MerchantEnvironment, actor: string): Promise<MerchantSettingsView>;
  test(environment: MerchantEnvironment): Promise<SettingsTestResult>;
}

export interface SettingsServiceDeps {
  repo: SettingsRepository;
  now: () => Date;
  cipherConfigured: boolean;
  publicBaseUrl: string;
  fetch: FetchLike;
  insertAudit: (entry: AuditEntry) => Promise<void>;
}

const ENVIRONMENTS: MerchantEnvironment[] = ["sandbox", "production"];

function emptyView(environment: MerchantEnvironment): MerchantSettingsView {
  return {
    environment,
    merchantCode: "",
    apiKeySet: false,
    isActive: false,
    updatedAt: null,
    updatedBy: null,
  };
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  async function audit(
    actor: string,
    action: string,
    environment: MerchantEnvironment,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    await deps.insertAudit({
      actorEmail: actor,
      action,
      target: environment,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: deps.now().toISOString(),
    });
  }

  async function viewOf(environment: MerchantEnvironment): Promise<MerchantSettingsView> {
    const items = await deps.repo.list();
    return items.find((item) => item.environment === environment) ?? emptyView(environment);
  }

  return {
    async overview(): Promise<SettingsOverview> {
      const stored = await deps.repo.list();
      const items = ENVIRONMENTS.map(
        (environment) => stored.find((item) => item.environment === environment) ?? emptyView(environment),
      );
      return {
        activeEnvironment: items.find((item) => item.isActive)?.environment ?? null,
        callbackUrl: `${deps.publicBaseUrl}/callback/duitku`,
        credentialsKeyConfigured: deps.cipherConfigured,
        items,
      };
    },

    async save(
      environment: MerchantEnvironment,
      input: MerchantSettingsInput,
      actor: string,
    ): Promise<MerchantSettingsView> {
      if (input.apiKey !== undefined && !deps.cipherConfigured) {
        throw new SettingsUnavailableError();
      }
      if (input.apiKey === undefined) {
        const existing = await deps.repo.get(environment).catch(() => null);
        if (!existing) {
          throw new SettingsInvalidError("apiKey wajib diisi untuk environment baru.");
        }
      }

      const saved = await deps.repo.upsert({
        environment,
        merchantCode: input.merchantCode,
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        updatedAt: deps.now().toISOString(),
        updatedBy: actor,
      });
      if (!saved) {
        throw new SettingsNotFoundError();
      }
      await audit(actor, "save_merchant_settings", environment, {
        merchantCode: input.merchantCode,
        apiKeyChanged: input.apiKey !== undefined,
      });
      return viewOf(environment);
    },

    async activate(environment: MerchantEnvironment, actor: string): Promise<MerchantSettingsView> {
      const activated = await deps.repo.activate(environment);
      if (!activated) {
        throw new SettingsNotFoundError();
      }
      await audit(actor, "activate_environment", environment, null);
      return viewOf(environment);
    },

    async test(environment: MerchantEnvironment): Promise<SettingsTestResult> {
      if (!deps.cipherConfigured) {
        throw new SettingsUnavailableError();
      }
      const credentials = await deps.repo.get(environment);
      if (!credentials) {
        throw new SettingsNotFoundError();
      }

      const provider = createDuitkuProvider({
        merchantCode: credentials.merchantCode,
        apiKey: credentials.apiKey,
        baseUrl:
          environment === "production"
            ? "https://passport.duitku.com"
            : "https://sandbox.duitku.com",
        fetch: deps.fetch,
      });
      const methods = await provider.getPaymentMethods(10_000);
      return {
        environment,
        count: methods.length,
        sample: methods.slice(0, 3).map((method) => ({
          code: method.code,
          name: method.name,
          totalFee: method.totalFee,
        })),
      };
    },
  };
}
