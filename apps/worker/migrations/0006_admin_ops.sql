-- Operasional admin: kode pemulihan TOTP dan rate limit per project.
-- Kode pemulihan disimpan sebagai hash; plaintext hanya tampil sekali saat dibuat.
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (admin_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_admin
  ON admin_recovery_codes (admin_id, used_at);

-- Fixed window per project untuk route /v1/*. Satu baris per (project, window).
CREATE TABLE IF NOT EXISTS project_rate_limits (
  project_id TEXT NOT NULL REFERENCES projects(id),
  window_start INTEGER NOT NULL, -- epoch detik awal window
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_project_rate_limits_window
  ON project_rate_limits (window_start);
