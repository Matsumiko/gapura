# RUNBOOK

Gejala → cek → aksi. Staging: `https://pay.example.com`; panel: `https://admin.example.com`.

Dokumen pendamping: baseline log/alert di `docs/reference/duitku-observability.md`; onboarding produksi (Fase 0, gate, rollback) di `docs/reference/duitku-production-onboarding.md`.

## `/health` gagal atau 5xx

1. Cek status Cloudflare (status.cloudflare.com).
2. `cd apps/worker && wrangler tail gapura-sandbox` untuk melihat error.
3. Cek versi terakhir: `wrangler deployments list`. Bila deploy terakhir memicu masalah:
   `wrangler rollback <version-id>`.

## Project menerima 503 `PROVIDER_NOT_CONFIGURED`

Secret belum diset atau `PUBLIC_BASE_URL` kosong.

```sh
wrangler secret list
```

Set ulang:

```sh
printf '%s' '<merchant-code>' | wrangler secret put DUITKU_MERCHANT_CODE
printf '%s' '<api-key>'       | wrangler secret put DUITKU_API_KEY
```

Pastikan `PUBLIC_BASE_URL` di `wrangler.toml` adalah URL Worker yang bisa dihubungi Duitku, lalu deploy ulang.

## Project menerima 502 `PROVIDER_ERROR`

Duitku menolak inquiry atau tidak bisa dihubungi. Baris transaksi PENDING sudah dihapus, jadi project boleh mencoba lagi dengan `orderId` yang sama.

- Cek `DUITKU_BASE_URL` (sandbox vs produksi).
- Cek kredensial dan status merchant di dashboard Duitku.
- Cek `wrangler tail gapura-sandbox` untuk kode error provider (tidak ada data pribadi).

## Callback tidak masuk

1. Pastikan `PUBLIC_BASE_URL` = `https://<worker-url>` dan sudah di-deploy ulang.
2. Pastikan `callbackUrl` yang dikirim ke Duitku benar: `${PUBLIC_BASE_URL}/<environment>/callback/duitku` (tampil di panel → Pengaturan).
3. Uji manual dengan signature yang benar (lihat ADR-0004); signature salah menghasilkan 401.
4. Periksa log invocation untuk `401` pada `/callback/duitku` (tidak ada log aplikasi khusus), atau `400` untuk parameter tidak lengkap.

Callback 401 berulang biasanya berarti kredensial aktif tidak cocok:

- Panel → Pengaturan: environment yang dipakai harus sama dengan kredensial yang menerbitkan transaksi; cek `activeEnvironment`.
- Bila environment dinonaktifkan (mis. emergency stop), verifikasi signature gagal karena tidak ada kredensial aktif. Aktifkan kembali setelah masalah selesai.
- Jangan pasang Cloudflare Access/challenge pada path callback; Duitku tidak bisa melewatinya.

## Webhook project gagal / menumpuk

```sh
wrangler d1 execute gapura-sandbox --remote --json --command \
  "SELECT merchant_order_id, attempt, http_status, error, status, next_attempt_at
     FROM webhook_logs WHERE status IN ('FAILED','DEAD') ORDER BY id DESC LIMIT 20"
```

- `FAILED` dengan `next_attempt_at`: Cron akan mencoba lagi (1m/5m/15m/1j/6j).
- `DEAD`: 8 percobaan habis atau transaksi hilang. Perbaiki webhook project lalu minta kirim ulang (panel admin Fase 6; sementara seed baris `FAILED` dengan `next_attempt_at` sekarang atau kirim manual).
- Jika project membalas 2xx tetapi tetap gagal, cek signature/timestamp di sisi project.

## Cron tidak berjalan

- `wrangler deployments list` — pastikan versi terbaru memiliki trigger.
- Dashboard Cloudflare → Workers → gapura-sandbox → Triggers: `* * * * *`.
- Jalankan lokal: `wrangler dev --test-scheduled` lalu `curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"`.
- Lihat `cron_done`/`cron_failed` di `wrangler tail`; `cron_done` berisi `status: "rejected"` bila satu environment gagal.
- Di Workers Free, satu invocation dibatasi 50 query D1. Jangan menaikkan `batchSize` retry/sync tanpa menghitung query; error ini muncul sebagai `cron_done` rejected, bukan `cron_failed`.

## Kuota D1 penuh

- Dashboard → Workers & Pages → D1 → database → Metrics → Row Metrics (rows read/written per hari). Free: 5 juta read + 100.000 write per **akun** per hari, storage 5 GB per akun dan 500 MB per database. Sejak 1 September 2026 query gagal saat batas harian terlampaui.
- Cek baris: `SELECT COUNT(*) FROM webhook_logs;`
- Retensi otomatis memangkas `DELIVERED`/`DEAD` lebih dari 30 hari; `FAILED` terjadwal sengaja disimpan.
- Turunkan `DEFAULT_RETENTION_MS` di `apps/worker/src/services/retention.ts` bila perlu, dengan test.
- Bila batas tercapai, transaksi dan callback ikut gagal (muncul sebagai 500 `unhandled_error`). Hentikan pekerjaan non-esensial, jalankan retensi manual, lalu pertimbangkan upgrade plan.

## Panel admin

- `401 ADMIN_UNAUTHORIZED`: sesi kedaluwarsa (TTL 24 jam) atau sudah dicabut. Login lagi dengan email + password + TOTP.
- `403 CSRF_INVALID`: request write tanpa header `X-CSRF-Token` yang cocok. Muat ulang panel lalu login lagi bila token tab hilang.
- `403 FORBIDDEN`: role `viewer` mencoba write data. Viewer tetap boleh mengubah kredensial akunnya sendiri di halaman **Akun**.
- `403 REAUTH_REQUIRED`: aksi sensitif butuh TOTP ulang; panel membuka modal verifikasi. Berlaku 15 menit sejak `reauthenticated_at`.
- `503 ADMIN_NOT_CONFIGURED`: Worker tidak punya service auth sesi (deploy lama/konfigurasi salah). Deploy versi terbaru; auth sesi selalu aktif.
- `SETUP_CLOSED`: `admin_users` sudah terisi. Bootstrap hanya sekali; hapus `ADMIN_SETUP_TOKEN` dengan `wrangler secret delete ADMIN_SETUP_TOKEN`.
- Pengaturan akun sendiri ada di panel **Akun** (`/account`): ubah email, ubah password, dan buat ulang 8 kode pemulihan. Setiap aksi meminta password saat ini; bila sesi belum fresh, panel meminta TOTP ulang (jendela 15 menit). Perubahan email/password mencabut sesi perangkat lain, sesi saat ini tetap aktif.
- Authenticator hilang: login lewat **/recovery** memakai salah satu kode pemulihan (sekali pakai). Setelah masuk, buka **Akun** untuk membuat set kode baru. Bila kode juga habis, owner dapat mereset TOTP admin tersebut dari halaman Admin; owner tunggal tanpa kode harus dipulihkan manual di D1.
- Mencabut semua perangkat: `DELETE FROM admin_sessions WHERE admin_id = '<id>';` lewat D1, atau nonaktifkan user (`UPDATE admin_users SET is_active = 0`).
- Tombol kirim ulang webhook mengubah baris `DEAD`/`FAILED` menjadi jadwal baru (attempt 1, jatuh tempo sekarang); Cron berikutnya mengirim.
- Alias `your-project.pages.dev` mengalihkan ke `https://admin.example.com` lewat `apps/panel/public/host-guard.js` sebelum panel dimuat. Bila alias tidak mengalihkan, pastikan build Pages memuat file itu (cek `dist/host-guard.js`) dan tidak ada cache lama; domain kanonik tidak terpengaruh.

### Audit login dan keamanan

Event auth (`bootstrap:success`, `login:failed`, `totp:failed`, `reauth:success`, dan seterusnya) ditulis ke `admin_audit` di D1 **`DB_AUTH`** dan dibaca lewat endpoint sesi:

```sh
# butuh cookie __Host-gapura_admin milik role owner/admin (viewer ditolak 403).
curl -s -H "Cookie: __Host-gapura_admin=<token>" \
  "https://pay.example.com/sandbox/admin/auth/audit?limit=20"
```

- `limit` default 50, maksimal 100; baris terbaru lebih dulu.
- Route tersedia di `/admin/auth/audit`, `/sandbox/admin/auth/audit`, dan `/production/admin/auth/audit`; semuanya membaca `DB_AUTH` yang sama, bukan D1 environment.
- `GET /admin/audit` tetap berisi aksi admin per environment (project, transaksi, webhook); keduanya saling melengkapi.
- Untuk insiden, query langsung: `wrangler d1 execute gapura-auth --remote --command "SELECT actor_email, action, created_at FROM admin_audit ORDER BY id DESC LIMIT 50"`.

### Pembersihan sesi dan percobaan login

Cron tiap menit menjalankan pemeliharaan auth sekali per invocation (bukan per environment, karena `DB_AUTH` dipakai bersama):

- `admin_sessions` dengan `expires_at <= now` dihapus.
- `admin_login_attempts` lebih tua dari 30 hari dihapus. Retensi ini cukup untuk investigasi insiden dan mencegah rate-limit membaca data basi.

Cek hasil di `wrangler tail`: entri `cron_done` memuat job `admin_maintenance` dengan `loginAttemptsPruned`. Verifikasi manual:

```sh
wrangler d1 execute gapura-auth --remote --command \
  "SELECT (SELECT COUNT(*) FROM admin_sessions) AS sessions,
          (SELECT COUNT(*) FROM admin_login_attempts) AS attempts"
```

## Argon2id dan batas CPU Workers

Ukur ulang di mesin lokal:

```sh
cd apps/worker
pnpm bench:argon2 5
```

Hasil 2026-11-04 (Node 22, Xeon E5-2680 v3, satu core): hash ~382 ms median, verify ~376 ms median. Memory Argon2id ~19 MiB per hash — masih di bawah 128 MB free tier, tetapi tiap login bersamaan menambah pemakaian dan CPU tetap menjadi batas utama.

Workers **free tier** membatasi CPU 10 ms per invocation, jadi `POST /admin/auth/login` dan bootstrap (`hashAdminPassword`) hampir pasti melewati kuota dan gagal dengan error CPU/resource limit. Ini masalah batas plan, bukan bug kode: menurunkan parameter Argon2id sampai di bawah 10 ms akan menghapus proteksi password. Parameter saat ini (`m=19456 KiB, t=2, p=1`) **tidak diubah**.

Opsi operasional:

1. Jalankan Worker auth di **Workers Paid** (CPU limit jauh lebih besar) — pilihan utama bila login harus tetap di Worker.
2. Pindahkan hashing ke layanan terpisah (mis. Durable Object berbayar atau service eksternal) dan pertahankan verifikasi PHC di Worker.
3. Turunkan parameter **hanya** dengan benchmark ulang dan test; tetap tidak realistis untuk 10 ms.

Catat hasil benchmark di tiket/insiden bila mesin atau runtime berubah.

## Eskalasi

Owner tunggal. Untuk insiden yang menyentuh uang atau data pembeli: hentikan rollout project baru, rollback bila perlu, lalu catat di `BUG-HISTORY`/`INCIDENTS` setelah pulih.
