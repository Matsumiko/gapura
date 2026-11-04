import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
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
import { EnvironmentProvider, ErrorNote } from "./components";
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
      {
        to: "/",
        label: "Dashboard",
        end: true,
        note: "Uang masuk dan antrean",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.25" y="2.25" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9.25" y="2.25" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="2.25" y="9.25" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9.25" y="9.25" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ),
      },
      {
        to: "/projects",
        label: "Project",
        end: false,
        note: "Prefix dan webhook",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.25 4.5h4l1.25 1.5h6.25v7.25h-11.5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        to: "/transactions",
        label: "Transaksi",
        end: false,
        note: "Pembayaran tercatat",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.25 2.25h9.5v11.5l-1.9-1.1-1.85 1.1L7.15 12.65 5.3 13.75l-2.05-1.1z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M5.75 5.25h4.5M5.75 7.75h4.5M5.75 10.25h2.75" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ),
      },
      {
        to: "/webhooks",
        label: "Webhook gagal",
        end: false,
        note: "Retry dan dead-letter",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.75 6a4.25 4.25 0 0 1 7.3-3l1.2 1.2M13.25 10a4.25 4.25 0 0 1-7.3 3l-1.2-1.2"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <path d="M11.5 1.75V5H8.25M4.5 14.25V11h3.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Sistem",
    links: [
      {
        to: "/settings",
        label: "Pengaturan",
        end: false,
        note: "Kredensial Duitku",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.25 4.5h11.5M2.25 8h11.5M2.25 11.5h11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="5.5" cy="4.5" r="1.5" fill="var(--color-side)" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="10.5" cy="8" r="1.5" fill="var(--color-side)" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="6.75" cy="11.5" r="1.5" fill="var(--color-side)" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ),
      },
      {
        to: "/audit",
        label: "Audit",
        end: false,
        note: "Aksi admin",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.25 2.25h7l2.5 2.5v9h-9.5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M5.25 6.25h5.5M5.25 8.75h5.5M5.25 11.25h3.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        to: "/docs",
        label: "Dokumentasi",
        end: false,
        note: "Referensi API",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.25 3.25h4A1.75 1.75 0 0 1 8 5v8.25a1.75 1.75 0 0 0-1.75-1.5h-4zM13.75 3.25h-4A1.75 1.75 0 0 0 8 5v8.25a1.75 1.75 0 0 1 1.75-1.5h4z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
    ],
  },
];

interface ReauthRequest {
  resolve: (reauthenticated: boolean) => void;
}

function SideNav() {
  const location = useLocation();
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 60rem)").matches) {
      return;
    }
    navRef.current
      ?.querySelector<HTMLElement>(".nav-link.active")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [location.pathname]);

  return (
    <nav className="side__nav" aria-label="Navigasi utama" ref={navRef}>
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
              {link.icon}
              <span className="nav-link__copy">
                <span className="nav-link__label">{link.label}</span>
                <span className="nav-link__note">{link.note}</span>
              </span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
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
      <EnvironmentProvider value={environment}>
        <div className="side" data-environment={environment}>
          <a className="skip" href="#main">
            Lewati ke konten
          </a>

          <aside className="side__rail">
            <Link to="/" className="side__brand" aria-label="Gapura Admin, Dashboard">
              <span className="side__mark" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path
                    d="M3.5 17V6.5h13V17M7 17V9.5h6V17"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
              </span>
              <span className="side__brand-copy">
                <span className="side__brand-name">Gapura</span>
                <span className="side__brand-role">Admin</span>
              </span>
            </Link>

            <SideNav />

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
                <span className="side__env-note">Data mengikuti environment ini.</span>
              </label>
              <div className="side__account">
                <span className="side__session">
                  <span className="side__session-mark" aria-hidden="true" />
                  Sesi aktif
                </span>
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
      </EnvironmentProvider>
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
