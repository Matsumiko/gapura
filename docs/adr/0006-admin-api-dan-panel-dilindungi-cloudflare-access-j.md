# 0006. Admin API dan panel dilindungi Cloudflare Access JWT

- Status: digantikan ADR-0007 (token Bearer); Access tidak dipakai
- Tanggal: 2026-11-03

## Konteks
PRD bagian 6 meminta panel admin terpisah (SPA React) yang dilindungi Cloudflare Access, dengan `/admin/*` di Worker tetap aman walau URL Worker diakses langsung. Akun Cloudflare saat ini **belum mengaktifkan Access**, sehingga application/policy belum bisa dibuat lewat API. Panel juga tidak boleh dideploy ke `pages.dev` tanpa proteksi, karena berisi aksi sensitif (membuat project, rotasi key, kirim ulang webhook).

## Opsi yang dipertimbangkan
1. **API key admin statis** — sederhana, tetapi bertentangan dengan PRD, sulit dicabut per orang, dan tidak punya jejak email pelaku.
2. **Session login buatan sendiri di Worker** — menambah pengelolaan sesi, password, dan CSRF yang tidak perlu.
3. **Verifikasi JWT Cloudflare Access di Worker + SPA di balik Access (dipilih)** — identitas dari Access, tanpa sesi sendiri; Worker tetap menolak request tanpa JWT valid.

## Keputusan
Pakai opsi 3.

**Verifikasi**
- Worker mengambil JWKS dari `<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, memverifikasi signature RS256, lalu memeriksa `iss` = team domain, `aud` = `ACCESS_AUD`, `exp`/`nbf` dengan toleransi 60 detik, dan mengambil `email` sebagai identitas.
- Token dibaca dari header `Cf-Access-Jwt-Assertion` (disuntik Access) atau cookie `CF_Authorization` (request browser langsung). Keduanya diverifikasi dengan cara yang sama.
- **Fail closed:** bila `ACCESS_TEAM_DOMAIN` atau `ACCESS_AUD` kosong, semua `/admin/*` menjawab `503 ADMIN_NOT_CONFIGURED`. Tidak ada jalur bypass berbasis environment.

**Endpoint admin** (semua di balik verifikasi di atas)
- `GET /admin/summary` — total PAID hari/bulan per project.
- `GET/POST /admin/projects`, `PATCH /admin/projects/:id` — daftar, buat, aktif/nonaktif.
- `POST /admin/projects/:id/rotate-key`, `POST /admin/projects/:id/rotate-secret` — kredensial baru dikembalikan sekali.
- `GET /admin/transactions`, `GET /admin/transactions/:merchantOrderId` — daftar dengan filter dan detail + riwayat webhook.
- `GET /admin/webhooks?status=FAILED|DEAD`, `POST /admin/webhooks/:id/retry` — antrean gagal dan kirim ulang (baris dijadwalkan ulang sebagai `FAILED`, attempt 1, jatuh tempo sekarang).
- Setiap mutasi menulis `admin_audit` (email pelaku, aksi, target, waktu). Secret dan data pembeli tidak dicatat.

**Panel**
- SPA React Router di `apps/panel`; semua request memakai `credentials: "include"` ke `VITE_API_URL`.
- Halaman: Ringkasan, Project (form + rotasi + status), Transaksi (filter + detail), Webhook gagal (retry).
- Deploy Pages ditahan sampai Access aktif dan domain panel tersedia; panel tidak dipublikasikan tanpa proteksi.

## Konsekuensi
- Positif: identitas admin dari Access, tidak ada password/session yang dikelola sendiri; token diverifikasi kriptografis di Worker; audit tercatat; panel tidak menyimpan token di localStorage.
- Positif: fail closed — salah konfigurasi tidak membuka akses.
- Negatif: admin hanya bisa dipakai setelah Access diaktifkan di akun dan application dibuat untuk domain panel serta path `/admin/*`; sampai itu, staging mengembalikan 503 untuk `/admin/*`.
- Negatif: cookie `CF_Authorization` dipakai sebagai fallback; bila Access tidak menyetel cookie (mis. bukan browser), header wajib.
- Negatif: rate limit admin belum ada; bergantung pada Access/WAF.
- Yang harus dijaga: `ACCESS_AUD` harus milik application yang benar; jangan menaruh kredensial admin di file yang di-commit; migrasi `0003_admin_audit.sql` wajib diterapkan sebelum endpoint audit dipakai.
- Bila nanti butuh multi-admin dengan peran berbeda, buat ADR baru; jangan menambah kolom peran diam-diam.
