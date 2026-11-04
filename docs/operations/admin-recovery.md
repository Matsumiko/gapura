# Operasional admin: pemulihan TOTP, sesi, dan rate limit

Dokumen ini melengkapi runbook auth. Semua data admin berada di `DB_AUTH`; migrasi
`0006_admin_ops.sql` menambah `admin_recovery_codes` dan `project_rate_limits`.

## Manajemen admin

Endpoint (semua butuh sesi cookie, role `owner`, CSRF, dan reauth TOTP dalam 15 menit):

| Endpoint | Fungsi |
|---|---|
| `GET /admin/admins` | Daftar admin tanpa password/secret |
| `POST /admin/admins` | Buat admin/viewer; mengembalikan password awal + secret TOTP sekali |
| `POST /admin/admins/:id/activate` | Verifikasi kode TOTP; mengaktifkan TOTP dan mengembalikan 8 kode pemulihan sekali |
| `POST /admin/admins/:id/deactivate` | Nonaktifkan admin dan cabut semua sesinya |
| `POST /admin/admins/:id/reset-password` | Password baru (opsional dikirim owner), tampil sekali, cabut sesi |
| `POST /admin/admins/:id/reset-totp` | Secret TOTP baru, TOTP nonaktif sampai aktivasi ulang, hapus kode pemulihan |
| `POST /admin/admins/:id/recovery-codes` | Ganti 8 kode pemulihan; kode lama langsung hangus |

Alur enrollment:

1. Owner membuat admin. Respons berisi `initialPassword`, `secret`, dan `otpauthUri`.
   Ketiganya tidak pernah dikembalikan lagi oleh endpoint lain.
2. Admin memindai `otpauthUri` ke authenticator.
3. Owner memanggil `activate` dengan kode 6 digit. Respons berisi 8 kode pemulihan
   (format `XXXX-XXXX-XXXX-XXXX`) yang hanya tampil sekali.
4. Admin login normal dengan password + TOTP.

Admin tidak bisa menonaktifkan dirinya sendiri; dengan begitu minimal satu owner
(yaitu pelaku) tetap aktif setelah aksi deaktivasi.

## Kode pemulihan TOTP

- 8 kode acak 80 bit per admin, disimpan hanya sebagai hash SHA-256 dengan domain
  separation (`gapura-recovery:`); plaintext tidak pernah disimpan.
- Setiap kode sekali pakai. Konsumsi dilakukan dengan update bersyarat
  (`used_at IS NULL`) agar dua request paralel tidak memakai kode yang sama.
- Login pemulihan: `POST /admin/auth/recovery-login` dengan
  `{ email, password, recoveryCode }`. Password tetap wajib; TOTP tidak dimatikan.
  Respons sama dengan login biasa (cookie sesi + CSRF), dan percobaan dibatasi
  5 kegagalan per 15 menit seperti login TOTP.
- Panel: buka `/recovery` saat tidak login. Halaman login TOTP normal menautkan
  "Masuk dengan recovery code" ke halaman ini.

Alur kehilangan perangkat:

1. Login di `/recovery` memakai satu kode pemulihan.
2. Setelah masuk, minta owner melakukan `reset-totp` (atau owner melakukannya
   langsung), lalu aktivasi ulang dengan authenticator baru.
3. Regenerasi kode pemulihan setelah aktivasi.

Bila semua kode habis dan perangkat hilang, owner wajib mereset TOTP admin tersebut.
Bila owner sendiri terkunci dan tidak punya kode, pemulihan harus lewat prosedur
break-glass D1 di luar panel (hapus `totp_enabled` bukan solusi: login tetap menolak
TOTP yang belum aktif). Catat setiap tindakan manual di insiden.

Catatan: login dengan kode pemulihan menerbitkan sesi baru tanpa status reauth.
Aksi sensitif (manajemen admin, cabut sesi, ubah project/kredensial) tetap butuh
TOTP segar. Owner yang kehilangan authenticator dan memakai kode pemulihan tetap
bisa membaca data, tetapi reset TOTP dirinya sendiri harus dilakukan owner lain
atau lewat break-glass. Karena itu minimal dua owner aktif disarankan.

## Sesi

- `GET /admin/sessions` menampilkan sesi aktif milik sendiri; owner dapat memakai
  `?scope=all`. Field: IP, user agent, dibuat, terakhir dipakai, reauth terakhir.
- `POST /admin/sessions/:id/revoke` mencabut satu sesi (owner boleh sesi admin lain).
- `POST /admin/sessions/revoke-others` mencabut semua sesi lain milik sendiri.
- Sesi tetap berlaku absolut 24 jam (service sesi WS1). Di atas itu, kebijakan idle
  `SESSION_IDLE_TIMEOUT_MS = 2 jam` diterapkan oleh wrapper di `app.ts`: request
  dengan `last_seen_at` lebih lama dari 2 jam ditolak dan sesinya dicabut.
- Baris sesi idle/kedaluwarsa dibersihkan saat daftar sesi diminta. Cron dapat
  memanggil pembersihan yang sama bila ingin pruning proaktif.

## Rate limit `/v1/*`

- Fixed window per project, disimpan di D1 environment masing-masing
  (`project_rate_limits`), dihitung setelah API key tervalidasi.
- Default 120 request per 60 detik per project. Override lewat env Worker
  `RATE_LIMIT_MAX` dan `RATE_LIMIT_WINDOW_SECONDS` (integer > 0).
- Respons 429:
  `{"error":{"code":"RATE_LIMITED","message":"..."},"retryAfterSeconds":N,"resetAt":"ISO"}`,
  plus header `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset`.
- Bila binding D1 tidak tersedia atau query gagal, limit fail-open dan error dicatat
  (`rate_limit_failed_open`) supaya pembayaran tidak ikut gagal.
- Baris window lama dihapus saat window baru dibuat untuk project tersebut.

