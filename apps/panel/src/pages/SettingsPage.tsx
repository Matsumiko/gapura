import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  apiGet,
  apiPost,
  apiPut,
  type MerchantEnvironment,
  type MerchantSettingsView,
  type SettingsOverview,
  type SettingsTestResult,
} from "../api";
import { ErrorNote, formatTime } from "../components";

function EnvCard({
  view,
  onChanged,
}: {
  view: MerchantSettingsView;
  onChanged: () => Promise<void>;
}) {
  const [merchantCode, setMerchantCode] = useState(view.merchantCode);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<SettingsTestResult | null>(null);

  useEffect(() => {
    setMerchantCode(view.merchantCode);
  }, [view.merchantCode]);

  const save = useMutation({
    mutationFn: () =>
      apiPut<MerchantSettingsView>(`/admin/settings/${view.environment}`, {
        merchantCode,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: async () => {
      setApiKey("");
      setTestResult(null);
      await onChanged();
    },
  });

  const activate = useMutation({
    mutationFn: () => apiPost<MerchantSettingsView>(`/admin/settings/${view.environment}/activate`),
    onSuccess: async () => {
      await onChanged();
    },
  });

  const test = useMutation({
    mutationFn: () => apiPost<SettingsTestResult>(`/admin/settings/${view.environment}/test`),
    onSuccess: (result) => setTestResult(result),
  });

  const label = view.environment === "sandbox" ? "Sandbox" : "Production";

  return (
    <article className="card">
      <div className="section-head">
        <h2>
          {label}{" "}
          {view.isActive ? <span className="badge good">aktif</span> : null}
          {view.apiKeySet ? <span className="badge">api key tersimpan</span> : null}
        </h2>
        <span className="muted">
          {view.environment === "sandbox"
            ? "sandbox.duitku.com"
            : "passport.duitku.com (transaksi nyata)"}
        </span>
      </div>

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Merchant code
          <input
            name={`merchant-${view.environment}`}
            value={merchantCode}
            onChange={(event) => setMerchantCode(event.target.value)}
            maxLength={50}
            required
          />
        </label>
        <label>
          API key {view.apiKeySet ? "(kosongkan bila tidak diganti)" : ""}
          <input
            name={`apikey-${view.environment}`}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
            placeholder={view.apiKeySet ? "•••••••• (tidak berubah)" : "API key Duitku"}
          />
        </label>
        <div className="wide actions">
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? "Menyimpan..." : "Simpan"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => activate.mutate()}
            disabled={activate.isPending || !view.apiKeySet || view.isActive}
          >
            {view.isActive ? "Sedang aktif" : "Aktifkan"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => test.mutate()}
            disabled={test.isPending || !view.apiKeySet}
          >
            {test.isPending ? "Menguji..." : "Uji kredensial"}
          </button>
        </div>
      </form>

      <ErrorNote error={save.error ?? activate.error ?? test.error} />
      {testResult ? (
        <p className="muted">
          {testResult.count} channel aktif · contoh:{" "}
          {testResult.sample.map((item) => `${item.code} (${item.name})`).join(", ") || "-"}
        </p>
      ) : null}
      <p className="muted">
        {view.updatedAt
          ? `Terakhir diubah ${formatTime(view.updatedAt)} oleh ${view.updatedBy ?? "-"}`
          : "Belum ada kredensial tersimpan."}
      </p>
    </article>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiGet<SettingsOverview>("/admin/settings"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  }

  if (settings.isPending) {
    return <p className="muted">Memuat pengaturan...</p>;
  }
  if (settings.isError) {
    return <ErrorNote error={settings.error} />;
  }

  const data = settings.data;
  return (
    <section className="stack">
      <article className="card">
        <h2>Kredensial Duitku</h2>
        <p className="muted">
          Kredensial disimpan terenkripsi AES-GCM di D1. Hanya environment aktif yang dipakai untuk
          transaksi baru; callback memverifikasi dengan kredensial yang sama.
        </p>
        <dl className="details">
          <dt>Callback URL</dt>
          <dd>
            <code>{data.callbackUrl}</code>
          </dd>
          <dt>Environment aktif</dt>
          <dd>{data.activeEnvironment ?? "belum ada"}</dd>
          <dt>Master key</dt>
          <dd>
            {data.credentialsKeyConfigured
              ? "CREDENTIALS_KEY terpasang"
              : "CREDENTIALS_KEY belum diset — penyimpanan dinonaktifkan"}
          </dd>
        </dl>
        {!data.credentialsKeyConfigured ? (
          <p className="error">
            Set secret Worker <code>CREDENTIALS_KEY</code> (32 byte base64) sebelum menyimpan
            kredensial dari panel. Transaksi masih memakai fallback secret environmen bila ada.
          </p>
        ) : null}
        <p className="muted">
          Production sebaiknya memakai deployment dan D1 terpisah. Mengaktifkan production di sini
          membuat transaksi baru memakai kredensial produksi pada D1 yang sama.
        </p>
      </article>

      {data.items.map((view) => (
        <EnvCard key={view.environment} view={view} onChanged={refresh} />
      ))}
    </section>
  );
}
