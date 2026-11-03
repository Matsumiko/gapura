import type { MerchantCredentials, SettingsRepository } from "../types";

export interface CredentialResolver {
  getActive(): Promise<MerchantCredentials | null>;
}

export interface CredentialResolverDeps {
  store: SettingsRepository;
  fallback: { merchantCode: string; apiKey: string; environment: "sandbox" | "production" };
}

/** Kredensial aktif dari D1; bila belum ada, pakai secret Worker lama. */
export function createCredentialResolver(deps: CredentialResolverDeps): CredentialResolver {
  return {
    async getActive(): Promise<MerchantCredentials | null> {
      const stored = await deps.store.getActive();
      if (stored) {
        return stored;
      }
      if (!deps.fallback.merchantCode || !deps.fallback.apiKey) {
        return null;
      }
      return {
        environment: deps.fallback.environment,
        merchantCode: deps.fallback.merchantCode,
        apiKey: deps.fallback.apiKey,
        updatedAt: "env-fallback",
        updatedBy: "worker-secret",
      };
    },
  };
}
