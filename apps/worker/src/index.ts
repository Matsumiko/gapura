import { sha256Hex } from "@gapura/shared/crypto";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { createProjectsRepository } from "./repositories/projects";
import type { AppEnv, Env } from "./types";

const apps = new WeakMap<Env, Hono<AppEnv>>();

function appFor(env: Env) {
  let app = apps.get(env);
  if (!app) {
    app = buildApp({
      projects: createProjectsRepository(env.DB),
      sha256Hex,
      panelOrigin: env.PANEL_ORIGIN,
    });
    apps.set(env, app);
  }
  return app;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return appFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
