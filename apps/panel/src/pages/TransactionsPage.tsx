import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { paymentChannelByCode } from "@gapura/shared/payment-methods";
import {
  apiGet,
  type PaymentStatus,
  type Project,
  type Transaction,
} from "../api";
import {
  EmptyRow,
  ErrorNote,
  PageHeader,
  StatusBadge,
  TableSkeleton,
  formatRupiah,
  formatStatus,
  formatTime,
} from "../components";

const PAGE_SIZE = 25;
const STATUSES: Array<PaymentStatus | ""> = ["", "PENDING", "PAID", "FAILED", "EXPIRED"];

export function TransactionsPage() {
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [offset, setOffset] = useState(0);

  const projects = useQuery({
    queryKey: ["admin", "projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/admin/projects"),
  });

  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const transactions = useQuery({
    queryKey: ["admin", "transactions", projectId, status, offset],
    queryFn: () =>
      apiGet<{ items: Transaction[]; total: number }>(`/admin/transactions?${params}`),
  });

  return (
    <>
      <PageHeader
        title="Transaksi"
        lede="Pembayaran yang tercatat di environment ini, dengan filter project dan status."
      />

      <section className="panel panel--flush">
        <div className="filter-bar">
          <h2 className="filter-bar__title">Filter</h2>
          <div className="filter-fields">
            <label className="field field--inline">
              <span className="field__label">Project</span>
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Semua</option>
                {projects.data?.items.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span className="field__label">Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as PaymentStatus | "");
                  setOffset(0);
                }}
              >
                {STATUSES.map((value) => (
                  <option key={value || "all"} value={value}>
                    {value ? formatStatus(value) : "Semua"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="panel-head panel-head--table">
          <h2 className="visually-hidden">Transaksi</h2>
          {transactions.data ? (
            <span className="panel-count num">{transactions.data.total} transaksi</span>
          ) : null}
        </div>

        <div className="panel-body">
          <ErrorNote error={transactions.error} />
          {transactions.isPending ? <TableSkeleton rows={8} cols={6} /> : null}

          {transactions.data ? (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Project</th>
                      <th scope="col" className="cell-num">Nominal</th>
                      <th scope="col">Metode</th>
                      <th scope="col">Status</th>
                      <th scope="col">Dibuat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.data.items.map((item) => (
                      <tr key={item.merchantOrderId}>
                        <td data-label="Order">
                          <Link
                            to={`/transactions/${item.merchantOrderId}`}
                            className="table__link num"
                          >
                            {item.projectOrderId}
                          </Link>
                        </td>
                        <td data-label="Project">{item.projectName}</td>
                        <td className="cell-num num" data-label="Nominal">{formatRupiah(item.amount)}</td>
                        <td data-label="Metode" title={item.paymentMethod ?? ""}>
                          {item.paymentMethod
                            ? (paymentChannelByCode(item.paymentMethod)?.name ?? item.paymentMethod)
                            : "-"}
                        </td>
                        <td data-label="Status">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="cell-time num" data-label="Dibuat">{formatTime(item.createdAt)}</td>
                      </tr>
                    ))}
                    {transactions.data.items.length === 0 ? (
                      <EmptyRow colSpan={6}>
                        Tidak ada transaksi untuk filter ini.
                      </EmptyRow>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button
                  type="button"
                  className="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Sebelumnya
                </button>
                <span className="muted num">
                  {offset + 1}-{Math.min(offset + PAGE_SIZE, transactions.data.total)} dari{" "}
                  {transactions.data.total}
                </span>
                <button
                  type="button"
                  className="ghost"
                  disabled={offset + PAGE_SIZE >= transactions.data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Berikutnya
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
