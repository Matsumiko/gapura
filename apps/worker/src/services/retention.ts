import type { WebhookLogRepository } from "../types";

export interface RetentionDeps {
  logs: WebhookLogRepository;
  now: () => Date;
  retentionMs?: number;
}

export interface Retention {
  run(): Promise<number>;
}

/** Riwayat forward disimpan 30 hari; retry yang masih terjadwal tidak pernah dipangkas. */
export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function createRetention(deps: RetentionDeps): Retention {
  return {
    async run(): Promise<number> {
      const cutoff = new Date(
        deps.now().getTime() - (deps.retentionMs ?? DEFAULT_RETENTION_MS),
      ).toISOString();
      return deps.logs.pruneTerminalBefore(cutoff);
    },
  };
}
