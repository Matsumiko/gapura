import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** Default: 120 request per menit per project. Bisa dioverride lewat env Worker. */
export const DEFAULT_PROJECT_RATE_LIMIT = 120;
export const DEFAULT_PROJECT_RATE_WINDOW_SECONDS = 60;

interface RateLimitStore {
  increment(projectId: string, windowStart: number): Promise<number>;
  prune(projectId: string, beforeWindow: number): Promise<void>;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createD1RateLimitStore(db: D1Database): RateLimitStore {
  return {
    async increment(projectId, windowStart): Promise<number> {
      const row = await db
        .prepare(
          `INSERT INTO project_rate_limits (project_id, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT (project_id, window_start) DO UPDATE SET count = count + 1
           RETURNING count`,
        )
        .bind(projectId, windowStart)
        .first<{ count: number }>();
      if (row) {
        return Number(row.count) || 1;
      }
      const persisted = await db
        .prepare(
          "SELECT count FROM project_rate_limits WHERE project_id = ? AND window_start = ?",
        )
        .bind(projectId, windowStart)
        .first<{ count: number }>();
      return Number(persisted?.count) || 1;
    },

    async prune(projectId, beforeWindow): Promise<void> {
      await db
        .prepare("DELETE FROM project_rate_limits WHERE project_id = ? AND window_start < ?")
        .bind(projectId, beforeWindow)
        .run();
    },
  };
}

/**
 * Route /v1/* dilayani sub-app per environment. Path asli masih memuat prefix mount,
 * jadi /production memakai DB_PRODUCTION dan sisanya DB_SANDBOX.
 */
export function resolveDataDatabase(c: Context<AppEnv>): D1Database | null {
  const path = c.req.path;
  const db =
    path === "/production" || path.startsWith("/production/")
      ? c.env.DB_PRODUCTION
      : c.env.DB_SANDBOX;
  return db && typeof db.prepare === "function" ? db : null;
}

export interface ProjectRateLimitOptions {
  resolveDb: (c: Context<AppEnv>) => D1Database | null;
  now?: () => Date;
  limit?: number;
  windowSeconds?: number;
}

export function projectRateLimit(
  options: ProjectRateLimitOptions,
): MiddlewareHandler<AppEnv> {
  const now = options.now ?? (() => new Date());

  return async (c, next) => {
    const project = c.get("project");
    let db: D1Database | null = null;
    try {
      db = options.resolveDb(c);
    } catch (error) {
      console.error(
        "rate_limit_db_unavailable",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (!project || !db) {
      await next();
      return;
    }

    const limit = positiveInt(c.env.RATE_LIMIT_MAX, options.limit ?? DEFAULT_PROJECT_RATE_LIMIT);
    const windowSeconds = positiveInt(
      c.env.RATE_LIMIT_WINDOW_SECONDS,
      options.windowSeconds ?? DEFAULT_PROJECT_RATE_WINDOW_SECONDS,
    );
    const nowMs = now().getTime();
    const windowStart = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
    const resetAtMs = (windowStart + windowSeconds) * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

    try {
      const store = createD1RateLimitStore(db);
      const count = await store.increment(project.id, windowStart);
      if (count === 1) {
        await store.prune(project.id, windowStart);
      }

      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
      c.header("X-RateLimit-Reset", String(windowStart + windowSeconds));

      if (count > limit) {
        c.header("Retry-After", String(retryAfterSeconds));
        return c.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Batas request project terlampaui. Coba lagi setelah window berikutnya.",
            },
            retryAfterSeconds,
            resetAt: new Date(resetAtMs).toISOString(),
          },
          429,
        );
      }
    } catch (error) {
      // Rate limit tidak boleh menjatuhkan pembayaran bila D1 sedang bermasalah.
      console.error(
        "rate_limit_failed_open",
        error instanceof Error ? error.message : "unknown",
      );
    }

    await next();
  };
}
