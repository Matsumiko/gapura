import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { recoveryLoginInputSchema } from "@gapura/shared/admin";
import { jsonError } from "../http";
import { createAdminManagementRepository } from "../repositories/admin-management";
import { createAdminRecoveryRepository } from "../repositories/admin-recovery";
import { createAdminUserRepository } from "../repositories/admin-users";
import { createAdminRecoveryService } from "../services/admin-recovery";
import {
  createRecoveryLoginService,
  RecoveryLoginError,
} from "../services/admin-recovery-login";
import type { AdminSessionService } from "../services/admin-sessions";
import type { AppEnv } from "../types";
import { SESSION_COOKIE } from "./auth";

const COOKIE_MAX_AGE = 60 * 60 * 24;

export interface RecoveryLoginRouteDeps {
  sessions: AdminSessionService;
  now?: () => Date;
}

export function registerRecoveryLoginRoute(
  app: Hono<AppEnv>,
  deps: RecoveryLoginRouteDeps,
): void {
  const now = deps.now ?? (() => new Date());

  app.post("/admin/auth/recovery-login", async (c) => {
    const parsed = recoveryLoginInputSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "email, password, dan recoveryCode wajib.");
    }

    const db = c.env.DB_AUTH;
    const users = createAdminUserRepository(db);
    const service = createRecoveryLoginService({
      users,
      recovery: createAdminRecoveryService({
        repo: createAdminRecoveryRepository(db),
        now,
      }),
      sessions: deps.sessions,
      now,
      insertAudit: (entry) => createAdminManagementRepository(db).insertAudit(entry),
    });

    try {
      const result = await service.login({
        ...parsed.data,
        ip: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("User-Agent") ?? null,
      });
      setCookie(c, SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
      return c.json({
        admin: result.admin,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      if (error instanceof RecoveryLoginError) {
        return jsonError(
          c,
          error.code === "rate_limited" ? 429 : 401,
          error.code.toUpperCase(),
          error.message,
        );
      }
      throw error;
    }
  });
}
