# Backup dan pemulihan

## Prasyarat

- `pg_dump` dan `pg_restore` tersedia dan versinya kompatibel dengan server PostgreSQL.
- Inject konfigurasi lewat environment dari pengelola layanan/secrets. Script backup tidak membaca atau mencetak `.env`.
- Tentukan tujuan terpisah dari server aplikasi: volume backup terpasang, penyimpanan jaringan, atau proses upload terpisah yang dienkripsi. Script tidak dapat membuktikan bahwa sebuah path benar-benar berada di server lain.

## Backup harian

Jalankan `npm run backup` dengan:

- `DATABASE_URL`: koneksi database sumber.
- `BACKUP_DIRECTORY`: path absolut direktori tujuan backup.

Hasil sukses adalah path arsip custom-format `.dump`. File ditulis melalui `.partial` lalu rename setelah pg_dump berhasil, dengan mode 0600. Tidak ada retensi/penghapusan otomatis. Atur enkripsi, retensi, pemantauan kegagalan, dan kapasitas penyimpanan pada infrastruktur deployment.

Jadwalkan setiap hari melalui scheduler deployment (systemd timer, cron, atau scheduler hosting), dengan working directory root backend dan environment aman. Jangan menulis URL berpassword ke command crontab atau log. Jadwal deployment sengaja belum dipasang karena tujuan backup terpisah dan platform deployment belum diberikan.

## Uji restore bulanan

1. Buat database kosong khusus uji restore. Jangan gunakan database operasional.
2. Jalankan `npm run backup:restore-check` dengan:
   - `BACKUP_FILE`: path arsip .dump.
   - `RESTORE_DATABASE_URL`: koneksi ke database kosong tersebut.
   - `DATABASE_URL`: sumber asli, untuk pemeriksaan tambahan bahwa target berbeda.
3. Script menolak database yang sudah mempunyai tabel pengguna. Restore memakai transaksi tunggal, berhenti bila ada error, dan tidak menggunakan --clean.
4. Script memastikan tabel bisnis dapat dibaca dan melaporkan jumlah baris tanpa isi sensitif. Operator selanjutnya mencocokkan saldo empat kas, jumlah laporan, dan laporan terakhir terkunci dengan sumber/bukti bendahara.
5. Catat hasil dan tanggal uji; hapus database uji melalui prosedur operator setelah selesai.

Script tidak menghapus atau mengganti database sumber. Penolakan target nonkosong adalah pengaman, bukan pengganti pemeriksaan target oleh operator.

## Bukti otomatis

`test/backup.e2e-spec.ts` menjalankan pg_dump dan pg_restore sungguhan pada dua database sementara, membandingkan nominal BIGINT di luar rentang aman JavaScript, memeriksa izin file, dan memastikan restore ulang ke target nonkosong ditolak. Test ini tidak membuktikan backup harian di server produksi sudah dijadwalkan atau tujuan off-host tersedia.
