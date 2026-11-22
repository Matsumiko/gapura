import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiEnvironment, type Project } from "../api";
import { ErrorNote, PageHeader } from "../components";

interface PlaygroundMethod {
  code: string;
  name: string;
  system: string | null;
  totalFee: string;
}

interface PlaygroundResult {
  merchantOrderId: string;
  projectOrderId: string;
  amount: number;
  status: string;
  paymentMethod: string | null;
  paymentUrl: string | null;
  reference: string | null;
  vaNumber: string | null;
  qrString: string | null;
  replayed: boolean;
}

function newOrderId(): string {
  return `PLAY-${Date.now().toString(36).toUpperCase()}`;
}

export function PlaygroundPage({
  environment,
  canWrite,
}: {
  environment: ApiEnvironment;
  canWrite: boolean;
}) {
  const [projectId, setProjectId] = useState("");
  const [orderId, setOrderId] = useState(newOrderId);
  const [amount, setAmount] = useState("5000");
  const [productDetails, setProductDetails] = useState("Uji invoice sandbox");
  const [customerName, setCustomerName] = useState("Playground Gapura");
  const [email, setEmail] = useState("playground@example.com");
  const [paymentMethod, setPaymentMethod] = useState("SP");
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  const projects = useQuery({
    queryKey: ["admin", "projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/admin/projects"),
  });

  const amountNumber = Number(amount);
  const methods = useQuery({
    queryKey: ["admin", "playground", "methods", amountNumber, environment],
    queryFn: () =>
      apiGet<{ items: PlaygroundMethod[] }>(
        `/admin/playground/payment-methods?amount=${encodeURIComponent(String(amountNumber))}`,
      ),
    enabled: environment === "sandbox" && Number.isInteger(amountNumber) && amountNumber >= 5000,
  });

  useEffect(() => {
    if (!projectId && projects.data?.items[0]) {
      setProjectId(projects.data.items[0].id);
    }
  }, [projectId, projects.data]);

  useEffect(() => {
    if (methods.data && !methods.data.items.some((item) => item.code === paymentMethod)) {
      setPaymentMethod(methods.data.items[0]?.code ?? "");
    }
  }, [methods.data, paymentMethod]);

  const create = useMutation({
    mutationFn: () =>
      apiPost<PlaygroundResult>("/admin/playground/payments", {
        projectId,
        orderId,
        amount: amountNumber,
        productDetails,
        customerName,
        email,
        paymentMethod,
        returnUrl: `${window.location.origin}/playground`,
      }),
    onSuccess: (created) => setResult(created),
  });

  function reset() {
    setOrderId(newOrderId());
    setResult(null);
    create.reset();
  }

  const sandbox = environment === "sandbox";

  return (
    <>
      <PageHeader
        title="Playground"
        lede="Buat invoice sandbox dari panel untuk menguji kanal pembayaran dan callback."
      />

      {!sandbox ? (
        <section className="panel viewer-note">
          <p className="muted">
            Playground hanya tersedia di environment <strong>sandbox</strong>. Pindah environment
            lewat pilihan di sidebar.
          </p>
        </section>
      ) : null}

      {sandbox && !canWrite ? (
        <section className="panel viewer-note">
          <p className="muted">Role viewer tidak bisa membuat invoice uji.</p>
        </section>
      ) : null}

      {sandbox && canWrite ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Invoice uji</h2>
            <span className="badge role">sandbox</span>
          </div>
          <p className="settings-note">
            Request ini membuat transaksi Duitku sandbox memakai kredensial sandbox yang aktif.
            Tidak ada uang nyata yang dipindahkan.
          </p>

          <form
            className="form form--narrow"
            onSubmit={(event) => {
              event.preventDefault();
              setResult(null);
              create.mutate();
            }}
          >
            <label className="field">
              <span className="field__label">Project</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
              >
                {projects.data?.items.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.prefix})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Order ID</span>
              <input
                value={orderId}
                onChange={(event) => setOrderId(event.target.value)}
                maxLength={60}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Nominal (Rp)</span>
              <input
                type="number"
                min={5000}
                step={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Metode</span>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                required
              >
                {methods.data?.items.map((method) => (
                  <option key={method.code} value={method.code}>
                    {method.code} — {method.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span className="field__label">Deskripsi</span>
              <input
                value={productDetails}
                onChange={(event) => setProductDetails(event.target.value)}
                maxLength={255}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Nama pelanggan</span>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                maxLength={255}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={50}
                required
              />
            </label>
            <div className="wide actions">
              <button type="submit" className="button button--primary" disabled={create.isPending}>
                {create.isPending ? "Membuat invoice…" : "Buat invoice"}
              </button>
              <button type="button" className="ghost" onClick={reset} disabled={create.isPending}>
                Reset
              </button>
            </div>
          </form>

          <ErrorNote error={create.error ?? methods.error ?? projects.error} />
        </section>
      ) : null}

      {result ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Invoice dibuat</h2>
            <span className="badge good">{result.status}</span>
          </div>
          <dl className="details details--system">
            <div>
              <dt>Merchant order</dt>
              <dd><code>{result.merchantOrderId}</code></dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd><code>{result.reference ?? "-"}</code></dd>
            </div>
            <div>
              <dt>Nominal</dt>
              <dd>Rp {result.amount.toLocaleString("id-ID")}</dd>
            </div>
            <div>
              <dt>Metode</dt>
              <dd>{result.paymentMethod ?? "-"}</dd>
            </div>
            <div>
              <dt>VA</dt>
              <dd><code>{result.vaNumber ?? "-"}</code></dd>
            </div>
          </dl>
          {result.paymentUrl ? (
            <p>
              <a className="button button--primary" href={result.paymentUrl} target="_blank" rel="noreferrer">
                Buka halaman pembayaran
              </a>
            </p>
          ) : null}
          {result.qrString ? (
            <label className="field wide">
              <span className="field__label">QR string</span>
              <textarea readOnly value={result.qrString} rows={3} />
            </label>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
