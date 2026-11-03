import { Hono } from "hono";
import { cors } from "hono/cors";
import { jsonError } from "./http";
import { apiKeyAuth } from "./middleware/auth";
import { requireAdminAuth, requireAdminOrigin } from "./middleware/admin-auth";
import { registerAdminRoutes } from "./routes/admin";
import { registerCallbackRoute } from "./routes/callback";
import { registerPaymentMethodRoutes } from "./routes/payment-methods";
import { registerPaymentRoutes } from "./routes/payments";
import { registerSettingsRoutes } from "./routes/settings";
import { registerAuthRoutes } from "./routes/auth";
import type { CallbackService } from "./services/callbacks";
import type { PaymentsService } from "./services/payments";
import type { WebhookForwarder } from "./services/webhooks";
import type { AdminService } from "./services/admin";
import type { PaymentMethodsService } from "./services/payment-methods";
import type { SettingsService } from "./services/settings";
import type { AdminAuthService } from "./services/admin-auth";
import type { AdminSessionService } from "./services/admin-sessions";

import type { AppEnv, AuthDeps } from "./types";

export interface AppDeps extends AuthDeps {
  panelOrigin?: string;
  payments: PaymentsService;
  callbacks: CallbackService;
  forwarder: WebhookForwarder;
  admin: AdminService;
  paymentMethods: PaymentMethodsService;
  settings: SettingsService;
  adminAuth?: AdminAuthService;
  adminSessions?: AdminSessionService;
  now?: () => Date;
}

export function buildApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const panelOrigins = (deps.panelOrigin ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  app.use(
    "*",
    cors({
      origin: (origin) => (panelOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["Content-Type", "X-Gapura-Key", "X-CSRF-Token"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
  registerPaymentMethodRoutes(app, deps);
  registerPaymentRoutes(app, deps);
  registerCallbackRoute(app, deps);
  app.use("/admin/*", requireAdminOrigin({ panelOrigins }));
  if (deps.adminAuth && deps.adminSessions) {
    registerAuthRoutes(app, { auth: deps.adminAuth, sessions: deps.adminSessions });
  }
  app.use(
    "/admin/*",
    requireAdminAuth({ sessions: deps.adminSessions, now: deps.now }),
  );
  registerAdminRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan."));

  app.onError((error, c) => {
    console.error("unhandled_error", error instanceof Error ? error.message : "unknown");
    return jsonError(c, 500, "INTERNAL", "Terjadi kesalahan internal.");
  });

  return app;
}
