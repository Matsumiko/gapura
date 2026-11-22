import type { Hono } from "hono";
import { createPaymentInputSchema } from "@gapura/shared/payment";
import { jsonError } from "../http";
import {
  DuplicateOrderError,
  OrderInProgressError,
  PaymentValidationError,
  toPaymentResponse,
  type PaymentsService,
} from "../services/payments";
import { PaymentProviderError } from "../providers/duitku";
import type { AdminService } from "../services/admin";
import type { PaymentMethodsService } from "../services/payment-methods";
import type { AppEnv, MerchantEnvironment } from "../types";

export interface AdminPlaygroundRouteDeps {
  environment?: MerchantEnvironment;
  payments: PaymentsService;
  paymentMethods: PaymentMethodsService;
  admin: AdminService;
}

const MIN_AMOUNT = 5_000;
const MAX_AMOUNT = 100_000_000;

export function registerAdminPlaygroundRoutes(
  app: Hono<AppEnv>,
  deps: AdminPlaygroundRouteDeps,
): void {
  function sandboxOnly(c: Parameters<typeof jsonError>[0]) {
    if (deps.environment !== "sandbox") {
      return jsonError(c, 404, "PLAYGROUND_UNAVAILABLE", "Playground hanya tersedia di sandbox.");
    }
    return null;
  }

  app.get("/admin/playground/payment-methods", async (c) => {
    const denied = sandboxOnly(c);
    if (denied) {
      return denied;
    }
    const amount = Number(c.req.query("amount") ?? MIN_AMOUNT);
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return jsonError(
        c,
        400,
        "INVALID_REQUEST",
        `amount harus integer antara ${MIN_AMOUNT} dan ${MAX_AMOUNT}.`,
      );
    }
    try {
      return c.json({ amount, items: await deps.paymentMethods.list(amount) });
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        return jsonError(c, 502, "PROVIDER_ERROR", "Gagal mengambil channel dari Duitku.");
      }
      throw error;
    }
  });

  app.post("/admin/playground/payments", async (c) => {
    const denied = sandboxOnly(c);
    if (denied) {
      return denied;
    }
    const raw: unknown = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return jsonError(c, 400, "INVALID_REQUEST", "Body wajib JSON.");
    }
    const { projectId, ...paymentBody } = raw as Record<string, unknown>;
    if (typeof projectId !== "string" || projectId.length === 0) {
      return jsonError(c, 400, "INVALID_REQUEST", "projectId wajib.");
    }
    const parsed = createPaymentInputSchema.safeParse(paymentBody);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Data invoice tidak valid.");
    }

    const projects = await deps.admin.listProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return jsonError(c, 404, "NOT_FOUND", "Project tidak ditemukan.");
    }
    if (!project.isActive) {
      return jsonError(c, 409, "PROJECT_INACTIVE", "Project sedang nonaktif.");
    }

    try {
      const result = await deps.payments.create(project, parsed.data);
      return c.json(
        { ...toPaymentResponse(result.record), replayed: result.replayed },
        result.replayed ? 200 : 201,
      );
    } catch (error) {
      if (error instanceof PaymentValidationError) {
        return jsonError(c, 400, "INVALID_REQUEST", error.message);
      }
      if (error instanceof DuplicateOrderError) {
        return jsonError(c, 409, "DUPLICATE_ORDER", error.message);
      }
      if (error instanceof OrderInProgressError) {
        c.header("Retry-After", "2");
        return jsonError(c, 409, "ORDER_IN_PROGRESS", error.message);
      }
      if (error instanceof PaymentProviderError) {
        return jsonError(c, 502, "PROVIDER_ERROR", "Duitku gagal membuat transaksi.");
      }
      throw error;
    }
  });
}
