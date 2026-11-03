import { useState, type FormEvent } from "react";
import { apiGet, setAdminToken } from "../api";
import { ErrorNote } from "../components";

export function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) {
      return;
    }
    setPending(true);
    setError(null);
    setAdminToken(candidate);
    try {
      await apiGet("/admin/summary");
      onLogin(candidate);
    } catch (cause) {
      setAdminToken("");
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Gapura Admin</h1>
          <p className="muted">Masukkan token admin untuk membuka panel.</p>
        </div>
      </header>
      <main className="content">
        <article className="card">
          <form className="form" onSubmit={submit}>
            <label className="wide">
              Token admin
              <input
                type="password"
                name="token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="current-password"
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
            Token disimpan di sessionStorage tab ini dan hilang saat tab ditutup.
          </p>
        </article>
      </main>
    </div>
  );
}
