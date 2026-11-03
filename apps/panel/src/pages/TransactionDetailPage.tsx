import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost, type TransactionDetail, type WebhookLog } from "../api";
import { ErrorNote, formatRupiah, formatTime } from "../components";

export function TransactionDetailPage() {
  const { merchantOrderId } = useParams();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin", "transaction", merchantOrderId],
    queryFn: () => apiGet<TransactionDetail>(`/admin/transactions/${merchantOrderId}`),
    enabled: Boolean(merchantOrderId),
  });

  const retry = useMutation({
    mutationFn: (webhook: WebhookLog) => apiPost(`/admin/webhooks/${webhook.id}/retry`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "transaction", merchantOrderId],
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
  });

  if (detail.isPending) {
    return <p className="muted">Memuat transaksi...</p>;
  }
  if (detail.isError) {
    return <ErrorNote error={detail.error} />;
  }

  const { transaction, webhooks } = detail.data;
  return (
    <section className="stack">
      <div>
        <Link to="/transactions" className="muted">
          ← Kembali ke transaksi
        </Link>
      </div>

      <article className="card">
        <h2>{transaction.projectOrderId}</h2>
        <dl className="details">
          <dt>Merchant order</dt>
          <dd>
            <code>{transaction.merchantOrderId}</code>
          </dd>
          <dt>Project</dt>
          <dd>{transaction.projectName}</dd>
          <dt>Nominal</dt>
          <dd>{formatRupiah(transaction.amount)}</dd>
          <dt>Metode</dt>
          <dd>{transaction.paymentMethod ?? "-"}</dd>
          <dt>Status</dt>
          <dd>
            <span className={`badge status-${transaction.status.toLowerCase()}`}>
              {transaction.status}
            </span>
          </dd>
          <dt>Reference Duitku</dt>
          <dd>{transaction.reference ?? "-"}</dd>
          <dt>Payment URL</dt>
          <dd className="wrap">
            {transaction.paymentUrl ? (
              <a href={transaction.paymentUrl} target="_blank" rel="noreferrer">
                {transaction.paymentUrl}
              </a>
            ) : (
              "-"
            )}
          </dd>
          <dt>Dibuat</dt>
          <dd>{formatTime(transaction.createdAt)}</dd>
          <dt>Diperbarui</dt>
          <dd>{formatTime(transaction.updatedAt)}</dd>
        </dl>
      </article>

      <article className="card">
        <h2>Riwayat webhook</h2>
        <ErrorNote error={retry.error} />
        {webhooks.length === 0 ? (
          <p className="muted">Belum ada percobaan pengiriman.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Percobaan</th>
                  <th>Status</th>
                  <th>HTTP</th>
                  <th>Error</th>
                  <th>Jadwal retry</th>
                  <th>Waktu</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((webhook) => (
                  <tr key={webhook.id}>
                    <td>{webhook.attempt}</td>
                    <td>
                      <span className={`badge status-${webhook.status.toLowerCase()}`}>
                        {webhook.status}
                      </span>
                    </td>
                    <td>{webhook.httpStatus ?? "-"}</td>
                    <td className="wrap">{webhook.error ?? "-"}</td>
                    <td>{webhook.nextAttemptAt ? formatTime(webhook.nextAttemptAt) : "-"}</td>
                    <td>{formatTime(webhook.createdAt)}</td>
                    <td>
                      {webhook.status === "FAILED" || webhook.status === "DEAD" ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => retry.mutate(webhook)}
                          disabled={retry.isPending}
                        >
                          Kirim ulang
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
