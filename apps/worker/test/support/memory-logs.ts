import type { DueWebhookAttempt, WebhookLogEntry, WebhookLogRepository } from "../../src/types";

export interface StoredAttempt extends WebhookLogEntry {
  id: number;
}

export interface MemoryWebhookLogs {
  repo: WebhookLogRepository;
  entries: StoredAttempt[];
}

export function createMemoryWebhookLogs(): MemoryWebhookLogs {
  const entries: StoredAttempt[] = [];
  let nextId = 1;

  const repo: WebhookLogRepository = {
    async insertAttempt(entry: WebhookLogEntry): Promise<void> {
      entries.push({ ...entry, id: nextId });
      nextId += 1;
    },

    async findDue(nowIso: string, limit: number): Promise<DueWebhookAttempt[]> {
      return entries
        .filter(
          (entry) =>
            entry.status === "FAILED" &&
            entry.nextAttemptAt !== null &&
            entry.nextAttemptAt <= nowIso,
        )
        .sort((left, right) => String(left.nextAttemptAt).localeCompare(String(right.nextAttemptAt)))
        .slice(0, limit)
        .map((entry) => ({
          id: entry.id,
          merchantOrderId: entry.merchantOrderId,
          attempt: entry.attempt,
          nextAttemptAt: String(entry.nextAttemptAt),
        }));
    },

    async claim(id, expectedNextAttemptAt, leaseUntil): Promise<boolean> {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.nextAttemptAt !== expectedNextAttemptAt) {
        return false;
      }
      entry.nextAttemptAt = leaseUntil;
      return true;
    },

    async clearSchedule(id): Promise<void> {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) {
        entry.nextAttemptAt = null;
      }
    },

    async pruneTerminalBefore(cutoffIso): Promise<number> {
      const before = entries.length;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (
          entry &&
          (entry.status === "DELIVERED" || entry.status === "DEAD") &&
          entry.createdAt < cutoffIso
        ) {
          entries.splice(index, 1);
        }
      }
      return before - entries.length;
    },

    async markDead(id): Promise<void> {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) {
        entry.status = "DEAD";
        entry.nextAttemptAt = null;
      }
    },
  };

  return { repo, entries };
}
