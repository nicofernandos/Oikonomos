# Metadata perubahan dan retensi data

## Cakupan

Migrasi baru `1794930000001_metadata-dan-soft-delete.sql` menambahkan metadata pada seluruh tabel bisnis yang saat ini ada:

- `users`
- `laporan_mingguan`
- `transaksi`
- `saldo_awal`
- `persembahan_bulanan`
- `rekonsiliasi`
- `audit_log`

`pgmigrations` adalah ledger migrasi milik node-pg-migrate, bukan tabel bisnis. Tabel ini tidak diubah. Modul inventaris belum memiliki tabel produksi dalam skema fase 1.

## Kolom

| Kolom | Tipe | Makna |
| --- | --- | --- |
| `updated_at` | TIMESTAMPTZ, NOT NULL | Waktu penulisan terakhir yang dicatat sistem |
| `updated_by` | INT, nullable, FK users | ID pengguna pelaku penulisan terakhir |
| `modified_at` | TIMESTAMPTZ, NOT NULL | Alias updated_at sesuai permintaan; nilainya sama |
| `modified_by` | INT, nullable, FK users | Alias updated_by; nilainya sama |
| `deleted_at` | TIMESTAMPTZ, nullable | Waktu record ditandai terhapus secara logis |
| `deleted_by` | INT, nullable, FK users | ID pengguna yang menandai record terhapus |
| `is_deleted` | BOOLEAN, NOT NULL, default false | Penanda soft-delete; baris tetap ada |

Kolom `dibuat_pada`, `dibuat_oleh`, `dikunci_pada`, `dikunci_oleh`, dan metadata bisnis lain yang sudah ada tetap dipertahankan.

Data lama tidak dihapus atau dibuatkan identitas pelaku rekaan. Timestamp baru pada data lama menunjukkan saat metadata mulai diperkenalkan melalui migrasi, bukan bukti waktu perubahan historis. Kolom by tetap NULL bila identitas historis tidak diketahui.

## Pengisian otomatis

Trigger database mengisi metadata. Penulisan dari API memakai ID pengguna yang telah lolos autentikasi, bukan nilai updated_by/deleted_by dari body request.

Repository meneruskan actor ID melalui `DatabaseService.withTransaction(callback, actorId)`. Konteks `oikonomos.actor_id` berlaku hanya dalam transaksi tersebut, sehingga pelaku tidak terbawa ke permintaan berikutnya pada connection pool.

Penulisan SQL pemeliharaan tanpa actor ID tidak mengarang pengguna aplikasi: kolom by dapat NULL. Operator wajib menetapkan actor ID yang benar saat melakukan tindakan administratif agar pelakunya tercatat. Jangan mempercayai body klien untuk menetapkan identitas ini.

Bentuk respons API yang sudah ada tetap kompatibel; metadata disimpan di database, tidak otomatis diekspos oleh setiap endpoint.

## Soft-delete dan pemulihan

- Soft-delete dilakukan dengan perubahan `is_deleted` dari false ke true. Database otomatis mengisi deleted_at dan deleted_by.
- Baris asli, ID, relasi, dan isi record tetap tersimpan. Hapus fisik melalui DELETE serta pengosongan TRUNCATE ditolak pada tabel bisnis.
- Record yang sudah soft-delete tidak dapat diedit seperti record aktif. Pemulihan harus dilakukan secara eksplisit dengan mengubah is_deleted kembali ke false.
- Pemulihan membersihkan deleted_at dan deleted_by pada baris aktif; riwayat delete/restore tetap tercatat di audit_log.
- Username, tanggal laporan, dan pasangan rekonsiliasi yang memiliki batasan unik tetap dipesan oleh record lama. Soft-delete bukan cara melewati batasan unik. Pulihkan record yang sama, bukan membuat duplikat tersembunyi.
- Pembacaan normal akun dan keuangan menggunakan record aktif saja. Akun soft-delete tidak bisa login atau memakai bearer token lama, walaupun aktif masih true.
- Transaksi soft-delete tidak dihitung dalam saldo normal; pemulihannya mengembalikan kontribusi transaksi tersebut. Ini hanya berlaku bila aturan laporan masih mengizinkan perubahan.

Tidak ada endpoint DELETE/restore baru dalam perubahan ini. Penandaan/pemulihan adalah prosedur pemeliharaan database terkontrol, bukan jalan pintas untuk mengubah laporan final.

## Batasan integritas yang tetap berlaku

- Laporan terkunci dan seluruh detail keuangannya tetap tidak dapat diubah, termasuk melalui is_deleted. Koreksi dilakukan dengan transaksi penyesuaian pada laporan terbuka berikutnya.
- Saldo awal tetap tidak dapat diubah setelah ada laporan terkunci.
- Laporan dengan detail aktif tidak boleh disembunyikan dengan menandai laporan saja.
- Persembahan dan transaksi pasangannya tidak boleh ditandai terhapus secara sepihak, karena akan membuat catatan persembahan dan saldo tidak konsisten.
- Laporan mingguan yang ditandai terhapus harus dipulihkan terlebih dahulu sebelum rantai laporan dilanjutkan; minggu tidak boleh dilewati secara diam-diam.
- Rekonsiliasi soft-delete harus dipulihkan sebelum slot laporan/kas yang sama diperbarui kembali. Empat rekonsiliasi aktif tetap wajib sebelum penguncian.
- `audit_log` memiliki seluruh kolom metadata, tetapi bersifat append-only. UPDATE, soft-delete, DELETE, dan TRUNCATE ditolak agar bukti perubahan tidak dapat dihilangkan lewat operasi aplikasi biasa.

Pengaman DML tidak menggantikan kontrol akses database, backup, dan retensi off-host. Administrator database berprivilege tinggi tetap dapat mengubah skema atau menonaktifkan trigger; batasi kredensial aplikasi sesuai lingkungan deployment.

Rollback migrasi metadata ditolak bila masih ada record soft-delete, agar status tombstone tidak hilang dan record tidak aktif kembali tanpa sengaja. Baris audit historis tidak dihapus oleh rollback. Jangan menjalankan rollback sebagai cara membersihkan data.

## Verifikasi

`npm run test` memeriksa penerusan actor ID dan filter record aktif. Jalankan `OIKONOMOS_TEST_DATABASE_URL=<URL database khusus *_test> npm run test:e2e` untuk memeriksa metadata dan perlindungan retensi dengan PostgreSQL asli, serta regresi alur keuangan dan backup/restore.
