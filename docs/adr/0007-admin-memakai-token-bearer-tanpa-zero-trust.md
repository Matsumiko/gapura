# 0007. Admin memakai token Bearer tanpa Zero Trust

> Status: digantikan [ADR-0010](0010-admin-auth-sesi-opaque-totp-step-up.md). Token statis sudah dihapus dari Worker dan panel.

- Status: digantikan ADR-0010
- Tanggal: 2026-11-03
- Menggantikan: ADR-0006 (Cloudflare Access)

## Konteks
Owner meminta panel admin tetap di Cloudflare Pages dan backend di Workers, tetapi tanpa Zero Trust/Access. Panel tetap menangani aksi sensitif: membuat project, merotasi API key/webhook secret, melihat transaksi, dan mengirim ulang webhook. Membiarkan `/admin/*` publik tidak dapat diterima. Access apps sudah dihapus dan `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` dilepas dari Worker.

## Opsi yang dipertimbangkan
1. **Tanpa autentikasi** — siapa pun yang menemukan URL bisa mengelola project. Ditolak.
2. **Login/session buatan sendiri (cookie + CSRF)** — menambah state sesi, proteksi CSRF, dan penyimpanan sesi yang harus dirawat.
3. **Token Bearer statis di secret Worker (dipilih)** — satu secret panjang, dikirim sebagai header `Authorization: Bearer`, dibandingkan waktu-konstan; panel menyimpannya di `sessionStorage`.

## Keputusan
Pakai opsi 3.

- Secret Worker token statis (64 hex acak). Bila kosong, semua `/admin/*` menjawab `503 ADMIN_NOT_CONFIGURED` (fail closed).
- Middleware membandingkan header `Authorization: Bearer <token>` dengan `secureEqual`; gagal → `401 ADMIN_UNAUTHORIZED`.
- CORS hanya mengizinkan origin panel (`PANEL_ORIGIN`, daftar dipisah koma): `https://admin.example.com` dan `https://your-project.pages.dev`; header `Authorization` diizinkan, kredensial cookie tidak dipakai.
- Panel menampilkan layar token; token disimpan di `sessionStorage` tab (hilang saat tab ditutup), tombol Keluar menghapusnya, dan setiap request API membawa Bearer. Tidak ada token di URL atau `localStorage`.
- Audit mencatat aktor `admin-token` (bukan email), karena tanpa Access tidak ada identitas per orang.
- `workers_dev = false`; Worker hanya di `pay.example.com`. Panel di `admin-pay.example.com` (Pages custom domain) dan alias `your-project.pages.dev`.

## Konsekuensi
- Positif: tidak bergantung pada Zero Trust/Access; panel tetap satu origin Pages; API tetap menolak request tanpa token; tidak ada cookie lintas situs.
- Positif: kode auth jauh lebih kecil (tanpa JWKS, cache kunci, atau verifikasi RS256).
- Negatif: satu token dibagi untuk semua admin; tidak ada identitas/atribusi per orang, tidak ada pencabutan per pengguna, dan tidak ada sesi kedaluwarsa selain menutup tab/mengganti token.
- Negatif: belum ada rate limit pada percobaan token; token 64 hex membuat brute force tidak praktis, tetapi WAF/rate limit tetap disarankan sebelum produksi.
- Negatif: `your-project.pages.dev` tetap bisa dibuka publik sebagai halaman login; isi panel dan API tidak bisa diakses tanpa token.
- Yang harus dijaga: token statis hanya di secret Worker, jangan pernah masuk repo/log; rotasi lewat `wrangler secret put` lalu login ulang di panel; audit aktor tetap `admin-token` sampai ada identitas nyata.
