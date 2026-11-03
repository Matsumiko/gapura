# 0009. Route /sandbox dan /production dengan D1 terpisah

- Status: diterima
- Tanggal: 2026-11-04
- Menggantikan sebagian ADR-0008 (switch environment global)

## Konteks
Panel harus mengelola sandbox dan production tanpa mencampur data. Pilihan owner: satu Worker dengan route `/sandbox` dan `/production`, satu panel dengan pemilih environment.

## Keputusan
- Satu Worker melayani dua runtime: `/sandbox/*` memakai binding `DB_SANDBOX`, `/production/*` memakai `DB_PRODUCTION`. Path lama tanpa prefix diperlakukan sebagai sandbox untuk kompatibilitas.
- Setiap runtime punya repository, kredensial, provider, callback URL, dan Cron sendiri. Tidak ada kolom `environment` di data; isolasi fisik lewat database.
- Callback Duitku per environment: `<PUBLIC_BASE_URL>/sandbox/callback/duitku` dan `<PUBLIC_BASE_URL>/production/callback/duitku`.
- Admin API ikut di bawah prefix environment (`/sandbox/admin/*`, `/production/admin/*`); panel memilih environment dan mengirim prefix itu.
- `merchant_settings` dibatasi ke environment milik route; production tidak memakai fallback secret sandbox.
- Cron trigger yang sama memproses retry/sync/retention untuk kedua database.

## Konsekuensi
- Positif: data, prefix, order ID, dan riwayat webhook tidak mungkin tercampur; tidak perlu refactor skema.
- Positif: production dapat memakai kredensial dan volume sendiri tanpa memengaruhi sandbox.
- Negatif: dua database harus dimigrasikan dan dipantau; panel harus selalu menyertakan prefix environment.
- Negatif: path lama `/v1` tetap ada sebagai alias sandbox, jadi dokumentasi wajib menekankan path ber-prefix.
