import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, type WebhookLog } from "../api";
import { ErrorNote, formatTime } from "../components";

export function WebhooksPage() {
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
    <section className="stack">
      <article className="card">
        <h2>Webhook gagal</h2>
        <div className="filters">
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "FAILED" | "DEAD")}
            >
              <option value="FAILED">Menunggu retry</option>
              <option value="DEAD">Dead-letter</option>
            </select>
          </label>
        </div>
        {webhooks.isPending ? <p className="muted">Memuat...</p> : null}
        <ErrorNote error={webhooks.error ?? retry.error} />
        {webhooks.data ? (
          webhooks.data.items.length === 0 ? (
            <p className="muted">Tidak ada webhook dengan status ini.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Project</th>
                    <th>Percobaan</th>
                    <th>HTTP</th>
                    <th>Error</th>
                    <th>Jadwal retry</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.data.items.map((webhook) => (
                    <tr key={webhook.id}>
                      <td>
                        <Link to={`/transactions/${webhook.merchantOrderId}`}>
                          {webhook.merchantOrderId}
                        </Link>
                      </td>
                      <td>{webhook.projectName}</td>
                      <td>{webhook.attempt}</td>
                      <td>{webhook.httpStatus ?? "-"}</td>
                      <td className="wrap">{webhook.error ?? "-"}</td>
                      <td>
                        {webhook.nextAttemptAt ? formatTime(webhook.nextAttemptAt) : "-"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => retry.mutate(webhook)}
                          disabled={retry.isPending}
                        >
                          Kirim ulang
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </article>
    </section>
  );
}
