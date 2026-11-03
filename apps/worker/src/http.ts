import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ErrorBody {
  error: { code: string; message: string };
}

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  const body: ErrorBody = { error: { code, message } };
  return c.json(body, status);
}
