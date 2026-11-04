import type { Hono } from "hono";
import { jsonError } from "../http";
import { PaymentProviderError } from "../providers/duitku";
import type { PaymentMethodsService } from "../services/payment-methods";
import type { AppEnv } from "../types";

export interface PaymentMethodRouteDeps {
  paymentMethods: PaymentMethodsService;
}

const MIN_AMOUNT = 5_000;
const DEFAULT_AMOUNT = 10_000;
const MAX_AMOUNT = 100_000_000;

export function registerPaymentMethodRoutes(
  app: Hono<AppEnv>,
  deps: PaymentMethodRouteDeps,
): void {
  app.get("/v1/payment-methods", async (c) => {
    const raw = c.req.query("amount") ?? String(DEFAULT_AMOUNT);
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return jsonError(
        c,
        400,
        "INVALID_REQUEST",
        "amount harus integer antara 5000 dan 100000000.",
      );
    }

    try {
      const items = await deps.paymentMethods.list(amount);
      return c.json({ amount, items });
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        if (error.code === "PROVIDER_NOT_CONFIGURED") {
          return jsonError(c, 503, "PROVIDER_NOT_CONFIGURED", "Kredensial Duitku belum diset.");
        }
        return jsonError(c, 502, "PROVIDER_ERROR", "Gagal mengambil channel dari Duitku.");
      }
      throw error;
    }
  });
}
