-- Kredensial Duitku per environment, terenkripsi AES-GCM (kunci di Worker secret).
CREATE TABLE IF NOT EXISTS merchant_settings (
  environment TEXT PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  merchant_code TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Hanya satu environment aktif untuk transaksi baru.
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_settings_active
  ON merchant_settings (is_active) WHERE is_active = 1;
