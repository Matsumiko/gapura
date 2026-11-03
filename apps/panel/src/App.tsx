import { useQuery } from "@tanstack/react-query";
import { apiBaseUrl, fetchHealth } from "./api";

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  let statusText: string;
  if (health.isPending) {
    statusText = "memeriksa...";
  } else if (health.isError) {
    statusText = health.error.message;
  } else {
    statusText = `${health.data.service} · ${health.data.environment}`;
  }

  return (
    <main className="shell">
      <header>
        <h1>Gapura Admin</h1>
        <p className="muted">Panel manajemen project dan transaksi.</p>
      </header>

      <section className="card" aria-live="polite">
        <h2>Status API</h2>
        <dl>
          <dt>Endpoint</dt>
          <dd>{apiBaseUrl}</dd>
          <dt>Status</dt>
          <dd className={health.isError ? "bad" : "good"}>{statusText}</dd>
        </dl>
        <p className="muted">
          Halaman project, transaksi, dan webhook gagal dibangun pada Fase 6 setelah API stabil.
        </p>
      </section>
    </main>
  );
}
