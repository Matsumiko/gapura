import type { Context, Hono } from "hono";
import { jsonError } from "../http";
import { createAdminSessionManagementRepository } from "../repositories/admin-session-management";
import {
  createAdminSessionManagementService,
  SessionManagementError,
  type AdminSessionView,
} from "../services/admin-session-management";
import type { AppEnv } from "../types";
import { requireFreshReauth } from "./admin-guards";

export interface AdminSessionRouteDeps {
  now?: () => Date;
}

function serviceFor(c: Context<AppEnv>, deps: AdminSessionRouteDeps) {
  const now = deps.now ?? (() => new Date());
  const repo = createAdminSessionManagementRepository(c.env.DB_AUTH);
  return {
    repo,
    service: createAdminSessionManagementService({ repo, now }),
  };
}

function sessionError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof SessionManagementError) {
    return jsonError(
      c,
      error.code === "forbidden" ? 403 : 404,
      error.code.toUpperCase(),
      error.message,
    );
  }
  throw error;
}

export function registerAdminSessionRoutes(
  app: Hono<AppEnv>,
  deps: AdminSessionRouteDeps,
): void {
  const now = deps.now ?? (() => new Date());

  app.get("/admin/sessions", async (c) => {
    const { repo, service } = serviceFor(c, deps);
    const currentSessionId = c.get("adminSessionId");
    const current = await repo.find(currentSessionId);
    if (!current) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Sesi admin tidak valid.");
    }
    const scope = c.req.query("scope") === "all" ? "all" : "own";
    try {
      const items: AdminSessionView[] = await service.list({
        actorId: current.adminId,
        role: c.get("adminRole"),
        currentSessionId,
        scope,
      });
      return c.json({ items });
    } catch (error) {
      return sessionError(c, error);
    }
  });

  app.post("/admin/sessions/revoke-others", async (c) => {
    const denied = requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    const { repo } = serviceFor(c, deps);
    const current = await repo.find(c.get("adminSessionId"));
    if (!current) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Sesi admin tidak valid.");
    }
    const revoked = await repo.revokeOthers(current.adminId, current.id);
    return c.json({ revoked });
  });

  app.post("/admin/sessions/:id/revoke", async (c) => {
    const denied = requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    const { repo, service } = serviceFor(c, deps);
    const current = await repo.find(c.get("adminSessionId"));
    if (!current) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Sesi admin tidak valid.");
    }
    try {
      const revoked = await service.revoke({
        sessionId: c.req.param("id"),
        actorId: current.adminId,
        role: c.get("adminRole"),
      });
      if (!revoked) {
        return jsonError(c, 404, "NOT_FOUND", "Sesi tidak ditemukan.");
      }
      return c.json({ ok: true });
    } catch (error) {
      return sessionError(c, error);
    }
  });
}
