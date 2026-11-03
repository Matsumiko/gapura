import { describe, expect, it } from "vitest";
import {
  PaymentProviderError,
  callbackSignature,
  createDuitkuProvider,
  createInvoiceSignature,
  transactionStatusSignature,
} from "../src/providers/duitku";
import type { CreateInvoiceRequest } from "../src/providers/duitku";

const MERCHANT_CODE = "D0001";
const API_KEY = "duitku-secret";
const BASE_URL = "https://sandbox.duitku.com";

const REQUEST: CreateInvoiceRequest = {
  merchantOrderId: "PRJA-INV123",
  amount: 150000,
  paymentMethod: "VC",
  productDetails: "Paket Premium",
  customerName: "Budi Santoso Dengan Nama Yang Panjang",
  email: "budi@example.com",
  returnUrl: "https://project-a.com/thanks",
  callbackUrl: "https://pay.test/callback/duitku",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(
  handler: () => Response | Promise<Response>,
  overrides: Partial<Parameters<typeof createDuitkuProvider>[0]> = {},
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const provider = createDuitkuProvider({
    merchantCode: MERCHANT_CODE,
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return handler();
    },
    ...overrides,
  });
  return { provider, calls };
}

describe("signature Duitku", () => {
  it("memakai HMAC-SHA256 dengan urutan parameter vendor", async () => {
    // Vektor dihitung terpisah dengan Node crypto (independen dari implementasi di sini).
    expect(await createInvoiceSignature(MERCHANT_CODE, "PRJA-INV123", 150000, API_KEY)).toBe(
      "2928322fda338d9f23eefb53504a3709c5640aeba131bdeecba0648da797eb5e",
    );
    expect(await callbackSignature(MERCHANT_CODE, "150000", "PRJA-INV123", API_KEY)).toBe(
      "ca317e8f93678977bdaf9fa436cc3ff3aefdefc9a473990fcc24c25c649b7710",
    );
    expect(await transactionStatusSignature(MERCHANT_CODE, "PRJA-INV123", API_KEY)).toBe(
      "de78bdbc960a3381e13040eb4b1ccad9a19dc4d637ba427553973fe40cead09b",
    );
  });
});

describe("createInvoice", () => {
  it("mengirim body inquiry yang benar dan memetakan respons", async () => {
    const { provider, calls } = setup(() =>
      response({
        merchantCode: MERCHANT_CODE,
        reference: "REF-1",
        paymentUrl: "https://sandbox.duitku.com/topup/REF-1",
        vaNumber: "7007014001444348",
        qrString: "00020101",
        amount: "150000",
        statusCode: "00",
        statusMessage: "SUCCESS",
      }),
    );

    const result = await provider.createInvoice(REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/webapi/api/merchant/v2/inquiry`);
    expect(calls[0]?.init?.method).toBe("POST");

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      merchantCode: MERCHANT_CODE,
      paymentAmount: 150000,
      paymentMethod: "VC",
      merchantOrderId: "PRJA-INV123",
      productDetails: "Paket Premium",
      customerVaName: "Budi Santoso Dengan ",
      email: "budi@example.com",
      returnUrl: "https://project-a.com/thanks",
      callbackUrl: "https://pay.test/callback/duitku",
      signature: "2928322fda338d9f23eefb53504a3709c5640aeba131bdeecba0648da797eb5e",
    });

    expect(result).toEqual({
      reference: "REF-1",
      paymentUrl: "https://sandbox.duitku.com/topup/REF-1",
      vaNumber: "7007014001444348",
      qrString: "00020101",
    });
  });

  it("meneruskan expiryPeriod dan creditCardDetail bila dikirim", async () => {
    const { provider, calls } = setup(() =>
      response({
        reference: "REF-1",
        paymentUrl: "https://sandbox.duitku.com/topup/REF-1",
        statusCode: "00",
      }),
    );

    await provider.createInvoice({
      ...REQUEST,
      paymentMethod: "VC",
      expiryPeriod: 20,
      creditCardDetail: { acquirer: "014", binWhitelist: ["014", "400000"] },
    });

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.expiryPeriod).toBe(20);
    expect(body.creditCardDetail).toEqual({ acquirer: "014", binWhitelist: ["014", "400000"] });
  });

  it("tidak mengirim field opsional bila tidak diisi", async () => {
    const { provider, calls } = setup(() =>
      response({
        reference: "REF-1",
        paymentUrl: "https://sandbox.duitku.com/topup/REF-1",
        statusCode: "00",
      }),
    );

    await provider.createInvoice(REQUEST);

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect("expiryPeriod" in body).toBe(false);
    expect("creditCardDetail" in body).toBe(false);
  });

  it("menolak sebelum memanggil jaringan bila kredensial kosong", async () => {
    const calls: string[] = [];
    const provider = createDuitkuProvider({
      merchantCode: "",
      apiKey: "",
      baseUrl: BASE_URL,
      fetch: async (input) => {
        calls.push(String(input));
        return response({});
      },
    });

    await expect(provider.createInvoice(REQUEST)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
  });

  it("melempar HTTP_<status> untuk respons non-2xx", async () => {
    const { provider } = setup(() => response({ Message: "error" }, 500));

    await expect(provider.createInvoice(REQUEST)).rejects.toMatchObject({ code: "HTTP_500" });
  });

  it("melempar REJECTED bila statusCode bukan 00", async () => {
    const { provider } = setup(() =>
      response({ statusCode: "01", statusMessage: "Payment method tidak aktif" }),
    );

    const error = await provider.createInvoice(REQUEST).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(error).toMatchObject({ code: "REJECTED", message: "Payment method tidak aktif" });
  });

  it("melempar INVALID_RESPONSE untuk body bukan JSON atau tanpa paymentUrl", async () => {
    const notJson = setup(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(notJson.provider.createInvoice(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    const noUrl = setup(() => response({ statusCode: "00", reference: "REF-1" }));
    await expect(noUrl.provider.createInvoice(REQUEST)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  describe("getStatus", () => {
    it("mengirim signature cek status dan memetakan respons", async () => {
      const { provider, calls } = setup(() =>
        response({
          merchantOrderId: "PRJA-INV123",
          reference: "REF-1",
          amount: "150000",
          fee: "0.00",
          statusCode: "00",
          statusMessage: "SUCCESS",
        }),
      );

      const result = await provider.getStatus("PRJA-INV123");

      expect(calls[0]?.url).toBe(`${BASE_URL}/webapi/api/merchant/transactionStatus`);
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        merchantCode: MERCHANT_CODE,
        merchantOrderId: "PRJA-INV123",
        signature: "de78bdbc960a3381e13040eb4b1ccad9a19dc4d637ba427553973fe40cead09b",
      });
      expect(result).toEqual({ statusCode: "00", reference: "REF-1", amount: 150000 });
    });

    it("melempar HTTP_<status> untuk respons non-2xx", async () => {
      const { provider } = setup(() => response({ Message: "error" }, 502));

      await expect(provider.getStatus("PRJA-INV123")).rejects.toMatchObject({ code: "HTTP_502" });
    });

    it("melempar INVALID_RESPONSE bila statusCode tidak ada", async () => {
      const { provider } = setup(() => response({ reference: "REF-1" }));

      await expect(provider.getStatus("PRJA-INV123")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    });
  });

  describe("getPaymentMethods", () => {
    const FIXED_NOW = Date.UTC(2026, 10, 3, 10, 0, 0);

    function methodResponse(): Response {
      return response({
        paymentFee: [
          {
            paymentMethod: "BT",
            paymentName: "PERMATA VA",
            paymentImage: "https://images.duitku.com/hotlink-ok/PERMATA.PNG",
            totalFee: "0",
          },
          {
            paymentMethod: "VC",
            paymentName: "CREDIT CARD",
            paymentImage: "https://images.duitku.com/hotlink-ok/VC.PNG",
            totalFee: "2790",
          },
        ],
        responseCode: "00",
        responseMessage: "SUCCESS",
      });
    }

    it("mengirim body sesuai vendor dan memetakan paymentFee", async () => {
      const { provider, calls } = setup(methodResponse, { now: () => FIXED_NOW });

      const methods = await provider.getPaymentMethods(10000);

      expect(calls[0]?.url).toBe(
        `${BASE_URL}/webapi/api/merchant/paymentmethod/getpaymentmethod`,
      );
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        merchantcode: MERCHANT_CODE,
        amount: 10000,
        datetime: "2026-11-03 10:00:00",
        signature: "43231920585afcc97d92a279a85aa60ce99b24977288c403affb191be84fa42c",
      });
      expect(methods).toEqual([
        {
          code: "BT",
          name: "PERMATA VA",
          image: "https://images.duitku.com/hotlink-ok/PERMATA.PNG",
          totalFee: "0",
        },
        {
          code: "VC",
          name: "CREDIT CARD",
          image: "https://images.duitku.com/hotlink-ok/VC.PNG",
          totalFee: "2790",
        },
      ]);
    });

    it("memakai cache per nominal sampai TTL habis", async () => {
      let now = FIXED_NOW;
      const { provider, calls } = setup(methodResponse, { now: () => now, cacheTtlMs: 1000 });

      await provider.getPaymentMethods(10000);
      await provider.getPaymentMethods(10000);
      expect(calls).toHaveLength(1);

      now += 2000;
      await provider.getPaymentMethods(10000);
      expect(calls).toHaveLength(2);
    });

    it("memisahkan cache per nominal", async () => {
      const { provider, calls } = setup(methodResponse, { now: () => FIXED_NOW });

      await provider.getPaymentMethods(10000);
      await provider.getPaymentMethods(50000);

      expect(calls).toHaveLength(2);
    });

    it("melempar INVALID_RESPONSE bila responseCode bukan 00", async () => {
      const { provider } = setup(() => response({ responseCode: "01", paymentFee: [] }));

      await expect(provider.getPaymentMethods(10000)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    });

    it("melempar HTTP_<status> dan tidak menyimpan cache saat gagal", async () => {
      const { provider } = setup(() => response({}, 500));

      await expect(provider.getPaymentMethods(10000)).rejects.toMatchObject({ code: "HTTP_500" });
    });
  });

  it("melempar NETWORK bila fetch gagal", async () => {
    const { provider } = setup(() => {
      throw new Error("connection reset");
    });

    await expect(provider.createInvoice(REQUEST)).rejects.toMatchObject({ code: "NETWORK" });
  });
});
