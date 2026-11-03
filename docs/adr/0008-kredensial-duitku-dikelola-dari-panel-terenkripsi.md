# 0008. Kredensial Duitku dikelola dari panel, terenkripsi di D1

- Status: diterima
- Tanggal: 2026-11-04

## Konteks
Panel harus bisa mengatur merchant key sandbox/production tanpa `wrangler secret put`. Worker secret tidak bisa ditulis dari aplikasi, dan menaruh token Cloudflare di panel justru memperluas risiko. Kredensial Duitku tetap harus tidak pernah tampil kembali setelah disimpan, dan callback harus memverifikasi dengan kredensial yang sama dengan inquiry.

## Keputusan
- Tabel `merchant_settings` menyimpan `environment` (`sandbox`/`production`), merchant code, API key **terenkripsi AES-GCM**, IV, status aktif, dan jejak ubah.
- Master key 32 byte base64 ada di Worker secret `CREDENTIALS_KEY`. Tanpa secret ini, penyimpanan kredensial dari panel dinonaktifkan (503 `SETTINGS_UNAVAILABLE`).
- Hanya satu environment aktif (partial unique index). Provider memilih host `sandbox.duitku.com` atau `passport.duitku.com` berdasarkan environment aktif; callback memakai kredensial aktif yang sama.
- API key tidak pernah dikembalikan; panel hanya melihat `apiKeySet`, merchant code, waktu, dan aktor.
- Bila D1 belum punya kredensial aktif, Worker jatuh ke secret `DUITKU_MERCHANT_CODE`/`DUITKU_API_KEY` (kompatibilitas deployment lama).
- Uji kredensial lewat `POST /admin/settings/:environment/test` (getPaymentMethod), bukan dengan membuat transaksi.
- Semua simpan/aktivasi dicatat di `admin_audit` tanpa nilai secret.

## Konsekuensi
- Positif: environment dan merchant key bisa diubah tanpa deploy; secret tidak tersimpan plaintext; rotasi cukup simpan ulang lewat panel.
- Negatif: kehilangan `CREDENTIALS_KEY` membuat kredensial tersimpan tidak bisa didekripsi (harus simpan ulang). D1 kini memuat ciphertext yang harus dijaga seperti secret.
- Negatif: satu deployment dengan D1 yang sama tidak memisahkan data sandbox/production; production tetap disarankan deployment + D1 terpisah.
- Yang harus dijaga: `CREDENTIALS_KEY` hanya di secret Worker dan cadangan aman; jangan log payload settings; audit tidak memuat API key.
