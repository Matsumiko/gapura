import type { MiddlewareHandler } from "hono";
import { secureEqual } from "@gapura/shared/hmac";
import { jsonError } from "../http";
import type { AppEnv } from "../types";

/**
 * Admin tanpa Zero Trust: Bearer token statis dari secret Worker.
 * Fail closed bila ADMIN_TOKEN belum diset. Token dibandingkan waktu-konstan.
 */
export function requireAdminToken(token: string | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!token) {
      return jsonError(
        c,
        503,
        "ADMIN_NOT_CONFIGURED",
        "ADMIN_TOKEN belum diset; endpoint admin dinonaktifkan.",
      );
    }

    const header = c.req.header("Authorization") ?? "";
    const [scheme, value] = header.split(" ");
    if (!scheme || scheme.toLowerCase() !== "bearer" || !value) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Token admin tidak ditemukan.");
    }
    if (!secureEqual(value, token)) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Token admin tidak valid.");
    }

    c.set("adminActor", "admin-token");
    await next();
  };
}
