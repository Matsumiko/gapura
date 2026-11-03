# 0010. Auth admin: sesi opaque, TOTP wajib, RBAC, step-up

- Status: diterima (implementasi bertahap)
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
2. **Sesi & login:** service sesi, route bootstrap/login/logout/session/reauth, middleware cookie+CSRF, panel login/TOTP/enrollment.
3. **Otorisasi:** RBAC, step-up pada aksi sensitif, rate limit, recovery codes; hapus `ADMIN_TOKEN` dan token statis dari panel.

## Konsekuensi
- Positif: sesi bisa dicabut per perangkat, ada identitas dan MFA, CSRF eksplisit, audit lengkap.
- Negatif: D1 menjadi ketergantungan auth (gangguan D1 = tidak bisa login); Argon2id CPU lebih berat (ukur di free tier; bila melebihi batas, turunkan parameter atau pindah ke bcrypt dengan rate limit lebih ketat).
- Negatif: `SameSite=Strict` membuat panel hanya bisa dipakai di domain kanonik, bukan `pages.dev`.
- Yang harus dijaga: `CREDENTIALS_KEY` untuk secret TOTP, kolom token/CSRF hanya hash, rotasi sesi setelah step-up, dan pembersihan sesi kedaluwarsa.
