import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  apiGet,
  apiPatch,
  apiPost,
  type CreatedProject,
  type Project,
} from "../api";
import { ErrorNote, formatTime } from "../components";

interface RevealedCredential {
  label: string;
  value: string;
}

const INITIAL_FORM = { name: "", prefix: "", webhookUrl: "" };

export function ProjectsPage() {
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
      setRevealed([{ label: `API key baru · ${project.name}`, value: data.apiKey }]);
      await refresh();
    },
  });

  const rotateSecret = useMutation({
    mutationFn: (project: Project) =>
      apiPost<{ webhookSecret: string }>(`/admin/projects/${project.id}/rotate-secret`),
    onSuccess: (data, project) => {
      setRevealed([{ label: `Webhook secret baru · ${project.name}`, value: data.webhookSecret }]);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createProject.mutate();
  }

  return (
    <section className="stack">
      {revealed ? (
        <div className="credential" role="status">
          <strong>Tampil sekali — simpan sekarang.</strong>
          {revealed.map((item) => (
            <div key={item.label} className="credential-row">
              <span className="muted">{item.label}</span>
              <code>{item.value}</code>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setRevealed(null)}>
            Tutup
          </button>
        </div>
      ) : null}

      <article className="card">
        <h2>Tambah project</h2>
        <form className="form" onSubmit={submit}>
          <label>
            Nama
            <input
              name="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              maxLength={100}
            />
          </label>
          <label>
            Prefix order (3-6 huruf kapital)
            <input
              name="prefix"
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
          <label className="wide">
            Webhook URL
            <input
              name="webhookUrl"
              type="url"
              value={form.webhookUrl}
              onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
              required
              placeholder="https://project.example/callback"
            />
          </label>
          <div className="wide">
            <button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? "Menyimpan..." : "Tambah project"}
            </button>
          </div>
        </form>
        <ErrorNote error={createProject.error} />
      </article>

      <article className="card">
        <h2>Daftar project</h2>
        {projects.isPending ? <p className="muted">Memuat...</p> : null}
        <ErrorNote error={projects.error} />
        {projects.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Prefix</th>
                  <th>Webhook</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {projects.data.items.map((project) => {
                  const isEditing = editing?.id === project.id;
                  return (
                    <tr key={project.id}>
                      <td>
                        {isEditing ? (
                          <input
                            name="edit-name"
                            value={editing.name}
                            maxLength={100}
                            onChange={(event) =>
                              setEditing({ ...editing, name: event.target.value })
                            }
                          />
                        ) : (
                          project.name
                        )}
                      </td>
                      <td>
                        <code>{project.prefix}</code>
                      </td>
                      <td className="wrap">
                        {isEditing ? (
                          <input
                            name="edit-webhook"
                            type="url"
                            value={editing.webhookUrl}
                            onChange={(event) =>
                              setEditing({ ...editing, webhookUrl: event.target.value })
                            }
                          />
                        ) : (
                          project.webhookUrl
                        )}
                      </td>
                      <td>
                        <span className={project.isActive ? "badge good" : "badge bad"}>
                          {project.isActive ? "aktif" : "nonaktif"}
                        </span>
                      </td>
                      <td>{formatTime(project.createdAt)}</td>
                      <td className="actions">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => updateProject.mutate(editing)}
                              disabled={updateProject.isPending}
                            >
                              {updateProject.isPending ? "Menyimpan..." : "Simpan"}
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
              </tbody>
            </table>
          </div>
        ) : null}
        <ErrorNote
          error={
            updateProject.error ?? toggleProject.error ?? rotateKey.error ?? rotateSecret.error
          }
        />
      </article>
    </section>
  );
}
