import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  accountEmailInputSchema,
  accountPasswordInputSchema,
  accountRecoveryCodesInputSchema,
} from "@gapura/shared/admin";
import { jsonError } from "../http";
import { createAdminAccountRepository } from "../repositories/admin-account";
import { createAdminRecoveryRepository } from "../repositories/admin-recovery";
import { createAdminUserRepository } from "../repositories/admin-users";
import { createAdminAccountService, AdminAccountError } from "../services/admin-account";
import { createAdminRecoveryService } from "../services/admin-recovery";
import type { AppEnv } from "../types";
import { requireFreshReauth } from "./admin-guards";

export interface AdminAccountRouteDeps {
  now?: () => Date;
}

const ERROR_STATUS: Record<AdminAccountError["code"], ContentfulStatusCode> = {
  invalid_credentials: 400,
  conflict: 409,
  not_configured: 503,
  not_found: 404,
};

function serviceFor(c: Context<AppEnv>, deps: AdminAccountRouteDeps) {
  const now = deps.now ?? (() => new Date());
  return createAdminAccountService({
    users: createAdminUserRepository(c.env.DB_AUTH),
    repo: createAdminAccountRepository(c.env.DB_AUTH),
    recovery: createAdminRecoveryService({
      repo: createAdminRecoveryRepository(c.env.DB_AUTH),
      now,
    }),
    now,
  });
}

function accountError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof AdminAccountError) {
    return jsonError(c, ERROR_STATUS[error.code], error.code.toUpperCase(), error.message);
  }
  throw error;
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function registerAdminAccountRoutes(
  app: Hono<AppEnv>,
  deps: AdminAccountRouteDeps = {},
): void {
  app.get("/admin/account", async (c) => {
    try {
      return c.json({ account: await serviceFor(c, deps).overview(c.get("adminId")) });
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.post("/admin/account/email", async (c) => {
    const denied = requireFreshReauth(c, deps.now);
    if (denied) {
      return denied;
    }
    const parsed = accountEmailInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Email dan password wajib valid.");
    }
    try {
      const result = await serviceFor(c, deps).changeEmail({
        adminId: c.get("adminId"),
        sessionId: c.get("adminSessionId"),
        ...parsed.data,
      });
      return c.json({ account: result, revokedSessions: result.revokedSessions });
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.post("/admin/account/password", async (c) => {
    const denied = requireFreshReauth(c, deps.now);
    if (denied) {
      return denied;
    }
    const parsed = accountPasswordInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        "INVALID_REQUEST",
        "Password saat ini dan password baru minimal 12 karakter wajib valid.",
      );
    }
    try {
      const result = await serviceFor(c, deps).changePassword({
        adminId: c.get("adminId"),
        sessionId: c.get("adminSessionId"),
        ...parsed.data,
      });
      return c.json(result);
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.post("/admin/account/recovery-codes", async (c) => {
    const denied = requireFreshReauth(c, deps.now);
    if (denied) {
      return denied;
    }
    const parsed = accountRecoveryCodesInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Password wajib valid.");
    }
    try {
      const result = await serviceFor(c, deps).regenerateRecoveryCodes({
        adminId: c.get("adminId"),
        ...parsed.data,
      });
      return c.json(result);
    } catch (error) {
      return accountError(c, error);
    }
  });
}
