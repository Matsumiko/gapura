import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  apiGet,
  type Summary,
  type Transaction,
  type WebhookCounts,
  type WebhookLog,
} from "../api";
import {
  ErrorNote,
  PageHeader,
  StatusBadge,
  TableSkeleton,
  formatRupiah,
  formatTime,
} from "../components";

export function SummaryPage() {
  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => apiGet<Summary>("/admin/summary"),
  });
  const recent = useQuery({
    queryKey: ["admin", "dashboard", "recent"],
    queryFn: () => apiGet<{ items: Transaction[]; total: number }>("/admin/transactions?limit=6"),
  });
  const pending = useQuery({
    queryKey: ["admin", "dashboard", "pending"],
    queryFn: () =>
      apiGet<{ items: Transaction[]; total: number }>("/admin/transactions?status=PENDING&limit=1"),
  });
  const failed = useQuery({
    queryKey: ["admin", "dashboard", "failed"],
    queryFn: () => apiGet<{ items: WebhookLog[] }>("/admin/webhooks?status=FAILED&limit=5"),
  });
  const webhookCounts = useQuery({
    queryKey: ["admin", "webhooks", "counts"],
    queryFn: () => apiGet<WebhookCounts>("/admin/webhooks/counts"),
  });

  if (summary.isPending) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Uang masuk, transaksi terbaru, dan antrean webhook." />
        <div className="panel">
          <TableSkeleton rows={4} cols={4} />
        </div>
      </>
    );
  }
  if (summary.isError) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Uang masuk, transaksi terbaru, dan antrean webhook." />
        <div className="panel">
          <ErrorNote error={summary.error} />
        </div>
      </>
    );
  }

  const data = summary.data;
  const maxProjectAmount = Math.max(1, ...data.projects.map((item) => item.todayAmount));

  return (
    <>
      <PageHeader
        title="Dashboard"
        lede="Uang masuk, transaksi terbaru, dan antrean webhook untuk environment ini."
      />

      <section className="kpi-grid" aria-label="Indikator utama">
        <article className="kpi kpi--lead">
          <p className="kpi__label">
            <span className="kpi__live" aria-hidden="true" />
            Pendapatan hari ini
          </p>
          <p className="kpi__value money">{formatRupiah(data.today.amount)}</p>
          <p className="kpi__meta">
            {data.today.count} transaksi PAID
          </p>
        </article>
        <article className="kpi">
          <p className="kpi__label">Bulan ini</p>
          <p className="kpi__value money">{formatRupiah(data.month.amount)}</p>
          <p className="kpi__meta">
            {data.month.count} transaksi PAID
          </p>
        </article>
        <article className="kpi">
          <p className="kpi__label">Menunggu pembayaran</p>
          <p className="kpi__value">{pending.data?.total ?? "-"}</p>
          <p className="kpi__meta">transaksi PENDING</p>
        </article>
        <article className="kpi">
          <p className="kpi__label">Webhook gagal</p>
          <p className="kpi__value">{webhookCounts.data?.failed ?? "-"}</p>
          <p className="kpi__meta">
            menunggu retry
            {webhookCounts.data ? ` · ${webhookCounts.data.dead} dead-letter` : ""}
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Komposisi hari ini</h2>
          <span className="panel-note">nominal PAID per project</span>
        </div>
        {data.projects.length === 0 ? (
          <p className="empty-note">Belum ada project. Tambahkan lewat halaman Project.</p>
        ) : (
          <ul className="bars">
            <li className="bars__head" aria-hidden="true">
              <span>Project</span>
              <span>Porsi hari ini</span>
              <span>Nominal PAID</span>
              <span>Transaksi</span>
            </li>
            {data.projects.map((row) => (
              <li className="bars__row" key={row.projectId}>
                <span className="bars__name">{row.projectName}</span>
                <span className="bars__track" aria-hidden="true">
                  <span
                    className="bars__fill"
                    style={{ width: `${(row.todayAmount / maxProjectAmount) * 100}%` }}
                  />
                </span>
                <span className="bars__value money">{formatRupiah(row.todayAmount)}</span>
                <span className="bars__count">
                  {row.todayCount} transaksi
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel dash-span">
          <div className="panel-head">
            <h2>Transaksi terbaru</h2>
            <Link className="text-link" to="/transactions">
              Lihat semua
            </Link>
          </div>
          {recent.isPending ? <TableSkeleton rows={5} cols={5} /> : null}
          <ErrorNote error={recent.error} />
          {recent.data ? (
            recent.data.items.length === 0 ? (
              <p className="empty-note">Belum ada transaksi.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Project</th>
                      <th scope="col" className="cell-num">Nominal</th>
                      <th scope="col">Status</th>
                      <th scope="col">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.items.map((item) => (
                      <tr key={item.merchantOrderId}>
                        <td data-label="Order">
                          <Link to={`/transactions/${item.merchantOrderId}`} className="table__link">
                            {item.projectOrderId}
                          </Link>
                        </td>
                        <td data-label="Project">{item.projectName}</td>
                        <td className="cell-num" data-label="Nominal">
                          <span className="table__amount money">{formatRupiah(item.amount)}</span>
                        </td>
                        <td data-label="Status">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="cell-time" data-label="Waktu">
                          <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Antrean webhook</h2>
            <Link className="text-link" to="/webhooks">
              Buka antrean
            </Link>
          </div>
          {failed.isPending ? <TableSkeleton rows={4} cols={2} /> : null}
          <ErrorNote error={failed.error ?? webhookCounts.error} />
          {failed.data ? (
            failed.data.items.length === 0 ? (
              <p className="empty-note">Tidak ada webhook menunggu retry.</p>
            ) : (
              <ul className="queue">
                {failed.data.items.map((item) => (
                  <li key={item.id} className="queue__item">
                    <span className="queue__name">{item.merchantOrderId}</span>
                    <span className="queue__attempt">
                      percobaan {item.attempt}
                    </span>
                    <span className="queue__project">{item.projectName}</span>
                    <span className="queue__error" title={item.error ?? undefined}>
                      {item.error ?? "menunggu jadwal"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      </div>
    </>
  );
}
