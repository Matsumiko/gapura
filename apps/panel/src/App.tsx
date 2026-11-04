import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  configureApiAuth,
  fetchAuthStatus,
  getApiEnvironment,
  logoutAdmin,
  reauthenticate,
  setApiEnvironment,
  type AdminIdentity,
  type ApiEnvironment,
  type AuthStatus,
} from "./api";
import { ErrorNote } from "./components";
import { LoginPage } from "./pages/LoginPage";
import { SummaryPage } from "./pages/SummaryPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { TransactionDetailPage } from "./pages/TransactionDetailPage";
import { WebhooksPage } from "./pages/WebhooksPage";
import { DocsPage } from "./pages/DocsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditPage } from "./pages/AuditPage";

const linkGroups = [
  {
    label: "Utama",
    links: [
      { to: "/", label: "Dashboard", end: true },
      { to: "/projects", label: "Project", end: false },
      { to: "/transactions", label: "Transaksi", end: false },
      { to: "/webhooks", label: "Webhook gagal", end: false },
    ],
  },
  {
    label: "Sistem",
    links: [
      { to: "/settings", label: "Pengaturan", end: false },
      { to: "/audit", label: "Audit", end: false },
      { to: "/docs", label: "Dokumentasi", end: false },
    ],
  },
];

interface ReauthRequest {
  resolve: (reauthenticated: boolean) => void;
}

export default function App() {
  const queryClient = useQueryClient();
  const [environment, setEnvironment] = useState<ApiEnvironment>(() => getApiEnvironment());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("gapura.theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [reauthRequest, setReauthRequest] = useState<ReauthRequest | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    setStatusError(null);
    try {
      const next = await fetchAuthStatus();
      setStatus(next);
      setIdentity(next.authenticated ? next.admin : null);
    } catch (error) {
      setStatusError(error);
      setIdentity(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gapura.theme", theme);
  }, [theme]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    configureApiAuth({
      onUnauthorized: () => {
        setIdentity(null);
        queryClient.clear();
        void refresh();
      },
      onReauthRequired: () =>
        new Promise<boolean>((resolve) => {
          setReauthRequest({ resolve });
        }),
    });
    return () => configureApiAuth({});
  }, [queryClient, refresh]);

  async function logout() {
    try {
      await logoutAdmin();
    } finally {
      setIdentity(null);
      setStatus((current) =>
        current ? { ...current, authenticated: false, admin: null } : current,
      );
      queryClient.clear();
      void refresh();
    }
  }

  function changeEnvironment(next: ApiEnvironment) {
    setApiEnvironment(next);
    setEnvironment(next);
    queryClient.clear();
    setStatus(null);
    setIdentity(null);
    void refresh();
  }

  function resolveReauth(reauthenticated: boolean) {
    const request = reauthRequest;
    setReauthRequest(null);
    request?.resolve(reauthenticated);
  }

  if (checking && !status) {
    return (
      <div className="boot">
        <div className="boot__panel">
          <p className="brand boot__brand">
            <span className="brand__name">Gapura</span>
            <span className="brand__role">Admin</span>
          </p>
          <p className="muted">Memeriksa sesi admin…</p>
        </div>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="boot">
        <div className="boot__panel">
          <p className="brand boot__brand">
            <span className="brand__name">Gapura</span>
            <span className="brand__role">Admin</span>
          </p>
          <ErrorNote error={statusError} />
          <button type="button" className="button button--primary" onClick={() => void refresh()}>
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <LoginPage
        key={environment}
        needsBootstrap={status?.needsBootstrap ?? false}
        setupTokenConfigured={status?.setupTokenConfigured ?? false}
        environment={environment}
        onEnvironmentChange={changeEnvironment}
        onAuthenticated={(admin) => {
          setIdentity(admin);
          queryClient.clear();
          void refresh();
        }}
      />
    );
  }

  const canWrite = identity.role === "owner" || identity.role === "admin";

  return (
    <BrowserRouter>
      <div className="side" data-environment={environment}>
        <a className="skip" href="#main">
          Lewati ke konten
        </a>

        <aside className="side__rail">
          <Link to="/" className="side__brand" aria-label="Gapura Admin, Dashboard">
            <span className="side__mark" aria-hidden="true">
              G
            </span>
            <span className="side__brand-copy">
              <span className="side__brand-name">Gapura</span>
              <span className="side__brand-role">Admin</span>
            </span>
          </Link>

          <nav className="side__nav" aria-label="Navigasi utama">
            {linkGroups.map((group) => (
              <div className="side__group" key={group.label}>
                <p className="side__group-label">{group.label}</p>
                {group.links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="side__tools">
            <label className="side__env">
              <span className="side__env-label">Environment</span>
              <select
                value={environment}
                onChange={(event) => changeEnvironment(event.target.value as ApiEnvironment)}
              >
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <div className="side__account">
              <span className="side__email" title={identity.email}>
                {identity.email}
              </span>
              <span className="badge role">{identity.role}</span>
            </div>
            <div className="side__actions">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "Mode terang" : "Mode gelap"}
              </button>
              <button type="button" className="button button--quiet" onClick={() => void logout()}>
                Keluar
              </button>
            </div>
          </div>
        </aside>

        <main className="side__main" id="main" tabIndex={-1}>
          <div className="side__topline">
            <span className="side__context">Operasional pembayaran</span>
            <span className="side__env-chip">{environment}</span>
          </div>
          <Routes>
            <Route path="/" element={<SummaryPage />} />
            <Route path="/projects" element={<ProjectsPage canWrite={canWrite} />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/:merchantOrderId" element={<TransactionDetailPage canWrite={canWrite} />} />
            <Route path="/webhooks" element={<WebhooksPage canWrite={canWrite} />} />
            <Route path="/settings" element={<SettingsPage canWrite={canWrite} />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/docs" element={<DocsPage />} />
          </Routes>
        </main>
      </div>

      {reauthRequest ? (
        <ReauthModal
          windowMinutes={status?.reauthWindowMinutes ?? 15}
          onCancel={() => resolveReauth(false)}
          onDone={() => resolveReauth(true)}
        />
      ) : null}
    </BrowserRouter>
  );
}

function ReauthModal({
  windowMinutes,
  onCancel,
  onDone,
}: {
  windowMinutes: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await reauthenticate(totpCode.trim());
      onDone();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title">Verifikasi ulang</h2>
        <p className="muted">
          Aksi sensitif butuh kode TOTP baru. Verifikasi berlaku {windowMinutes} menit.
        </p>
        <form className="form form--narrow" onSubmit={submit}>
          <label className="field wide">
            <span className="field__label">Kode TOTP</span>
            <input
              name="reauthTotp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              autoFocus
              required
            />
          </label>
          <div className="wide actions">
            <button type="submit" className="button button--primary" disabled={pending}>
              {pending ? "Memverifikasi…" : "Verifikasi"}
            </button>
            <button type="button" className="ghost" onClick={onCancel} disabled={pending}>
              Batal
            </button>
          </div>
        </form>
        <ErrorNote error={error} />
      </div>
    </div>
  );
}
