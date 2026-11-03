import { Hono } from "hono";
import { cors } from "hono/cors";
import { jsonError } from "./http";
import { apiKeyAuth } from "./middleware/auth";
import { requireAdminAccess } from "./middleware/admin-auth";
import { registerAdminRoutes } from "./routes/admin";
import { registerCallbackRoute } from "./routes/callback";
import { registerPaymentRoutes } from "./routes/payments";
import type { CallbackService } from "./services/callbacks";
import type { PaymentsService } from "./services/payments";
import type { WebhookForwarder } from "./services/webhooks";
import type { AdminService } from "./services/admin";
import type { AccessVerifier } from "./providers/access";
import type { AppEnv, AuthDeps } from "./types";

export interface AppDeps extends AuthDeps {
  panelOrigin?: string;
  payments: PaymentsService;
  callbacks: CallbackService;
  forwarder: WebhookForwarder;
  admin: AdminService;
  adminVerifier: AccessVerifier | null;
}

export function buildApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => (deps.panelOrigin && origin === deps.panelOrigin ? origin : null),
      credentials: true,
      allowHeaders: ["Content-Type", "X-Gapura-Key", "Cf-Access-Jwt-Assertion"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "gapura",
      environment: c.env.ENVIRONMENT ?? "unknown",
    }),
  );

  app.use("/v1/*", apiKeyAuth(deps));
  app.get("/v1/me", (c) => {
    const project = c.get("project");
    return c.json({
      project: { id: project.id, name: project.name, prefix: project.prefix },
    });
  });
  registerPaymentRoutes(app, deps);
  registerCallbackRoute(app, deps);
  app.use("/admin/*", requireAdminAccess(deps.adminVerifier));
  registerAdminRoutes(app, deps);

  app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan."));

  app.onError((error, c) => {
    console.error("unhandled_error", error instanceof Error ? error.message : "unknown");
    return jsonError(c, 500, "INTERNAL", "Terjadi kesalahan internal.");
  });

  return app;
}
