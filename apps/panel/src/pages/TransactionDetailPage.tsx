import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { paymentChannelByCode } from "@gapura/shared/payment-methods";
import { apiGet, apiPost, type TransactionDetail, type WebhookLog } from "../api";
import {
  ErrorNote,
  PageHeader,
  StatusBadge,
  TableSkeleton,
  formatRupiah,
  formatTime,
} from "../components";

export function TransactionDetailPage({ canWrite }: { canWrite: boolean }) {
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
    return (
      <>
        <PageHeader title="Transaksi" lede="Memuat rincian pembayaran dan riwayat webhook." />
        <div className="panel">
          <TableSkeleton rows={4} cols={2} />
        </div>
      </>
    );
  }
  if (detail.isError) {
    return (
      <>
        <PageHeader title="Transaksi" lede="Rincian pembayaran dan riwayat pengiriman webhook." />
        <div className="panel">
          <ErrorNote error={detail.error} />
        </div>
      </>
    );
  }

  const { transaction, webhooks } = detail.data;
  const method = transaction.paymentMethod
    ? `${transaction.paymentMethod} (${
        paymentChannelByCode(transaction.paymentMethod)?.name ?? "channel tidak dikenal"
      })`
    : "-";

  return (
    <>
      <Link to="/transactions" className="back-link">
        Kembali ke transaksi
      </Link>

      <PageHeader
        title={`Transaksi ${transaction.projectOrderId}`}
        lede="Rincian pembayaran dan riwayat pengiriman webhook."
      />

      <section className="panel record">
        <div className="record__summary">
          <div>
            <span className="field__label">Nominal</span>
            <p className="reading reading--record money">{formatRupiah(transaction.amount)}</p>
          </div>
          <div className="record__status">
            <span className="field__label">Status</span>
            <StatusBadge status={transaction.status} />
          </div>
        </div>

        <dl className="details">
          <div>
            <dt>Merchant order</dt>
            <dd>
              <code>{transaction.merchantOrderId}</code>
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{transaction.projectName}</dd>
          </div>
          <div>
            <dt>Metode</dt>
            <dd>{method}</dd>
          </div>
          <div>
            <dt>Reference Duitku</dt>
            <dd className="num">{transaction.reference ?? "-"}</dd>
          </div>
          <div>
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
          </div>
          <div>
            <dt>Dibuat</dt>
            <dd>{formatTime(transaction.createdAt)}</dd>
          </div>
          <div>
            <dt>Diperbarui</dt>
            <dd>{formatTime(transaction.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Riwayat webhook</h2>
          {webhooks.length > 0 ? (
            <span className="panel-count">{webhooks.length} percobaan</span>
          ) : null}
        </div>
        <ErrorNote error={retry.error} />
        {webhooks.length === 0 ? (
          <p className="empty-note">Belum ada percobaan pengiriman.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table detail-webhooks-table">
              <thead>
                <tr>
                  <th scope="col">Percobaan</th>
                  <th scope="col">Status</th>
                  <th scope="col">HTTP</th>
                  <th scope="col">Error</th>
                  <th scope="col">Jadwal retry</th>
                  <th scope="col">Waktu</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((webhook) => (
                  <tr key={webhook.id}>
                    <td className="cell-num" data-label="Percobaan">{webhook.attempt}</td>
                    <td data-label="Status">
                      <StatusBadge status={webhook.status} />
                    </td>
                    <td className="cell-num num" data-label="HTTP">{webhook.httpStatus ?? "-"}</td>
                    <td className="wrap" data-label="Error" title={webhook.error ?? undefined}>
                      {webhook.error ?? "-"}
                    </td>
                    <td className="cell-time" data-label="Jadwal retry">
                      {webhook.nextAttemptAt ? formatTime(webhook.nextAttemptAt) : "-"}
                    </td>
                    <td className="cell-time" data-label="Waktu">{formatTime(webhook.createdAt)}</td>
                    <td data-label="Aksi">
                      {!canWrite ? (
                        <span className="muted">-</span>
                      ) : webhook.status === "FAILED" || webhook.status === "DEAD" ? (
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
      </section>
    </>
  );
}
