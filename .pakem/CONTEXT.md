# CONTEXT - pintu masuk

Baca file ini PERTAMA di setiap sesi, lalu ikuti routing di bawah. Jangan memuat semua file sekaligus.

## Protokol

Di bawah, `pakem` berarti `python3 .pakem/pakem.py` (di Windows ganti `python3` dengan `python` atau `py -3`).

1. Mulai: `pakem start "<goal>"`. Kalau ada sesi terputus, periksa kondisi repo yang dilaporkan, lalu lanjutkan dari `nextStep`-nya.
2. Kerja per langkah. Di setiap titik berhenti yang wajar: `pakem step "<yang baru selesai>" --next "<langkah berikutnya>"`.
3. Memperbaiki bug: `pakem bug "<judul>" --symptom ... --cause ... --fix ... --prevent ...`, lalu selesai dengan `finish --fixed-bug`.
4. Selesai: `pakem finish --summary "<ringkasan + bukti>"`. Jangan bilang "selesai" sebelum perintah ini exit 0.
5. Saat memilih dokumen/struktur: `pakem audit`. Kerjakan yang WAJIB, tunda yang DISARANKAN dengan alasan, jangan buat yang TIDAK PERLU.
6. Setiap baris `[WARN]` dari check/finish/audit (aturan dilonggarkan, flag risiko diturunkan, verify diubah, CLI dimodifikasi, sesi korup) wajib dilaporkan ke user.

## Routing

| Kalau kamu akan... | Baca dulu |
|---|---|
| mulai tugas apa pun (stack, konvensi, perintah, definisi selesai) | PROJECT.md |
| menambah/mengubah modul, memindah atau menghapus file | MODULE-MAP.md |
| memilih library, pola, atau arsitektur | DECISIONS.md (dan docs/adr/) |
| memperbaiki bug (cek dulu: sudah pernah terjadi?) | BUG-HISTORY.md |

## Aturan tetap

- Requirement ambigu: tanya user atau catat asumsi lewat `step`. Jangan menebak diam-diam.
- Repo lama: ikuti pola yang ada; jangan merombak struktur tanpa diminta.
- Melewati aturan (`skip`) wajib menulis alasannya di `PROJECT.md` (`reason.<nama>`).
- Jangan menyunting gate atau melemahkan aturan supaya `finish` lolos. Perbaiki akar masalahnya.
- Jangan membuat file/dokumen kosong agar struktur terlihat lengkap; tunda dengan alasan.
- Ikuti pola modul yang sudah ada sebelum membuat pola baru.
