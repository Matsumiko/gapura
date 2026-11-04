# 0010. Auth admin: sesi opaque, TOTP wajib, RBAC, step-up

- Status: diterima (diimplementasikan 2026-11-04)
- Tanggal: 2026-11-04
- Menggantikan: ADR-0007 (token Bearer statis)

## Konteks
Token admin statis tidak punya identitas, MFA, masa sesi, atau pencabutan per perangkat. Untuk panel yang bisa merotasi kredensial dan mengirim ulang webhook, model itu terlalu lemah. Owner meminta auth stateful: opaque session + TOTP wajib + RBAC + step-up reauth, dibangun bertahap.

## Keputusan

### Sesi
- Token 32 byte acak (base64url), dikirim sekali lewat cookie. Database hanya menyimpan SHA-256 dari token.
- Cookie `__Host-gapura_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, tanpa `Domain`, TTL 24 jam. Berlaku karena panel dan API sama-site di `duit.cc.cd`; alias `pages.dev` harus redirect ke domain kanonik.
- Tabel `admin_sessions`: id, admin_id, token_hash, csrf_hash, ip, user_agent, expires_at, last_seen_at, reauthenticated_at, created_at.
- CSRF token per sesi (random), dikirim di body login, disimpan panel di memori/sessionStorage, wajib di header untuk POST/PUT/PATCH/DELETE. Server menyimpan hash-nya.
- Logout menghapus baris sesi; sesi kedaluwarsa dibersihkan saat validasi/login.

### Password & TOTP
- Argon2id (`@noble/hashes`): t=2, m=19456 KiB, p=1, dkLen=32, salt 16 byte, format PHC. Password minimal 12 karakter.
- TOTP RFC 6238 SHA-1, 6 digit, langkah 30 detik, toleransi ±1 langkah, `totp_last_counter` mencegah replay. Secret TOTP disimpan terenkripsi AES-GCM dengan `CREDENTIALS_KEY` (pola ADR-0008).
- Enrollment wajib sebelum akses operasional. Recovery codes ber-hash sekali pakai (fase lanjut).

### Bootstrap & akses
- Selama `admin_users` kosong, `POST /admin/auth/bootstrap` menerima `ADMIN_SETUP_TOKEN` (secret sementara) + email/password + TOTP; setelah owner aktif, endpoint menolak dan secret dihapus.
- RBAC `owner`/`admin`/`viewer`; write butuh owner/admin + step-up.
- Step-up: TOTP ulang, mengisi `reauthenticated_at` (berlaku 15 menit) untuk aksi sensitif: rotasi key/secret, simpan kredensial, retry webhook, nonaktifkan project.
- Rate limit login/TOTP per akun + IP di `admin_login_attempts`.
- Audit: login sukses/gagal, TOTP gagal, reauth, logout, perubahan sensitif; tanpa secret.

## Tahapan
1. **Fondasi (selesai):** migrasi `0005_admin_auth.sql`, modul Argon2id dan TOTP + vektor uji.
2. **Sesi & login (selesai):** service sesi, route bootstrap/login/logout/session/reauth, middleware cookie+CSRF, panel status/setup/login/TOTP/enrollment/logout.
3. **Otorisasi (selesai):** RBAC owner/admin/viewer, step-up 15 menit pada aksi sensitif, rate limit login/TOTP per akun + IP, token statis dihapus dari Worker, test, dan panel.
4. **Selesai pengukuran:** CPU Argon2id diukur 2026-11-04 (`pnpm bench:argon2`): ~382 ms hash / ~376 ms verify di x64 lokal, jauh di atas CPU 10 ms Workers free tier; parameter tidak diturunkan dan auth memerlukan Workers Paid atau hashing di luar Worker. **Belum:** recovery codes TOTP.

## Konsekuensi
- Positif: sesi bisa dicabut per perangkat, ada identitas dan MFA, CSRF eksplisit, audit lengkap.
- Negatif: D1 menjadi ketergantungan auth (gangguan D1 = tidak bisa login); Argon2id CPU lebih berat (ukur di free tier; bila melebihi batas, turunkan parameter atau pindah ke bcrypt dengan rate limit lebih ketat).
- Negatif: `SameSite=Strict` membuat panel hanya bisa dipakai di domain kanonik, bukan `pages.dev`.
- Yang harus dijaga: `CREDENTIALS_KEY` untuk secret TOTP, kolom token/CSRF hanya hash, pembaruan `reauthenticated_at` setelah step-up (token sesi tidak dirotasi), dan pembersihan sesi kedaluwarsa.
- Catatan implementasi: bootstrap memakai `ADMIN_SETUP_TOKEN` dan hanya berjalan selama `admin_users` kosong; hapus secret itu setelah owner dibuat. Panel memakai cookie HttpOnly dan hanya menyimpan CSRF token di sessionStorage. Belum ada recovery code; kehilangan authenticator butuh pemulihan manual. CPU Argon2id (m=19456 KiB, t=2) terukur ~376–382 ms per operasi di x64 lokal (2026-11-04), sehingga login/bootstrap tidak realistis di Workers free tier (10 ms CPU); lihat `RUNBOOK.md`.
