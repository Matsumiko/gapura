import { useState, type FormEvent, type ReactNode } from "react";
import {
  finishBootstrap,
  loginAdmin,
  startBootstrap,
  type AdminIdentity,
  type ApiEnvironment,
  type BootstrapStartResult,
} from "../api";
import { ErrorNote } from "../components";

interface LoginPageProps {
  needsBootstrap: boolean;
  setupTokenConfigured: boolean;
  environment: ApiEnvironment;
  onEnvironmentChange: (environment: ApiEnvironment) => void;
  onAuthenticated: (admin: AdminIdentity) => void;
}

interface SetupForm {
  setupToken: string;
  email: string;
  password: string;
}

const EMPTY_SETUP: SetupForm = { setupToken: "", email: "", password: "" };

export function LoginPage({
  needsBootstrap,
  setupTokenConfigured,
  environment,
  onEnvironmentChange,
  onAuthenticated,
}: LoginPageProps) {
  const [setup, setSetup] = useState<SetupForm>(EMPTY_SETUP);
  const [enrollment, setEnrollment] = useState<BootstrapStartResult | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await loginAdmin({ email: email.trim(), password, totpCode: totpCode.trim() });
      onAuthenticated(result.admin);
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  async function submitSetupStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await startBootstrap({
        setupToken: setup.setupToken,
        email: setup.email.trim(),
      });
      setEnrollment(result);
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  async function submitSetupFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await finishBootstrap({
        setupToken: setup.setupToken,
        email: setup.email.trim(),
        password: setup.password,
        secret: enrollment.secret,
        totpCode: totpCode.trim(),
      });
      onAuthenticated(result.admin);
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  if (needsBootstrap) {
    if (!setupTokenConfigured) {
      return (
        <AuthShell
          title="Setup admin belum tersedia"
          description="ADMIN_SETUP_TOKEN belum diset di Worker. Set secret itu lalu muat ulang halaman."
          environment={environment}
          onEnvironmentChange={onEnvironmentChange}
        >
          <p className="error">
            Bootstrap owner tidak bisa dijalankan sampai <code>ADMIN_SETUP_TOKEN</code> dipasang.
          </p>
        </AuthShell>
      );
    }

    if (enrollment) {
      return (
        <AuthShell
          title="Daftarkan TOTP"
          description="Pindai URI di aplikasi authenticator, lalu masukkan kode 6 digit untuk mengaktifkan owner."
          environment={environment}
          onEnvironmentChange={onEnvironmentChange}
        >
          <article className="card">
            <dl className="details">
              <dt>Secret</dt>
              <dd>
                <code>{enrollment.secret}</code>
              </dd>
              <dt>otpauth URI</dt>
              <dd className="wrap">
                <code>{enrollment.otpauthUri}</code>
              </dd>
            </dl>
            <form className="form" onSubmit={submitSetupFinish}>
              <label className="wide">
                Kode TOTP
                <input
                  name="totpCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  required
                />
              </label>
              <div className="wide actions">
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan..." : "Aktifkan owner"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setEnrollment(null);
                    setTotpCode("");
                  }}
                >
                  Kembali
                </button>
              </div>
            </form>
            <ErrorNote error={error} />
          </article>
        </AuthShell>
      );
    }

    return (
      <AuthShell
        title="Setup owner"
        description="Belum ada admin. Buat owner pertama dengan setup token, email, dan password (minimal 12 karakter)."
        environment={environment}
        onEnvironmentChange={onEnvironmentChange}
      >
        <article className="card">
          <form className="form" onSubmit={submitSetupStart}>
            <label>
              Setup token
              <input
                name="setupToken"
                type="password"
                value={setup.setupToken}
                onChange={(event) => setSetup({ ...setup, setupToken: event.target.value })}
                autoComplete="one-time-code"
                required
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                value={setup.email}
                onChange={(event) => setSetup({ ...setup, email: event.target.value })}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={12}
                value={setup.password}
                onChange={(event) => setSetup({ ...setup, password: event.target.value })}
                autoComplete="new-password"
                required
              />
            </label>
            <div className="wide">
              <button type="submit" disabled={pending}>
                {pending ? "Menyiapkan..." : "Lanjut ke TOTP"}
              </button>
            </div>
          </form>
          <ErrorNote error={error} />
        </article>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Masuk"
      description="Gunakan email, password, dan kode TOTP. Sesi disimpan di cookie HttpOnly."
      environment={environment}
      onEnvironmentChange={onEnvironmentChange}
    >
      <article className="card">
        <form className="form" onSubmit={submitLogin}>
          <label>
            Email
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="wide">
            Kode TOTP
            <input
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              required
            />
          </label>
          <div className="wide">
            <button type="submit" disabled={pending}>
              {pending ? "Memeriksa..." : "Masuk"}
            </button>
          </div>
        </form>
        <ErrorNote error={error} />
        <p className="muted">
          Token sesi tidak pernah disimpan di JavaScript; hanya CSRF token untuk header write yang
          disimpan di sessionStorage tab ini.
        </p>
      </article>
    </AuthShell>
  );
}

function AuthShell({
  title,
  description,
  environment,
  onEnvironmentChange,
  children,
}: {
  title: string;
  description: string;
  environment: ApiEnvironment;
  onEnvironmentChange: (environment: ApiEnvironment) => void;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Gapura Admin</h1>
          <p className="muted">{description}</p>
        </div>
        <label className="env-select">
          Env
          <select
            value={environment}
            onChange={(event) => onEnvironmentChange(event.target.value as ApiEnvironment)}
          >
            <option value="sandbox">sandbox</option>
            <option value="production">production</option>
          </select>
        </label>
      </header>
      <main className="content">
        <section className="stack">
          <h2>{title}</h2>
          {children}
        </section>
      </main>
    </div>
  );
}
