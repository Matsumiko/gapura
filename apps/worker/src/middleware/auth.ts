import type { MiddlewareHandler } from "hono";
import { jsonError } from "../http";
import type { AppEnv, AuthDeps } from "../types";

export const API_KEY_HEADER = "X-Gapura-Key";

/**
 * Autentikasi project: hash API key dicocokkan ke tabel projects.
 * Key mentah tidak pernah disimpan maupun di-log.
 */
export function apiKeyAuth(deps: AuthDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const apiKey = c.req.header(API_KEY_HEADER);
    if (!apiKey) {
      return jsonError(c, 401, "UNAUTHORIZED", `Header ${API_KEY_HEADER} wajib diisi.`);
    }

    const project = await deps.projects.findByApiKeyHash(await deps.sha256Hex(apiKey));
    if (!project) {
      return jsonError(c, 401, "UNAUTHORIZED", "API key tidak dikenal.");
    }
    if (!project.isActive) {
      return jsonError(c, 403, "PROJECT_INACTIVE", "Project nonaktif; transaksi baru ditolak.");
    }

    c.set("project", project);
    await next();
  };
}
