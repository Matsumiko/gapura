import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, type WebhookLog } from "../api";
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
            <h2 className="visually-hidden">Webhook gagal</h2>
            <label className="field field--inline">
              <span className="field__label">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as "FAILED" | "DEAD")}
              >
                <option value="FAILED">Menunggu retry</option>
                <option value="DEAD">Dead-letter</option>
              </select>
            </label>
          </div>
          {webhooks.data ? (
            <span className="panel-count num">{webhooks.data.items.length} antrean</span>
          ) : null}
        </div>

        <div className="panel-body">
          <ErrorNote error={webhooks.error ?? retry.error} />

          {webhooks.isPending ? <TableSkeleton rows={6} cols={7} /> : null}

          {webhooks.data ? (
            webhooks.data.items.length === 0 ? (
              <p className="empty-note">Tidak ada webhook dengan status ini.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
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
                        <td className="cell-num num" data-label="Percobaan">{webhook.attempt}</td>
                        <td className="cell-num num" data-label="HTTP">{webhook.httpStatus ?? "-"}</td>
                        <td className="wrap" data-label="Error">{webhook.error ?? "-"}</td>
                        <td className="cell-time num" data-label="Jadwal retry">
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
