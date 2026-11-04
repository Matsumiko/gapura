import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  apiGet,
  apiPatch,
  apiPost,
  type CreatedProject,
  type Project,
} from "../api";
import {
  EmptyRow,
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

interface RevealedCredential {
  label: string;
  value: string;
}

const INITIAL_FORM = { name: "", prefix: "", webhookUrl: "" };

export function ProjectsPage({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [revealed, setRevealed] = useState<RevealedCredential[] | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    webhookUrl: string;
  } | null>(null);

  const projects = useQuery({
    queryKey: ["admin", "projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/admin/projects"),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "projects"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "summary"] });
  }

  const createProject = useMutation({
    mutationFn: () => apiPost<CreatedProject>("/admin/projects", form),
    onSuccess: async (created) => {
      setRevealed([
        { label: "API key", value: created.apiKey },
        { label: "Webhook secret", value: created.webhookSecret },
      ]);
      setForm(INITIAL_FORM);
      await refresh();
    },
  });

  const toggleProject = useMutation({
    mutationFn: (project: Project) =>
      apiPatch<{ project: Project }>(`/admin/projects/${project.id}`, {
        isActive: !project.isActive,
      }),
    onSuccess: refresh,
  });

  const updateProject = useMutation({
    mutationFn: (input: { id: string; name: string; webhookUrl: string }) =>
      apiPatch<{ project: Project }>(`/admin/projects/${input.id}`, {
        name: input.name,
        webhookUrl: input.webhookUrl,
      }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });

  const rotateKey = useMutation({
    mutationFn: (project: Project) =>
      apiPost<{ apiKey: string }>(`/admin/projects/${project.id}/rotate-key`),
    onSuccess: async (data, project) => {
      setRevealed([{ label: `API key baru: ${project.name}`, value: data.apiKey }]);
      await refresh();
    },
  });

  const rotateSecret = useMutation({
    mutationFn: (project: Project) =>
      apiPost<{ webhookSecret: string }>(`/admin/projects/${project.id}/rotate-secret`),
    onSuccess: (data, project) => {
      setRevealed([{ label: `Webhook secret baru: ${project.name}`, value: data.webhookSecret }]);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createProject.mutate();
  }

  return (
    <>
      <PageHeader
        title="Project"
        lede="Project, prefix order, webhook, dan kredensial yang tampil sekali."
      />

      {revealed ? (
        <div className="credential" role="status">
          <div className="credential__head">
            <strong>Tampil sekali, simpan sekarang.</strong>
            <button type="button" className="ghost" onClick={() => setRevealed(null)}>
              Tutup
            </button>
          </div>
          {revealed.map((item) => (
            <div key={item.label} className="credential-row">
              <span className="field__label">{item.label}</span>
              <code className="credential__value">{item.value}</code>
            </div>
          ))}
        </div>
      ) : null}

      {canWrite ? (
        <section className="panel project-form">
          <div className="panel-head">
            <h2>Tambah project</h2>
          </div>
          <form className="form form--project" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Nama</span>
              <input
                name="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                maxLength={100}
              />
            </label>
            <label className="field">
              <span className="field__label">Prefix order (3-6 huruf kapital)</span>
              <input
                name="prefix"
                className="num"
                value={form.prefix}
                onChange={(event) =>
                  setForm({ ...form, prefix: event.target.value.toUpperCase().slice(0, 6) })
                }
                required
                minLength={3}
                maxLength={6}
                pattern="[A-Z]{3,6}"
              />
            </label>
            <label className="field">
              <span className="field__label">Webhook URL</span>
              <input
                name="webhookUrl"
                type="url"
                value={form.webhookUrl}
                onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
                required
                placeholder="https://project.example/callback"
              />
            </label>
            <div className="actions project-form__actions">
              <button
                type="submit"
                className="button button--primary"
                disabled={createProject.isPending}
              >
                {createProject.isPending ? "Menyimpan…" : "Tambah project"}
              </button>
            </div>
          </form>
          <ErrorNote error={createProject.error} />
        </section>
      ) : (
        <section className="panel viewer-note">
          <p className="muted">Role viewer hanya bisa membaca data.</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Daftar project</h2>
          {projects.data ? (
            <span className="panel-count num">{projects.data.items.length} project</span>
          ) : null}
        </div>

        <ErrorNote error={projects.error} />

        {projects.isPending ? <TableSkeleton rows={4} cols={6} /> : null}

        {projects.data ? (
          <div className="table-wrap">
            <table className="data-table project-table">
              <thead>
                <tr>
                  <th scope="col">Nama</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Webhook</th>
                  <th scope="col">Status</th>
                  <th scope="col">Dibuat</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {projects.data.items.map((project) => {
                  const isEditing = editing?.id === project.id;
                  return (
                    <tr key={project.id}>
                      <td data-label="Nama">
                        {isEditing ? (
                          <input
                            name="edit-name"
                            className="input input--inline"
                            value={editing.name}
                            maxLength={100}
                            onChange={(event) =>
                              setEditing({ ...editing, name: event.target.value })
                            }
                          />
                        ) : (
                          <span className="table__name">{project.name}</span>
                        )}
                      </td>
                      <td data-label="Prefix">
                        <code>{project.prefix}</code>
                      </td>
                      <td data-label="Webhook" className="wrap">
                        {isEditing ? (
                          <input
                            name="edit-webhook"
                            className="input input--inline"
                            type="url"
                            value={editing.webhookUrl}
                            onChange={(event) =>
                              setEditing({ ...editing, webhookUrl: event.target.value })
                            }
                          />
                        ) : (
                          <span className="table__webhook">{project.webhookUrl}</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={project.isActive ? "badge good" : "badge bad"}>
                          {project.isActive ? "aktif" : "nonaktif"}
                        </span>
                      </td>
                      <td data-label="Dibuat" className="cell-time num">
                        {formatTime(project.createdAt)}
                      </td>
                      <td data-label="Aksi" className="actions">
                        {!canWrite ? (
                          <span className="muted">-</span>
                        ) : isEditing ? (
                          <>
                            <button
                              type="button"
                              className="button button--small"
                              onClick={() => updateProject.mutate(editing)}
                              disabled={updateProject.isPending}
                            >
                              {updateProject.isPending ? "Menyimpan…" : "Simpan"}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setEditing(null)}
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                setEditing({
                                  id: project.id,
                                  name: project.name,
                                  webhookUrl: project.webhookUrl,
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => toggleProject.mutate(project)}
                              disabled={toggleProject.isPending}
                            >
                              {project.isActive ? "Nonaktifkan" : "Aktifkan"}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => rotateKey.mutate(project)}
                              disabled={rotateKey.isPending}
                            >
                              Rotasi key
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => rotateSecret.mutate(project)}
                              disabled={rotateSecret.isPending}
                            >
                              Rotasi secret
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {projects.data.items.length === 0 ? (
                  <EmptyRow colSpan={6}>Belum ada project.</EmptyRow>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        <ErrorNote
          error={
            updateProject.error ?? toggleProject.error ?? rotateKey.error ?? rotateSecret.error
          }
        />
      </section>
    </>
  );
}
