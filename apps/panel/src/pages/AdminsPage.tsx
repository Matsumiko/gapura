import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  apiGet,
  apiPost,
  type ActivatedAdminResult,
  type CreatedAdminResult,
  type ManagedAdmin,
  type ResetAdminPasswordResult,
  type ResetAdminTotpResult,
} from "../api";
import {
  EmptyRow,
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

interface Revealed {
  title: string;
  note: string;
  rows: Array<{ label: string; value: string }>;
}

const INITIAL_FORM = { email: "", role: "admin" as "admin" | "viewer", password: "" };

function revealRecoveryCodes(codes: string[]): Array<{ label: string; value: string }> {
  return codes.map((code, index) => ({ label: `Kode ${index + 1}`, value: code }));
}

export function AdminsPage({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [activation, setActivation] = useState<{ admin: ManagedAdmin; totpCode: string } | null>(
    null,
  );

  const admins = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: () => apiGet<{ items: ManagedAdmin[] }>("/admin/admins"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "admins"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "audit-auth"] });
  }

  const createAdmin = useMutation({
    mutationFn: () =>
      apiPost<CreatedAdminResult>("/admin/admins", {
        email: form.email.trim(),
        role: form.role,
        ...(form.password.trim() ? { password: form.password.trim() } : {}),
      }),
    onSuccess: async (created) => {
      setRevealed({
        title: `Admin ${created.admin.email} dibuat, TOTP belum aktif`,
        note: "Tampil sekali. Simpan password dan secret TOTP untuk diserahkan ke admin.",
        rows: [
          { label: "Password awal", value: created.initialPassword },
          { label: "Secret TOTP", value: created.secret },
          { label: "otpauth URI", value: created.otpauthUri },
        ],
      });
      setForm(INITIAL_FORM);
      await refresh();
    },
  });

  const activate = useMutation({
    mutationFn: (input: { id: string; totpCode: string }) =>
      apiPost<ActivatedAdminResult>(`/admin/admins/${input.id}/activate`, {
        totpCode: input.totpCode,
      }),
    onSuccess: async (result) => {
      setRevealed({
        title: `TOTP ${result.admin.email} aktif`,
        note: "8 kode pemulihan di bawah hanya tampil sekali. Simpan di tempat aman.",
        rows: revealRecoveryCodes(result.recoveryCodes),
      });
      setActivation(null);
      await refresh();
    },
  });

  const deactivate = useMutation({
    mutationFn: (admin: ManagedAdmin) =>
      apiPost<{ admin: ManagedAdmin }>(`/admin/admins/${admin.id}/deactivate`),
    onSuccess: refresh,
  });

  const resetPassword = useMutation({
    mutationFn: (admin: ManagedAdmin) =>
      apiPost<ResetAdminPasswordResult>(`/admin/admins/${admin.id}/reset-password`, {}),
    onSuccess: async (result) => {
      setRevealed({
        title: `Password ${result.admin.email} direset`,
        note: "Password baru hanya tampil sekali; semua sesi admin tersebut dicabut.",
        rows: [{ label: "Password baru", value: result.newPassword }],
      });
      await refresh();
    },
  });

  const resetTotp = useMutation({
    mutationFn: (admin: ManagedAdmin) =>
      apiPost<ResetAdminTotpResult>(`/admin/admins/${admin.id}/reset-totp`),
    onSuccess: async (result) => {
      setRevealed({
        title: `TOTP ${result.admin.email} direset`,
        note: "Secret baru hanya tampil sekali. TOTP nonaktif sampai kode baru diverifikasi.",
        rows: [
          { label: "Secret TOTP", value: result.secret },
          { label: "otpauth URI", value: result.otpauthUri },
        ],
      });
      await refresh();
    },
  });

  const regenerateCodes = useMutation({
    mutationFn: (admin: ManagedAdmin) =>
      apiPost<{ recoveryCodes: string[] }>(`/admin/admins/${admin.id}/recovery-codes`),
    onSuccess: async (result) => {
      setRevealed({
        title: "Kode pemulihan baru",
        note: "Kode lama langsung tidak berlaku. Kode ini hanya tampil sekali.",
        rows: revealRecoveryCodes(result.recoveryCodes),
      });
      await refresh();
    },
  });

  const pending =
    createAdmin.isPending ||
    activate.isPending ||
    deactivate.isPending ||
    resetPassword.isPending ||
    resetTotp.isPending ||
    regenerateCodes.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createAdmin.mutate();
  }

  function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activation) {
      activate.mutate({ id: activation.admin.id, totpCode: activation.totpCode });
    }
  }

  return (
    <>
      <PageHeader
        title="Admin"
        lede="Kelola akun admin, TOTP, dan kode pemulihan. Hanya owner."
      />

      {revealed ? (
        <div className="credential" role="status">
          <div className="credential__head">
            <strong>{revealed.title}</strong>
            <button type="button" className="ghost" onClick={() => setRevealed(null)}>
              Tutup
            </button>
          </div>
          <p className="muted">{revealed.note}</p>
          {revealed.rows.map((row) => (
            <div key={row.label} className="credential-row">
              <span className="field__label">{row.label}</span>
              <code className="credential__value">{row.value}</code>
            </div>
          ))}
        </div>
      ) : null}

      {activation ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Aktifkan TOTP: {activation.admin.email}</h2>
          </div>
          <form className="form form--narrow" onSubmit={submitActivation}>
            <label className="field wide">
              <span className="field__label">Kode TOTP dari authenticator</span>
              <input
                name="activationTotp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={activation.totpCode}
                onChange={(event) =>
                  setActivation({ ...activation, totpCode: event.target.value })
                }
                required
                autoFocus
              />
            </label>
            <div className="wide actions">
              <button type="submit" className="button button--primary" disabled={pending}>
                {activate.isPending ? "Memverifikasi…" : "Aktifkan"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setActivation(null)}
                disabled={pending}
              >
                Batal
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {canWrite ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Tambah admin</h2>
          </div>
          <form className="form form--narrow" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Email</span>
              <input
                name="adminEmail"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                maxLength={254}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Role</span>
              <select
                name="adminRole"
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value as "admin" | "viewer" })
                }
              >
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Password awal (opsional, min. 12 karakter)</span>
              <input
                name="adminPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="Kosongkan untuk generate otomatis"
              />
            </label>
            <div className="wide actions">
              <button type="submit" className="button button--primary" disabled={pending}>
                {createAdmin.isPending ? "Menyimpan…" : "Tambah admin"}
              </button>
            </div>
          </form>
          <ErrorNote error={createAdmin.error} />
        </section>
      ) : (
        <section className="panel viewer-note">
          <p className="muted">Hanya owner yang bisa mengelola admin.</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Daftar admin</h2>
          {admins.data ? (
            <span className="panel-count">{admins.data.items.length} admin</span>
          ) : null}
        </div>

        <ErrorNote
          error={
            admins.error ??
            deactivate.error ??
            resetPassword.error ??
            resetTotp.error ??
            regenerateCodes.error ??
            activate.error
          }
        />

        {admins.isPending ? <TableSkeleton rows={4} cols={7} /> : null}

        {admins.data ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">TOTP</th>
                  <th scope="col">Kode pemulihan</th>
                  <th scope="col">Dibuat</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {admins.data.items.map((admin) => (
                  <tr key={admin.id}>
                    <td data-label="Email">{admin.email}</td>
                    <td data-label="Role">
                      <span className="badge role">{admin.role}</span>
                    </td>
                    <td data-label="Status">
                      <span className={admin.isActive ? "badge good" : "badge bad"}>
                        {admin.isActive ? "aktif" : "nonaktif"}
                      </span>
                    </td>
                    <td data-label="TOTP">
                      <span className={admin.totpEnabled ? "badge good" : "badge bad"}>
                        {admin.totpEnabled ? "aktif" : "belum"}
                      </span>
                    </td>
                    <td className="cell-num" data-label="Kode pemulihan">
                      {admin.recoveryCodesRemaining}
                    </td>
                    <td className="cell-time" data-label="Dibuat">
                      {formatTime(admin.createdAt)}
                    </td>
                    <td data-label="Aksi" className="actions">
                      {canWrite && admin.isActive ? (
                        <div className="row-actions">
                          {admin.totpEnabled ? null : (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setActivation({ admin, totpCode: "" })}
                              disabled={pending}
                            >
                              Aktifkan
                            </button>
                          )}
                          {admin.totpEnabled ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Buat ulang kode pemulihan ${admin.email}? Kode lama tidak berlaku.`,
                                  )
                                ) {
                                  regenerateCodes.mutate(admin);
                                }
                              }}
                              disabled={pending}
                            >
                              Kode pemulihan
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => resetPassword.mutate(admin)}
                            disabled={pending}
                          >
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Reset TOTP ${admin.email}? Semua sesi admin ini dicabut.`,
                                )
                              ) {
                                resetTotp.mutate(admin);
                              }
                            }}
                            disabled={pending}
                          >
                            Reset TOTP
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              if (
                                window.confirm(`Nonaktifkan ${admin.email} dan cabut sesinya?`)
                              ) {
                                deactivate.mutate(admin);
                              }
                            }}
                            disabled={pending}
                          >
                            Nonaktifkan
                          </button>
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {admins.data.items.length === 0 ? (
                  <EmptyRow colSpan={7}>Belum ada admin.</EmptyRow>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
