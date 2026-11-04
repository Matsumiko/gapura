-- Satu orderId project hanya boleh punya satu transaksi. merchant_order_id sudah unik,
-- index ini menjaga invariant yang sama bila prefix berubah atau baris dibuat manual.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_project_order
  ON transactions(project_id, project_order_id);
