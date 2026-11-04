# Contributing

Terima kasih sudah membantu Gapura.

## Sebelum mulai

- Baca `README.md` untuk setup lokal.
- Jangan pernah menaruh kredensial, API key, token Cloudflare, atau data pembeli asli di issue, PR, log, atau test fixture.
- Laporkan celah keamanan secara privat sesuai `SECURITY.md`, bukan lewat issue publik.

## Alur kerja

1. Buat branch dari `main`.
2. Jalankan `pnpm install` dan siapkan config dari file `.example` (lihat README).
3. Tulis test untuk perubahan perilaku, lalu jalankan `pnpm verify`.
4. Buat PR kecil dengan penjelasan masalah, pendekatan, dan bukti verifikasi.
5. Jangan mengubah migrasi yang sudah dirilis; tambahkan migrasi baru.

## Gaya kode

- TypeScript, modul kecil, dan tipe eksplisit di batas sistem.
- Query D1 hanya lewat repository dan selalu memakai parameter binding.
- Validasi input di batas HTTP memakai skema Zod di `packages/shared`.
- Pesan error ke pengguna memakai bentuk `{"error":{"code":"...","message":"..."}}`.
- Jangan menambah dependency tanpa alasan yang jelas.

## Commit

Gunakan pesan ringkas yang menjelaskan perubahan, misalnya `fix(payments): ...` atau `docs: ...`. Sertakan cara verifikasi di badan commit/PR bila relevan.
