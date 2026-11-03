-- Skema awal Gapura (D1). Sumber requirement: PRD bagian 7.
-- Status transaksi hanya maju; constraint UNIQUE menjaga order tidak dobel.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,            -- mis. 'proja'
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,    -- awalan order ID, mis. 'PRJA'
  api_key_hash TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Setiap request terautentikasi mencari project lewat hash API key.
CREATE INDEX IF NOT EXISTS idx_projects_api_key_hash ON projects (api_key_hash);

CREATE TABLE IF NOT EXISTS transactions (
  merchant_order_id TEXT PRIMARY KEY,  -- PREFIX-orderId (unik global)
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_order_id TEXT NOT NULL,      -- order ID asli milik project
  duitku_reference TEXT,
  amount INTEGER NOT NULL,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | FAILED | EXPIRED
  payment_url TEXT,
  forwarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, project_order_id)
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_order_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  http_status INTEGER,
  error TEXT,
  next_attempt_at TEXT,                   -- NULL = tidak dijadwalkan; diisi saat gagal
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | DELIVERED | DEAD
  created_at TEXT NOT NULL
);

-- Dipakai Cron Trigger untuk mengambil retry yang jatuh tempo.
CREATE INDEX IF NOT EXISTS idx_webhook_logs_due ON webhook_logs (status, next_attempt_at);
