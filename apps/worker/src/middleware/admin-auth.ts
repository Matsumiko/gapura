import type { AccessVerifier } from "../providers/access";
import { extractAccessToken } from "../providers/access";
import { jsonError } from "../http";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

export function requireAdminAccess(verifier: AccessVerifier | null): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!verifier) {
      return jsonError(
        c,
        503,
        "ADMIN_NOT_CONFIGURED",
        "ACCESS_TEAM_DOMAIN/ACCESS_AUD belum diset; endpoint admin dinonaktifkan.",
      );
    }

    const token = extractAccessToken(c.req.raw.headers);
    if (!token) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "JWT Cloudflare Access tidak ditemukan.");
    }

    try {
      const identity = await verifier.verify(token);
      c.set("adminEmail", identity.email);
    } catch {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "JWT Cloudflare Access tidak valid.");
    }

    await next();
  };
}
