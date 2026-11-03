import type { Hono } from "hono";
import { createPaymentInputSchema } from "@gapura/shared/payment";
import { jsonError } from "../http";
import { PaymentProviderError } from "../providers/duitku";
import { DuplicateOrderError, toPaymentResponse, type PaymentsService } from "../services/payments";
import type { AppEnv } from "../types";

export interface PaymentRouteDeps {
  payments: PaymentsService;
}

export function registerPaymentRoutes(app: Hono<AppEnv>, deps: PaymentRouteDeps): void {
  app.post("/v1/payments", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return jsonError(c, 400, "INVALID_REQUEST", "Body wajib JSON.");
    }

    const parsed = createPaymentInputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Body tidak valid.");
    }

    try {
      const record = await deps.payments.create(c.get("project"), parsed.data);
      return c.json(toPaymentResponse(record), 201);
    } catch (error) {
      if (error instanceof DuplicateOrderError) {
        return jsonError(c, 409, "DUPLICATE_ORDER", "orderId sudah dipakai project ini.");
      }
      if (error instanceof PaymentProviderError) {
        if (error.code === "PROVIDER_NOT_CONFIGURED") {
          return jsonError(
            c,
            503,
            "PROVIDER_NOT_CONFIGURED",
            "Kredensial Duitku atau PUBLIC_BASE_URL belum diset.",
          );
        }
        return jsonError(c, 502, "PROVIDER_ERROR", "Duitku gagal membuat transaksi.");
      }
      throw error;
    }
  });

  app.get("/v1/payments/:orderId", async (c) => {
    const record = await deps.payments.get(c.get("project").id, c.req.param("orderId"));
    if (!record) {
      return jsonError(c, 404, "NOT_FOUND", "Transaksi tidak ditemukan untuk project ini.");
    }
    return c.json(toPaymentResponse(record));
  });
}
