import { hmacSha256Hex } from "@gapura/shared/hmac";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DuitkuConfig {
  merchantCode: string;
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
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
}

export interface CreateInvoiceResponse {
  reference: string;
  paymentUrl: string;
  vaNumber: string | null;
  qrString: string | null;
}

export interface PaymentProvider {
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
  };
}
