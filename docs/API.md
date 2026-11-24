# API fase 1 Oikonomos

Implementasi mengikuti `BRD.md`, `BRMS.md`, dan `PRD.Md`. Dokumen sumber tidak diubah. Fase 1b (export PDF/Excel dan UI audit) serta fase 2 (inventaris) tidak diaktifkan. Scaffold `/keuangan` dan `/inventaris` bukan API bisnis yang siap pakai.

## Autentikasi dan akun

Semua endpoint memerlukan `Authorization: Bearer <token>`, kecuali `POST /api/auth/login` dan `GET /api/health`. Root `/api` juga dilindungi.

- `POST /api/auth/login`: `{ "username": "...", "password": "..." }`; JWT berlaku 28.800 detik (8 jam).
- `GET /api/auth/me`: profil pengguna aktif tanpa hash password.
- `PATCH /api/auth/password`: `{ "currentPassword": "...", "newPassword": "..." }`.
- `GET /api/users`: daftar akun, hanya admin.
- `GET /api/users/:id`: detail akun berdasarkan ID, hanya admin; akun tidak ditemukan atau soft-deleted menghasilkan 404. Respons tanpa password/hash.
- `POST /api/users`: `{ "username": "...", "password": "...", "nama": "...", "peran": "admin|bendahara|majelis" }`, hanya admin.
- `PATCH /api/users/:id`: perubahan nama, peran, atau status `aktif`, hanya admin.
- `POST /api/users/:id/reset-password`: `{ "password": "..." }`, hanya admin.

Kata sandi minimal 10 karakter; scrypt, salt unik, dan rate limit tetap digunakan. Akun nonaktif ditolak pada permintaan berikutnya, bukan menunggu token habis. Perubahan akun diaudit tanpa kata sandi/hash/token.

## Keuangan

Kontrak body dan hasil rinci: `API-KEUANGAN.md`.

- `GET /api/laporan`
- `POST /api/laporan`
- `GET /api/laporan/:id`
- `POST /api/laporan/:id/transaksi`
- `POST /api/laporan/:id/persembahan`
- `POST /api/laporan/:id/rekonsiliasi`
- `POST /api/laporan/:id/kunci`
- `GET /api/saldo?tanggal=YYYY-MM-DD`

Admin dan majelis dapat membaca. Hanya bendahara yang menginput data keuangan. Majelis hanya berperan dalam penguncian bila persetujuan diaktifkan. Tidak ada endpoint DELETE transaksi atau pembukaan ulang laporan terkunci.

Nominal respons berupa string desimal rupiah agar BIGINT tidak dibulatkan JavaScript. Klien tidak boleh mengonversi nominal besar ke Number. Tanggal bisnis menggunakan YYYY-MM-DD, bukan timestamp zona waktu.

## Migrasi dan saldo awal

1. Pastikan backup tersedia dan periksa status migrasi instalasi Anda.
2. Jalankan `npm run migrate -- up` menggunakan konfigurasi database deployment. Migrasi baru `1794930000000_integritas-keuangan-dan-audit.sql` menambah audit, rekonsiliasi, atribusi pengguna, koreksi, dan trigger perlindungan laporan terkunci. Migrasi lama tidak diubah oleh implementasi ini.
3. Sebelum laporan pertama, operator memverifikasi saldo asli per 2026-11-08 bersama bendahara dan memasukkan empat baris `saldo_awal` untuk gereja, pusat, diakonia, pembangunan. Tidak ada seed uang rekaan. Simpan bukti verifikasi. Input saldo awal adalah proses bootstrap database, bukan endpoint transaksi. Dalam transaksi database bootstrap, tetapkan `SET LOCAL oikonomos.actor_id` ke ID admin yang benar agar audit mengaitkan operator aplikasi. Trigger mencatat nilai sebelum/sesudah dan pengguna database; bila actor_id tidak ditetapkan, kolom siapa NULL dan identitas database tetap tersimpan.
4. Laporan pertama 2026-11-15. Saldo awal tidak dapat diubah setelah ada laporan terkunci. Prosedur pengecualian admin tidak dibuka lewat API biasa; koreksi sehari-hari menggunakan transaksi penyesuaian.

Uji otomatis memakai data sintetis hanya di database uji terisolasi. Tidak ada migrasi yang otomatis dijalankan ke database operasional.

## Keputusan sementara yang perlu persetujuan pemilik

- Laporan dibuat pada hari Minggu dan harus berurutan tanpa minggu terlewat.
- `REQUIRE_MAJELIS_APPROVAL=false` sebagai default. Set `true` untuk meminta penguncian oleh majelis yang bukan penginput transaksi terakhir. Jangan mengganti pengaturan saat proses persetujuan sedang berlangsung.
- Transfer antar-kas belum memiliki endpoint khusus; keputusan boleh/tidaknya transfer masih terbuka dalam BRMS.
- Larangan saldo negatif masih usulan dalam BRMS; lihat perilaku implementasi rinci di kontrak keuangan.
- Duplikasi nama/bulan persembahan memberi peringatan, bukan penolakan, mengikuti usulan BR-P04 yang teksnya terpotong dalam dokumen sumber.
- Mekanisme status penyetoran kas pusat belum ditentukan; gunakan pencatatan masuk/keluar kas pusat, tanpa mengklaim ada workflow setoran terpisah.
- Tenggat penguncian mingguan, akses audit majelis, dan target waktu input masih menunggu keputusan bisnis.

## Verifikasi

- `npm run test`
- `npm run lint`
- `npm run build`
- `OIKONOMOS_TEST_DATABASE_URL=<URL database khusus bernama *_test> npm run test:e2e`

E2E PostgreSQL tidak memakai DATABASE_URL operasional. Schema aplikasi uji terisolasi dibuat/dihapus otomatis. Uji backup membuat dua database sementara; akun pengujian memerlukan izin CREATE DATABASE. Bila OIKONOMOS_TEST_DATABASE_URL tidak diberikan, tes PostgreSQL ditandai skipped, bukan dianggap telah memverifikasi database.

Petunjuk backup dan uji restore: `OPERASIONAL.md`.

## Metadata dan retensi

Seluruh tabel bisnis memiliki `updated_at/by`, `modified_at/by`, `deleted_at/by`, dan `is_deleted`. Metadata diisi otomatis oleh database menggunakan pelaku dari transaksi terautentikasi. Record soft-delete tetap tersimpan tetapi tidak dimunculkan dalam pembacaan normal. Laporan terkunci tetap permanen; audit log bersifat append-only. Tidak ada endpoint penghapusan baru. Aturan dan prosedur lengkap: `RETENSI-DATA.md`.
