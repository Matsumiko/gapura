import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  apiGet,
  apiPost,
  apiPut,
  type MerchantSettingsView,
  type SettingsOverview,
  type SettingsTestResult,
} from "../api";
import { ErrorNote, PageHeader, formatTime } from "../components";

function EnvCard({
  view,
  canWrite,
  onChanged,
}: {
  view: MerchantSettingsView;
  canWrite: boolean;
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

  const test = useMutation({
    mutationFn: () => apiPost<SettingsTestResult>(`/admin/settings/${view.environment}/test`),
    onSuccess: (result) => setTestResult(result),
  });

  const label = view.environment === "sandbox" ? "Sandbox" : "Production";

  return (
    <article className={`panel env-card env-card--${view.environment}`}>
      <div className="env-card__head">
        <div>
          <h2>{label}</h2>
          <p className="env-host num">
            {view.environment === "sandbox"
              ? "sandbox.duitku.com"
              : "passport.duitku.com (transaksi nyata)"}
          </p>
        </div>
        {view.apiKeySet ? <span className="badge good">api key tersimpan</span> : null}
      </div>

      <form
        className="form form--env"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="field">
          <span className="field__label">Merchant code</span>
          <input
            name={`merchant-${view.environment}`}
            value={merchantCode}
            onChange={(event) => setMerchantCode(event.target.value)}
            maxLength={50}
            disabled={!canWrite}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">
            API key {view.apiKeySet ? "(kosongkan bila tidak diganti)" : ""}
          </span>
          <input
            name={`apikey-${view.environment}`}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
            disabled={!canWrite}
            placeholder={view.apiKeySet ? "•••••••• (tidak berubah)" : "API key Duitku"}
          />
        </label>
        <div className="field--wide actions">
          <button
            type="submit"
            className="button"
            disabled={!canWrite || save.isPending}
          >
            {save.isPending ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => test.mutate()}
            disabled={!canWrite || test.isPending || !view.apiKeySet}
          >
            {test.isPending ? "Menguji…" : "Uji kredensial"}
          </button>
        </div>
      </form>

      <ErrorNote error={save.error ?? test.error} />
      {testResult ? (
        <p className="test-result">
          <span>{testResult.count}</span> channel aktif, contoh:{" "}
          {testResult.sample.map((item) => `${item.code} (${item.name})`).join(", ") || "-"}
        </p>
      ) : null}
      <p className="env-updated">
        {view.updatedAt
          ? `Terakhir diubah ${formatTime(view.updatedAt)} oleh ${view.updatedBy ?? "-"}`
          : "Belum ada kredensial tersimpan."}
      </p>
    </article>
  );
}

export function SettingsPage({ canWrite }: { canWrite: boolean }) {
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
    return (
      <>
        <PageHeader title="Pengaturan" lede="Kredensial Duitku untuk sandbox dan production." />
        <div className="panel">
          <p className="muted">Memuat pengaturan…</p>
        </div>
      </>
    );
  }
  if (settings.isError) {
    return (
      <>
        <PageHeader title="Pengaturan" lede="Kredensial Duitku untuk sandbox dan production." />
        <div className="panel">
          <ErrorNote error={settings.error} />
        </div>
      </>
    );
  }

  const data = settings.data;
  return (
    <>
      <PageHeader title="Pengaturan" lede="Kredensial Duitku untuk sandbox dan production." />

      <section className="panel settings-system">
        <div className="panel-head">
          <h2>Kredensial Duitku</h2>
        </div>
        <p className="settings-note">
          Environment dipilih dari sidebar. Kredensial di halaman ini hanya berlaku untuk environment
          tersebut dan disimpan terenkripsi AES-GCM di database environment itu. Callback
          memverifikasi dengan kredensial yang sama.
        </p>
        {canWrite ? null : <p className="muted">Role viewer hanya bisa melihat pengaturan.</p>}

        <dl className="details details--system">
          <div>
            <dt>Callback URL</dt>
            <dd>
              <code>{data.callbackUrl}</code>
            </dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{data.items[0]?.environment ?? "-"}</dd>
          </div>
          <div>
            <dt>Master key</dt>
            <dd>
              {data.credentialsKeyConfigured
                ? "CREDENTIALS_KEY terpasang"
                : "CREDENTIALS_KEY belum diset, penyimpanan dinonaktifkan"}
            </dd>
          </div>
        </dl>

        {!data.credentialsKeyConfigured ? (
          <p className="error">
            Set secret Worker <code>CREDENTIALS_KEY</code> (32 byte base64) sebelum menyimpan
            kredensial dari panel. Transaksi masih memakai fallback secret environmen bila ada.
          </p>
        ) : null}
      </section>

      <div className="settings-grid">
        {data.items.map((view) => (
          <EnvCard key={view.environment} view={view} canWrite={canWrite} onChanged={refresh} />
        ))}
      </div>
    </>
  );
}
