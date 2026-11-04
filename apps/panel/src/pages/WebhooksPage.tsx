import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, type WebhookCounts, type WebhookLog } from "../api";
import {
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

export function WebhooksPage({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"FAILED" | "DEAD">("FAILED");

  const webhooks = useQuery({
    queryKey: ["admin", "webhooks", status],
    queryFn: () => apiGet<{ items: WebhookLog[] }>(`/admin/webhooks?status=${status}`),
  });
  const counts = useQuery({
    queryKey: ["admin", "webhooks", "counts"],
    queryFn: () => apiGet<WebhookCounts>("/admin/webhooks/counts"),
  });
  const queueCount = counts.data
    ? status === "FAILED"
      ? counts.data.failed
      : counts.data.dead
    : null;

  const retry = useMutation({
    mutationFn: (webhook: WebhookLog) => apiPost(`/admin/webhooks/${webhook.id}/retry`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
  });

  return (
    <>
      <PageHeader
        title="Webhook gagal"
        lede="Pengiriman yang menunggu retry atau sudah masuk dead-letter."
      />

      <section className="panel panel--flush">
        <div className="queue-bar">
          <div>
            <h2>Antrean</h2>
            <label className="field field--inline">
              <span className="field__label">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as "FAILED" | "DEAD")}
              >
                <option value="FAILED">
                  Menunggu retry{counts.data ? ` (${counts.data.failed})` : ""}
                </option>
                <option value="DEAD">
                  Dead-letter{counts.data ? ` (${counts.data.dead})` : ""}
                </option>
              </select>
            </label>
          </div>
          {queueCount !== null ? (
            <span className="panel-count">
              {queueCount} antrean · total {counts.data?.total ?? 0} log
            </span>
          ) : null}
        </div>

        <div className="panel-body">
          <ErrorNote error={webhooks.error ?? counts.error ?? retry.error} />

          {webhooks.isPending ? <TableSkeleton rows={6} cols={7} /> : null}

          {webhooks.data ? (
            webhooks.data.items.length === 0 ? (
              <p className="empty-note">Tidak ada webhook dengan status ini.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table webhooks-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Project</th>
                      <th scope="col">Percobaan</th>
                      <th scope="col">HTTP</th>
                      <th scope="col">Error</th>
                      <th scope="col">Jadwal retry</th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.data.items.map((webhook) => (
                      <tr key={webhook.id}>
                        <td data-label="Order">
                          <Link
                            to={`/transactions/${webhook.merchantOrderId}`}
                            className="table__link num"
                          >
                            {webhook.merchantOrderId}
                          </Link>
                        </td>
                        <td data-label="Project">{webhook.projectName}</td>
                        <td className="cell-num" data-label="Percobaan">{webhook.attempt}</td>
                        <td className="cell-num num" data-label="HTTP">{webhook.httpStatus ?? "-"}</td>
                        <td className="wrap" data-label="Error" title={webhook.error ?? undefined}>
                          {webhook.error ?? "-"}
                        </td>
                        <td className="cell-time" data-label="Jadwal retry">
                          {webhook.nextAttemptAt ? formatTime(webhook.nextAttemptAt) : "-"}
                        </td>
                        <td data-label="Aksi">
                          {canWrite ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => retry.mutate(webhook)}
                              disabled={retry.isPending}
                            >
                              Kirim ulang
                            </button>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </section>
    </>
  );
}
