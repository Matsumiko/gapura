import {
  PaymentProviderError,
  createDuitkuProvider,
  type FetchLike,
  type PaymentProvider,
} from "./duitku";
import type { CredentialResolver } from "../services/credential-resolver";

const SANDBOX_URL = "https://sandbox.duitku.com";
const PRODUCTION_URL = "https://passport.duitku.com";

/**
 * Provider yang membaca kredensial aktif dari D1 setiap request dan
 * membuat ulang klien bila environment/versi kredensial berubah.
 */
export function createManagedDuitkuProvider(deps: {
  fetch: FetchLike;
  resolver: CredentialResolver;
}): PaymentProvider {
  let cache: { key: string; provider: PaymentProvider } | null = null;

  async function resolve(): Promise<PaymentProvider> {
    let credentials;
    try {
      credentials = await deps.resolver.getActive();
    } catch {
      throw new PaymentProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "Kredensial Duitku tidak bisa dibaca (CREDENTIALS_KEY salah?).",
      );
    }
    if (!credentials) {
      throw new PaymentProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "Belum ada kredensial Duitku yang aktif.",
      );
    }

    const key = `${credentials.environment}:${credentials.updatedAt}:${credentials.merchantCode}`;
    if (!cache || cache.key !== key) {
      cache = {
        key,
        provider: createDuitkuProvider({
          merchantCode: credentials.merchantCode,
          apiKey: credentials.apiKey,
          baseUrl: credentials.environment === "production" ? PRODUCTION_URL : SANDBOX_URL,
          fetch: deps.fetch,
        }),
      };
    }
    return cache.provider;
  }

  return {
    async createInvoice(request) {
      return (await resolve()).createInvoice(request);
    },
    async getStatus(merchantOrderId) {
      return (await resolve()).getStatus(merchantOrderId);
    },
    async getPaymentMethods(amount) {
      return (await resolve()).getPaymentMethods(amount);
    },
  };
}
