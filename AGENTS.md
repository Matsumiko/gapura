<!-- pakem:begin -->
## Pakem - protokol kerja

Proyek ini memakai Pakem. Sumber kebenaran ada di `.pakem/` (blok ini hasil generate; jangan diedit,
regenerasi dengan `pakem adapt`).

Di bawah, `pakem` berarti `python3 .pakem/pakem.py` (di Windows ganti `python3` dengan `python` atau `py -3`).

1. Baca `.pakem/CONTEXT.md` dulu, lalu hanya file yang diarahkan di sana.
2. Mulai: `pakem start "<goal>"`. Jika ada sesi terputus, periksa kondisi repo lalu lanjutkan dari `nextStep`-nya.
3. Selama kerja, di setiap titik berhenti yang wajar:
   `pakem step "<yang baru selesai>" --next "<langkah berikutnya>"`.
4. Selesai: `pakem finish --summary "<ringkasan + bukti>"`.
   Jangan bilang "selesai" sebelum perintah ini exit 0. Kalau kerja ini memperbaiki bug: `pakem bug "<judul>"`
   dulu, lalu `finish --fixed-bug`. Laporkan semua baris [WARN] ke user.
5. Saat memilih dokumen/struktur: `pakem audit`. Kerjakan yang WAJIB, tunda yang DISARANKAN dengan alasan,
   jangan buat file kosong untuk yang TIDAK PERLU.
6. Gate gagal: perbaiki akar masalahnya. Jangan menyunting gate atau melemahkan aturan agar lolos.
7. Requirement ambigu: tanya user atau catat asumsi lewat `step`. Jangan menebak diam-diam.
8. Repo lama: ikuti pola yang sudah ada; jangan merombak struktur kecuali diminta.
<!-- pakem:end -->
