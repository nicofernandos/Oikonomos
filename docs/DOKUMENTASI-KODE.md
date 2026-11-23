# Dokumentasi implementasi backend Oikonomos

Dokumen lokal untuk memahami kode yang sudah diimplementasikan. Dokumen ini tidak disertakan dalam commit code-only. Ringkasan ini merujuk pada implementasi di `src/`, `migrations/`, `scripts/`, dan `test/`, bukan rancangan fitur yang belum dibuat. Dokumen perencanaan lain dapat berbeda dari kondisi kode saat ini.

## 1. Stack dan bootstrap

- NestJS 12, TypeScript ESM, PostgreSQL melalui driver `pg`; tidak menggunakan ORM.
- Import relatif TypeScript memakai akhiran `.js` untuk hasil kompilasi ESM.
- `src/main.ts` membuat aplikasi, menambahkan prefix `/api`, memasang `ValidationPipe({ whitelist: true, transform: true })`, dan mendengarkan `PORT` atau 3000.
- `src/app.module.ts` menggabungkan modul autentikasi, keuangan, inventaris, konfigurasi, dan database.
- Hasil kompilasi berada di `dist/`; hasil build bukan bagian dari perubahan code-only ini.

## 2. Tanggung jawab lapisan

| Lapisan | Tanggung jawab | Contoh |
| --- | --- | --- |
| Controller | Menerima HTTP, body, parameter, dan pengguna terautentikasi | `src/inventaris/inventaris.controller.ts` |
| DTO/parser | Memvalidasi bentuk dan nilai input | `src/keuangan/dto/finance.dto.ts` |
| Service | Memeriksa hak akses dan mengoordinasikan operasi | `src/keuangan/keuangan.service.ts` |
| Repository | Menjalankan SQL dan operasi domain transaksional | `src/keuangan/keuangan.repository.ts` |
| Database service | Pool, query berparameter, transaksi, konteks aktor | `src/database/database.service.ts` |
| Migrasi | Skema, constraint, trigger, metadata, retensi | `migrations/*.sql` |

Autentikasi masih memiliki beberapa query langsung di `AuthService`; tidak semua SQL aplikasi berada di repository.

## 3. Autentikasi dan pengguna

File utama: `src/auth/auth.module.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `login-throttle.guard.ts`, `password-hasher.ts`, `users.repository.ts`, dan `users.controller.ts`.

- Dua global guard menangani pembatasan login dan autentikasi JWT. Rute publik ditandai dengan decorator `Public`.
- JWT memakai HS256, issuer `oikonomos`, audience `oikonomos-api`, masa berlaku 28800 detik. `JWT_SECRET` wajib minimal 32 byte.
- Subject token menunjuk ID pengguna. Pengguna harus masih aktif dan tidak soft-deleted.
- Password di-hash menggunakan scrypt melalui `PasswordHasher`; hash tidak menjadi bagian respons pengguna publik.
- Admin mengelola pengguna. Pengguna terautentikasi dapat mengganti password sendiri.
- Parameter ID pada update dan reset password pengguna harus desimal positif kanonik dalam batas PostgreSQL INTEGER; alias seperti heksadesimal, eksponen, tanda plus, dan nol awal ditolak.
- DTO nama pengguna menolak NUL dan surrogate Unicode tidak berpasangan; emoji valid tetap diterima.

Rute relatif terhadap `/api`:

| Method | Path | Keterangan |
| --- | --- | --- |
| POST | `/auth/login` | Publik; login, status sukses 200 |
| GET | `/auth/me` | Profil pengguna terautentikasi |
| POST | `/auth/users` | Alias pembuatan pengguna oleh admin |
| PATCH | `/auth/password` | Mengganti password sendiri |
| GET | `/users` | Daftar pengguna, admin |
| POST | `/users` | Membuat pengguna, admin |
| PATCH | `/users/:id` | Memperbarui pengguna, admin |
| POST | `/users/:id/reset-password` | Reset password oleh admin, status sukses 200 |

## 4. Modul keuangan

File utama: `src/keuangan/keuangan.controller.ts`, `keuangan.service.ts`, `keuangan.repository.ts`, dan `dto/finance.dto.ts`.

Empat kas: `gereja`, `pusat`, `diakonia`, `pembangunan`.

Alur utama:

1. Saldo awal keempat kas per 2026-11-08 harus tersedia sebelum operasi yang memerlukannya.
2. Bendahara membuat laporan hari Minggu secara berurutan; laporan sebelumnya harus terkunci. Laporan pertama yang diharapkan adalah 2026-11-15.
3. Bendahara mencatat transaksi dan persembahan. Persembahan juga membuat transaksi pemasukan terkait.
4. Saldo dihitung dari saldo awal dan transaksi pada laporan sampai tanggal yang diminta; bukan saldo yang diketik klien.
5. Rekonsiliasi menyimpan saldo sistem dan saldo fisik. Nilai sistem dan selisih harus muat dalam BIGINT; jika tidak, API menolak dengan konflik sebelum insert atau audit.
6. Laporan hanya dapat dikunci setelah rekonsiliasi keempat kas lengkap, tidak kedaluwarsa, dan selisih nol.
7. `REQUIRE_MAJELIS_APPROVAL=true` memberikan kewenangan penguncian kepada majelis; selain itu bendahara yang mengunci. Konfigurasi selain string `true`/`false` atau tidak diisi ditolak.

Operasi tulis mengunci baris laporan dan memakai transaksi database. Pembuatan/penguncian laporan juga menggunakan advisory lock. Koreksi transaksi mengikuti aturan laporan terkunci sebelumnya dan laporan terbuka berikutnya.

Rute: GET/POST `/laporan`, GET `/laporan/:id`, POST `/laporan/:id/transaksi`, `/persembahan`, `/rekonsiliasi`, `/kunci`, dan GET `/saldo?tanggal=YYYY-MM-DD`.

Nilai uang BIGINT dibawa sebagai string desimal pada batas database/JSON agar tidak kehilangan presisi. Perhitungan memakai `BigInt`. Input angka JSON hanya diterima bila aman sebagai integer; klien sebaiknya menggunakan string nominal. ID laporan memakai INTEGER, sedangkan ID transaksi BIGINT dipertahankan sebagai string.

## 5. Modul inventaris

File utama: `src/inventaris/inventaris.controller.ts`, `inventaris.service.ts`, `inventaris.repository.ts`, `inventaris.types.ts`, dan `dto/inventaris.dto.ts`.

- `InventarisModule` mendaftarkan controller, service, repository, dan dependensi database; modul ini diimpor oleh AppModule.
- Semua pengguna aktif dapat membaca inventaris; hanya admin dapat menulis.
- ID barang dan peminjaman berupa string desimal positif dalam batas BIGINT.
- Data barang: `kode`, `nama`, `lokasi`, `penanggung_jawab`, `keterangan`, `transaksi_id`, dan kondisi awal.
- Kondisi yang didukung: `baik`, `rusak`, `hilang`; kondisi awal default `baik`. Perubahan kondisi menggunakan endpoint tersendiri dengan catatan.
- Parser menolak field asing, ID tidak valid, tanggal tidak valid, dan NUL pada teks. Metadata pelaku tidak diambil dari body klien.
- Peminjaman dan pengembalian dicatat terpisah. Barang dengan peminjaman aktif tidak dapat dihapus; peminjaman aktif ganda ditolak.
- Penghapusan adalah soft-delete; barang dapat dipulihkan.

Rute relatif terhadap `/api/inventaris`:

| Method | Path | Operasi |
| --- | --- | --- |
| GET / POST | `/` | Daftar / buat barang |
| GET / PATCH / DELETE | `/:id` | Detail / ubah metadata / soft-delete |
| POST | `/:id/pulihkan` | Pulihkan barang |
| GET | `/:id/riwayat-kondisi` | Riwayat kondisi |
| POST | `/:id/kondisi` | Ubah kondisi dengan catatan |
| GET / POST | `/:id/peminjaman` | Daftar / buat peminjaman |
| POST | `/:id/peminjaman/:loanId/kembali` | Catat pengembalian |

## 6. Database, audit, dan retensi

`DatabaseService.query()` mengembalikan array baris. `withTransaction(callback, actorId?)` menjalankan BEGIN, menetapkan `oikonomos.actor_id` secara transaction-local bila tersedia, lalu COMMIT atau ROLLBACK dan selalu melepaskan client. Aktor berasal dari autentikasi server.

Migrasi mencakup tabel pengguna dan persembahan, integritas keuangan/audit, metadata dan soft-delete, serta inventaris. Jalankan migrasi sesuai urutan nama berkas. Trigger metadata dan retensi merupakan bagian perilaku aplikasi, bukan sekadar atribut TypeScript.

Saat menguji migrasi metadata terhadap data lama, terapkan hanya migrasi yang lebih awal, masukkan data lama, kemudian jalankan migrasi yang diuji. Migrasi inventaris yang lebih baru memerlukan fungsi metadata, sehingga tidak boleh dijalankan sebelum fungsi tersebut tersedia.

## 7. Konfigurasi dan script

Jangan menyimpan nilai kredensial dalam dokumentasi atau commit.

| Variabel | Fungsi |
| --- | --- |
| `DATABASE_URL` | Koneksi database aplikasi |
| `JWT_SECRET` | Kunci JWT, minimal 32 byte |
| `PORT` | Port HTTP, default 3000 |
| `REQUIRE_MAJELIS_APPROVAL` | Mengaktifkan persetujuan majelis saat penguncian |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAMA` | Bootstrap admin |
| `OIKONOMOS_TEST_DATABASE_URL` | Koneksi database khusus pengujian |
| `BACKUP_FILE`, `RESTORE_DATABASE_URL` | Arsip dan target kosong khusus pemeriksaan restore |

Perintah dari root backend:

- `npm run build`: kompilasi aplikasi.
- `npm run start:dev`: development dengan watch.
- `npm run migrate -- up`: migrasi database; script memakai dotenv untuk memuat konfigurasi lokal.
- `npm run create:admin`: build, lalu bootstrap admin dan audit dalam transaksi; username yang sudah dipakai tidak ditimpa.
- `npm run backup`: jalankan script backup PostgreSQL.
- `npm run backup:restore-check`: restore arsip ke target kosong yang berbeda dari sumber. Script memeriksa jumlah baris tujuh tabel inti; pemeriksaan ini sendiri bukan bukti lengkap seluruh isi inventaris.

Script backup/restore membutuhkan utilitas PostgreSQL yang sesuai. Jangan menjalankannya terhadap target produksi tanpa prosedur operasional yang disetujui.

## 8. Pengujian dan batas verifikasi

- `npm test`: unit, repository seam, dan HTTP dengan SQL mock.
- `npm run lint`: oxlint type-aware.
- `npm run build`: kompilasi NestJS.
- `npm run test:e2e`: pengujian integrasi PostgreSQL, inventaris, retensi, backup, dan matriks route.

Suite PostgreSQL memerlukan `OIKONOMOS_TEST_DATABASE_URL`, nama database berakhiran `_test`, dan menggunakan schema acak. Tanpa URL pengujian, suite terkait dilewati. Jangan mengganti variabel ini dengan koneksi produksi.

Hasil verifikasi implementasi sebelum penyusunan dokumen ini: 185 unit test dan 76 E2E PostgreSQL lulus; build lulus; lint selesai dengan tiga warning `no-control-regex`. E2E dijalankan pada PostgreSQL sementara terpisah, bukan database aplikasi. Hasil tersebut tidak membuktikan kondisi deployment produksi.

## 9. Cakupan commit code-only

Perubahan yang disertakan: `src/`, `test/`, `migrations/`, `scripts/`, `package.json`, dan `package-lock.json` yang terkait implementasi.

Perubahan yang tidak disertakan: dokumentasi lokal `docs/`, file environment, dependency terpasang `node_modules/`, hasil build `dist/`, dan cache TypeScript. Dokumen yang sudah ada pada commit awal tidak dihapus dari riwayat; pengecualian berlaku untuk perubahan commit implementasi ini.
