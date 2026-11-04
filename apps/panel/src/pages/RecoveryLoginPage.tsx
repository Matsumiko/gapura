import { useState, type FormEvent } from "react";
import { apiPost, setCsrfToken, type SessionResult } from "../api";
import { ErrorNote } from "../components";

export function RecoveryLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await apiPost<SessionResult>("/admin/auth/recovery-login", {
        email: email.trim(),
        password,
        recoveryCode: recoveryCode.trim(),
      });
      setCsrfToken(result.csrfToken);
      window.location.assign("/");
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="boot">
      <div className="boot__panel">
        <p className="brand boot__brand">
          <span className="brand__name">Gapura</span>
          <span className="brand__role">Pemulihan</span>
        </p>
        <p className="muted">
          Masuk dengan password dan satu kode pemulihan TOTP. Kode yang dipakai langsung hangus.
        </p>
        <form className="form form--narrow" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              name="recoveryEmail"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              name="recoveryPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Kode pemulihan</span>
            <input
              name="recoveryCode"
              autoComplete="one-time-code"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              maxLength={64}
              required
            />
          </label>
          <div className="wide actions">
            <button type="submit" className="button button--primary" disabled={pending}>
              {pending ? "Memeriksa…" : "Masuk dengan kode pemulihan"}
            </button>
          </div>
        </form>
        <ErrorNote error={error} />
        <p className="muted">
          <a className="text-link" href="/">
            Kembali ke login TOTP
          </a>
        </p>
      </div>
    </div>
  );
}
