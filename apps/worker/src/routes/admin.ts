import type { Hono } from "hono";
import { adminTransactionFilterSchema, createProjectInputSchema } from "@gapura/shared/admin";
import { jsonError } from "../http";
import { AdminConflictError, type AdminService } from "../services/admin";
import type { AppEnv } from "../types";

export interface AdminRouteDeps {
  admin: AdminService;
}

function isActiveBody(value: unknown): value is { isActive: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "isActive" in value &&
    typeof value.isActive === "boolean"
  );
}

function clampLimit(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return Math.min(value, 100);
}

export function registerAdminRoutes(app: Hono<AppEnv>, deps: AdminRouteDeps): void {
  app.get("/admin/summary", async (c) => c.json(await deps.admin.summary()));

  app.get("/admin/projects", async (c) => c.json({ items: await deps.admin.listProjects() }));

  app.post("/admin/projects", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = createProjectInputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Body project tidak valid.");
    }
    try {
      const created = await deps.admin.createProject(parsed.data, c.get("adminEmail"));
      return c.json(created, 201);
    } catch (error) {
      if (error instanceof AdminConflictError) {
        return jsonError(c, 409, "CONFLICT", error.message);
      }
      throw error;
    }
  });

  app.patch("/admin/projects/:id", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    if (!isActiveBody(raw)) {
      return jsonError(c, 400, "INVALID_REQUEST", "Body wajib berisi isActive boolean.");
    }
    const project = await deps.admin.setProjectActive(
      c.req.param("id"),
      raw.isActive,
      c.get("adminEmail"),
    );
    if (!project) {
      return jsonError(c, 404, "NOT_FOUND", "Project tidak ditemukan.");
    }
    return c.json({ project });
  });

  app.post("/admin/projects/:id/rotate-key", async (c) => {
    const apiKey = await deps.admin.rotateApiKey(c.req.param("id"), c.get("adminEmail"));
    if (!apiKey) {
      return jsonError(c, 404, "NOT_FOUND", "Project tidak ditemukan.");
    }
    return c.json({ apiKey });
  });

  app.post("/admin/projects/:id/rotate-secret", async (c) => {
    const webhookSecret = await deps.admin.rotateWebhookSecret(
      c.req.param("id"),
      c.get("adminEmail"),
    );
    if (!webhookSecret) {
      return jsonError(c, 404, "NOT_FOUND", "Project tidak ditemukan.");
    }
    return c.json({ webhookSecret });
  });

  app.get("/admin/transactions", async (c) => {
    const query = c.req.query();
    const parsed = adminTransactionFilterSchema.safeParse({
      projectId: query.projectId,
      status: query.status,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Filter transaksi tidak valid.");
    }
    return c.json(await deps.admin.listTransactions(parsed.data));
  });

  app.get("/admin/transactions/:merchantOrderId", async (c) => {
    const detail = await deps.admin.getTransaction(c.req.param("merchantOrderId"));
    if (!detail) {
      return jsonError(c, 404, "NOT_FOUND", "Transaksi tidak ditemukan.");
    }
    return c.json(detail);
  });

  app.get("/admin/webhooks", async (c) => {
    const status = c.req.query("status");
    if (status && status !== "FAILED" && status !== "DEAD") {
      return jsonError(c, 400, "INVALID_REQUEST", "Status webhook wajib FAILED atau DEAD.");
    }
    const webhookStatus = status === "FAILED" || status === "DEAD" ? status : null;
    const limit = clampLimit(c.req.query("limit"), 50);
    return c.json({ items: await deps.admin.listWebhooks(webhookStatus, limit) });
  });

  app.post("/admin/webhooks/:id/retry", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return jsonError(c, 400, "INVALID_REQUEST", "Id webhook tidak valid.");
    }
    const changed = await deps.admin.retryWebhook(id, c.get("adminEmail"));
    if (!changed) {
      return jsonError(c, 404, "NOT_FOUND", "Webhook tidak ditemukan atau sudah terkirim.");
    }
    return c.json({ ok: true });
  });
}
