import type { AccountLink } from "@gapura/shared/payment";
import { hmacSha256Hex } from "@gapura/shared/hmac";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DuitkuConfig {
  merchantCode: string;
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
  now?: () => number;
  cacheTtlMs?: number;
}

export interface CreateInvoiceRequest {
  merchantOrderId: string;
  amount: number;
  paymentMethod: string;
  productDetails: string;
  customerName: string;
  email: string;
  returnUrl: string;
  callbackUrl: string;
  expiryPeriod?: number;
  creditCardDetail?: { acquirer?: string; binWhitelist?: string[] };
  /**
   * Hanya untuk channel `OL`/`SL`. `credentialCode` adalah kredensial akun tertaut
   * milik pemanggil; provider meneruskannya apa adanya tanpa menyimpan atau mencatat.
   */
  accountLink?: AccountLink;
}

export interface CreateInvoiceResponse {
  reference: string;
  paymentUrl: string;
  vaNumber: string | null;
  qrString: string | null;
}

export interface TransactionStatusResult {
  statusCode: string;
  reference: string | null;
  amount: number | null;
}

export interface DuitkuPaymentMethod {
  code: string;
  name: string;
  image: string;
  totalFee: string;
}

export interface PaymentMethodProvider {
  getPaymentMethods(amount: number): Promise<DuitkuPaymentMethod[]>;
}

export interface StatusProvider {
  getStatus(merchantOrderId: string): Promise<TransactionStatusResult>;
}

export interface PaymentProvider extends StatusProvider, PaymentMethodProvider {
  createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResponse>;
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** stringToSign = merchantCode + merchantOrderId + paymentAmount (Duitku API v2). */
export function createInvoiceSignature(
  merchantCode: string,
  merchantOrderId: string,
  paymentAmount: number,
  apiKey: string,
): Promise<string> {
  return hmacSha256Hex(`${merchantCode}${merchantOrderId}${paymentAmount}`, apiKey);
}

/** stringToSign = merchantCode + amount + merchantOrderId (callback Duitku). */
export function callbackSignature(
  merchantCode: string,
  amount: string,
  merchantOrderId: string,
  apiKey: string,
): Promise<string> {
  return hmacSha256Hex(`${merchantCode}${amount}${merchantOrderId}`, apiKey);
}

/** stringToSign = merchantcode + amount + datetime (get payment method). */
export function getPaymentMethodsSignature(
  merchantCode: string,
  amount: number,
  datetime: string,
  apiKey: string,
): Promise<string> {
  return hmacSha256Hex(`${merchantCode}${amount}${datetime}`, apiKey);
}

function duitkuDatetime(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** stringToSign = merchantCode + merchantOrderId (cek transaksi, dipakai Fase 3). */
export function transactionStatusSignature(
  merchantCode: string,
  merchantOrderId: string,
  apiKey: string,
): Promise<string> {
  return hmacSha256Hex(`${merchantCode}${merchantOrderId}`, apiKey);
}

interface InquiryBody {
  merchantCode: string;
  paymentAmount: number;
  paymentMethod: string;
  merchantOrderId: string;
  productDetails: string;
  customerVaName: string;
  email: string;
  returnUrl: string;
  callbackUrl: string;
  signature: string;
  expiryPeriod?: number;
  creditCardDetail?: { acquirer?: string; binWhitelist?: string[] };
  accountLink?: {
    credentialCode: string;
    ovo?: { paymentDetails: Array<{ paymentType: "CASH"; amount: number }> };
    // Vendor mewajibkan field ini ada; nilai kosong dipakai bila project tidak mengirim promoId.
    shopee?: { useCoin: boolean; promoId: string };
  };
}

function toInquiryAccountLink(accountLink: AccountLink): NonNullable<InquiryBody["accountLink"]> {
  return {
    credentialCode: accountLink.credentialCode,
    ...(accountLink.ovo
      ? {
          ovo: {
            paymentDetails: accountLink.ovo.paymentDetails.map((detail) => ({
              paymentType: detail.paymentType,
              amount: detail.amount,
            })),
          },
        }
      : {}),
    ...(accountLink.shopee
      ? { shopee: { useCoin: accountLink.shopee.useCoin, promoId: accountLink.shopee.promoId ?? "" } }
      : {}),
  };
}

interface InquiryResponse {
  reference?: unknown;
  paymentUrl?: unknown;
  vaNumber?: unknown;
  qrString?: unknown;
  statusCode?: unknown;
  statusMessage?: unknown;
}

export function createDuitkuProvider(config: DuitkuConfig): PaymentProvider {
  const clock = config.now ?? (() => Date.now());
  const cacheTtl = config.cacheTtlMs ?? 5 * 60_000;
  const methodCache = new Map<string, { at: number; methods: DuitkuPaymentMethod[] }>();

  return {
    async createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResponse> {
      if (!config.merchantCode || !config.apiKey) {
        throw new PaymentProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "DUITKU_MERCHANT_CODE/DUITKU_API_KEY belum diset.",
        );
      }

      const body: InquiryBody = {
        merchantCode: config.merchantCode,
        paymentAmount: request.amount,
        paymentMethod: request.paymentMethod,
        merchantOrderId: request.merchantOrderId,
        productDetails: request.productDetails,
        // Duitku membatasi nama pada halaman konfirmasi bank maksimal 20 karakter.
        customerVaName: request.customerName.slice(0, 20),
        email: request.email,
        returnUrl: request.returnUrl,
        callbackUrl: request.callbackUrl,
        signature: await createInvoiceSignature(
          config.merchantCode,
          request.merchantOrderId,
          request.amount,
          config.apiKey,
        ),
        ...(request.expiryPeriod !== undefined ? { expiryPeriod: request.expiryPeriod } : {}),
        ...(request.creditCardDetail ? { creditCardDetail: request.creditCardDetail } : {}),
        ...(request.accountLink ? { accountLink: toInquiryAccountLink(request.accountLink) } : {}),
      };

      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl}/webapi/api/merchant/v2/inquiry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new PaymentProviderError("NETWORK", "Tidak bisa menghubungi Duitku.");
      }

      if (!response.ok) {
        throw new PaymentProviderError(`HTTP_${response.status}`, "Duitku menolak request.");
      }

      const payload = (await response.json().catch(() => null)) as InquiryResponse | null;
      if (!payload || typeof payload !== "object") {
        throw new PaymentProviderError("INVALID_RESPONSE", "Respons Duitku bukan JSON.");
      }
      if (payload.statusCode !== "00") {
        throw new PaymentProviderError(
          "REJECTED",
          typeof payload.statusMessage === "string" ? payload.statusMessage : "Transaksi ditolak Duitku.",
        );
      }
      if (typeof payload.paymentUrl !== "string" || payload.paymentUrl.length === 0) {
        throw new PaymentProviderError("INVALID_RESPONSE", "Respons Duitku tanpa paymentUrl.");
      }
      if (typeof payload.reference !== "string" || payload.reference.length === 0) {
        throw new PaymentProviderError("INVALID_RESPONSE", "Respons Duitku tanpa reference.");
      }

      return {
        reference: payload.reference,
        paymentUrl: payload.paymentUrl,
        vaNumber: typeof payload.vaNumber === "string" ? payload.vaNumber : null,
        qrString: typeof payload.qrString === "string" ? payload.qrString : null,
      };
    },

    async getPaymentMethods(amount: number): Promise<DuitkuPaymentMethod[]> {
      if (!config.merchantCode || !config.apiKey) {
        throw new PaymentProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "DUITKU_MERCHANT_CODE/DUITKU_API_KEY belum diset.",
        );
      }

      const cacheKey = String(amount);
      const cached = methodCache.get(cacheKey);
      if (cached && clock() - cached.at < cacheTtl) {
        return cached.methods;
      }

      const datetime = duitkuDatetime(clock());
      let response: Response;
      try {
        response = await config.fetch(
          `${config.baseUrl}/webapi/api/merchant/paymentmethod/getpaymentmethod`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchantcode: config.merchantCode,
              amount,
              datetime,
              signature: await getPaymentMethodsSignature(
                config.merchantCode,
                amount,
                datetime,
                config.apiKey,
              ),
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        throw new PaymentProviderError("NETWORK", "Tidak bisa menghubungi Duitku.");
      }

      if (!response.ok) {
        throw new PaymentProviderError(`HTTP_${response.status}`, "Duitku menolak permintaan channel.");
      }

      const payload = (await response.json().catch(() => null)) as {
        paymentFee?: Array<{
          paymentMethod?: unknown;
          paymentName?: unknown;
          paymentImage?: unknown;
          totalFee?: unknown;
        }>;
        responseCode?: unknown;
      } | null;

      if (!payload || payload.responseCode !== "00" || !Array.isArray(payload.paymentFee)) {
        throw new PaymentProviderError("INVALID_RESPONSE", "Respons metode pembayaran tidak valid.");
      }

      const methods = payload.paymentFee
        .filter(
          (item) =>
            typeof item.paymentMethod === "string" && typeof item.paymentName === "string",
        )
        .map((item) => ({
          code: String(item.paymentMethod),
          name: String(item.paymentName),
          image: typeof item.paymentImage === "string" ? item.paymentImage : "",
          totalFee: typeof item.totalFee === "string" ? item.totalFee : String(item.totalFee ?? "0"),
        }));

      methodCache.set(cacheKey, { at: clock(), methods });
      return methods;
    },

    async getStatus(merchantOrderId: string): Promise<TransactionStatusResult> {
      if (!config.merchantCode || !config.apiKey) {
        throw new PaymentProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "DUITKU_MERCHANT_CODE/DUITKU_API_KEY belum diset.",
        );
      }

      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl}/webapi/api/merchant/transactionStatus`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchantCode: config.merchantCode,
            merchantOrderId,
            signature: await transactionStatusSignature(
              config.merchantCode,
              merchantOrderId,
              config.apiKey,
            ),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new PaymentProviderError("NETWORK", "Tidak bisa menghubungi Duitku.");
      }

      if (!response.ok) {
        throw new PaymentProviderError(`HTTP_${response.status}`, "Duitku menolak cek status.");
      }

      const payload = (await response.json().catch(() => null)) as {
        statusCode?: unknown;
        reference?: unknown;
        amount?: unknown;
      } | null;
      if (!payload || typeof payload.statusCode !== "string") {
        throw new PaymentProviderError("INVALID_RESPONSE", "Respons cek status tidak valid.");
      }

      const amount = payload.amount === undefined ? null : Number(payload.amount);
      return {
        statusCode: payload.statusCode,
        reference: typeof payload.reference === "string" ? payload.reference : null,
        amount: amount !== null && Number.isFinite(amount) ? amount : null,
      };
    },
  };
}
