import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { secureEqual } from "@gapura/shared/hmac";
import { jsonError } from "../http";
import { SESSION_COOKIE } from "../routes/auth";
import type { AdminSessionService } from "../services/admin-sessions";
import type { AppEnv } from "../types";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_HEADER = "X-CSRF-Token";

export interface AdminAuthMiddlewareDeps {
  adminToken?: string;
  sessions?: AdminSessionService;
  panelOrigins?: string[];
}

function bearerMatches(header: string | undefined, token: string | undefined): boolean {
  if (!header || !token) {
    return false;
  }
  const [scheme, value] = header.split(" ");
  return (
    scheme?.toLowerCase() === "bearer" && typeof value === "string" && secureEqual(value, token)
  );
}

/**
 * Auth admin berlapis: sesi opaque dari cookie + CSRF untuk write,
 * dengan fallback ADMIN_TOKEN hanya selama migrasi (fase 2).
 */
export function requireAdminAuth(deps: AdminAuthMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const isWrite = WRITE_METHODS.has(method);
    const origin = c.req.header("Origin");
    if (isWrite && origin && deps.panelOrigins && !deps.panelOrigins.includes(origin)) {
      return jsonError(c, 403, "ORIGIN_DENIED", "Origin tidak diizinkan.");
    }

    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie && deps.sessions) {
      const found = await deps.sessions.authenticate(cookie);
      if (found) {
        if (isWrite) {
          const csrf = c.req.header(CSRF_HEADER);
          if (!csrf || !(await deps.sessions.verifyCsrf(found.session, csrf))) {
            return jsonError(c, 403, "CSRF_INVALID", "CSRF token tidak valid.");
          }
        }
        c.set("adminActor", found.admin.email);
        c.set("adminSessionId", found.session.id);
        await next();
        return;
      }
    }

    // Fallback sementara sampai panel pindah ke sesi.
    if (bearerMatches(c.req.header("Authorization"), deps.adminToken)) {
      c.set("adminActor", "admin-token");
      await next();
      return;
    }

    if (!deps.adminToken && !deps.sessions) {
      return jsonError(c, 503, "ADMIN_NOT_CONFIGURED", "Auth admin belum dikonfigurasi.");
    }
    return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Sesi admin tidak valid.");
  };
}
