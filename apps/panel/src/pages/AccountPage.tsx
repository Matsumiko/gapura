import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  changeAccountEmail,
  changeAccountPassword,
  fetchAccount,
  regenerateAccountRecoveryCodes,
} from "../api";
import { ErrorNote, PageHeader } from "../components";

export function AccountPage({ onEmailChanged }: { onEmailChanged: (email: string) => void }) {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["admin", "account"],
    queryFn: fetchAccount,
  });

  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (account.data) {
      setEmail(account.data.account.email);
    }
  }, [account.data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "account"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "audit-auth"] });
  }

  const changeEmail = useMutation({
    mutationFn: () => changeAccountEmail({ email: email.trim(), password: emailPassword }),
    onSuccess: async (result) => {
      setEmailPassword("");
      onEmailChanged(result.account.email);
      await refresh();
    },
  });

  const changePassword = useMutation({
    mutationFn: () =>
      changeAccountPassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError(null);
      await refresh();
    },
  });

  const regenerateCodes = useMutation({
    mutationFn: () => regenerateAccountRecoveryCodes({ password: recoveryPassword }),
    onSuccess: async (result) => {
      setCodes(result.codes);
      setRecoveryPassword("");
      await refresh();
    },
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError("Konfirmasi password baru tidak sama.");
      return;
    }
    setPasswordError(null);
    changePassword.mutate();
  }

  if (account.isPending) {
    return (
      <>
        <PageHeader title="Akun" lede="Email, password, dan kode pemulihan untuk akun ini." />
        <div className="panel">
          <p className="muted">Memuat akun…</p>
        </div>
      </>
    );
  }

  if (account.isError) {
    return (
      <>
        <PageHeader title="Akun" lede="Email, password, dan kode pemulihan untuk akun ini." />
        <div className="panel">
          <ErrorNote error={account.error} />
        </div>
      </>
    );
  }

  const view = account.data.account;
  const pending = changeEmail.isPending || changePassword.isPending || regenerateCodes.isPending;

  return (
    <>
      <PageHeader
        title="Akun"
        lede="Ubah email, password, dan kode pemulihan. Jika sesi belum diverifikasi ulang, panel meminta kode TOTP lebih dulu."
      />

      <section className="panel">
        <div className="panel-head">
          <h2>Email</h2>
          <span className="badge role">{view.role}</span>
        </div>
        <p className="settings-note">
          Email dipakai untuk login. Setelah berubah, sesi di perangkat lain dicabut dan sesi ini
          tetap aktif.
        </p>
        <form
          className="form form--narrow"
          onSubmit={(event) => {
            event.preventDefault();
            changeEmail.mutate();
          }}
        >
          <label className="field wide">
            <span className="field__label">Email baru</span>
            <input
              name="accountEmail"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </label>
          <label className="field wide">
            <span className="field__label">Password saat ini</span>
            <input
              name="accountEmailPassword"
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(event) => setEmailPassword(event.target.value)}
              required
            />
          </label>
          <div className="wide actions">
            <button type="submit" className="button button--primary" disabled={pending}>
              {changeEmail.isPending ? "Menyimpan…" : "Ubah email"}
            </button>
          </div>
        </form>
        <ErrorNote error={changeEmail.error} />
        {changeEmail.isSuccess ? (
          <p className="muted" role="status">
            Email tersimpan. Sesi lain dicabut.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Password</h2>
        </div>
        <p className="settings-note">
          Minimal 12 karakter. Sesi lain dicabut setelah password berubah; sesi ini tetap aktif.
        </p>
        <form className="form form--narrow" onSubmit={submitPassword}>
          <label className="field wide">
            <span className="field__label">Password saat ini</span>
            <input
              name="accountCurrentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Password baru</span>
            <input
              name="accountNewPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Ulangi password baru</span>
            <input
              name="accountConfirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <div className="wide actions">
            <button type="submit" className="button button--primary" disabled={pending}>
              {changePassword.isPending ? "Menyimpan…" : "Ubah password"}
            </button>
          </div>
        </form>
        {passwordError ? <p className="error">{passwordError}</p> : null}
        <ErrorNote error={changePassword.error} />
        {changePassword.isSuccess ? (
          <p className="muted" role="status">
            Password tersimpan. Sesi lain dicabut.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Kode pemulihan</h2>
          <span className="panel-count">{view.recoveryCodesRemaining} tersisa</span>
        </div>
        <p className="settings-note">
          Membuat set baru akan menonaktifkan semua kode lama. Setiap kode hanya bisa dipakai sekali
          untuk login saat authenticator tidak tersedia.
        </p>
        <form
          className="form form--narrow"
          onSubmit={(event) => {
            event.preventDefault();
            regenerateCodes.mutate();
          }}
        >
          <label className="field wide">
            <span className="field__label">Password saat ini</span>
            <input
              name="recoveryPassword"
              type="password"
              autoComplete="current-password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              required
            />
          </label>
          <div className="wide actions">
            <button type="submit" className="button button--primary" disabled={pending}>
              {regenerateCodes.isPending ? "Membuat…" : "Buat kode baru"}
            </button>
          </div>
        </form>
        <ErrorNote error={regenerateCodes.error} />
        {codes ? (
          <div className="credential" role="status">
            <div className="credential__head">
              <strong>Kode pemulihan baru</strong>
              <button type="button" className="ghost" onClick={() => setCodes(null)}>
                Tutup
              </button>
            </div>
            <p className="muted">Tampil sekali. Simpan di tempat aman; kode lama tidak berlaku.</p>
            {codes.map((code, index) => (
              <div key={code} className="credential-row">
                <span className="field__label">Kode {index + 1}</span>
                <code className="credential__value">{code}</code>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
