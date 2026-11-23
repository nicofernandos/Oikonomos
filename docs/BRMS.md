## 3. Aturan bisnis (BRMS)

### 3.1 Kas

| ID | Aturan |
| --- | --- |
| BR-K01 | Hanya ada empat kas: gereja, pusat, diakonia, pembangunan. Menambah kas membutuhkan migrasi enum dan persetujuan pemilik sistem. |
| BR-K02 | Setiap transaksi tepat satu kas. Perpindahan dana antar kas dicatat sebagai dua transaksi (keluar di asal, masuk di tujuan). **\[Perlu konfirmasi: apakah perpindahan antar kas diizinkan\]** |
| BR-K03 | Saldo kas tidak boleh negatif setelah transaksi keluar. *(usulan, belum dikonfirmasi)* |

### 3.2 Transaksi

| ID | Aturan |
| --- | --- |
| BR-T01 | Nominal adalah bilangan bulat rupiah lebih dari nol. Jenis (masuk atau keluar) menentukan tanda; nominal tidak pernah negatif. |
| BR-T02 | Uraian dan tanggal wajib. Tanggal transaksi tidak boleh melewati tanggal laporan. |
| BR-T03 | Transaksi hanya dapat ditambah ke laporan yang belum terkunci. |
| BR-T04 | Transaksi pada laporan terkunci tidak dapat diubah atau dihapus. Pada laporan terbuka, setiap perubahan tercatat di audit. |
| BR-T05 | Koreksi laporan terkunci dilakukan dengan transaksi penyesuaian di laporan terbuka berikutnya, menunjuk transaksi asal lewat `koreksi_dari`, dengan alasan pada uraian. |

### 3.3 Saldo

| ID | Aturan |
| --- | --- |
| BR-S01 | Saldo kas pada tanggal D = saldo awal kas + jumlah transaksi masuk − jumlah transaksi keluar dari laporan bertanggal sampai D. Saldo tidak pernah menjadi input pengguna. |
| BR-S02 | `saldo_awal` memuat satu baris per kas, per 2026-11-08. Laporan pertama di sistem bertanggal 2026-11-15. Laporan bertanggal sampai 2026-11-08 tidak boleh dibuat. |
| BR-S03 | Kas total = jumlah saldo keempat kas. |
| BR-S04 | `saldo_awal` tidak boleh diubah setelah ada laporan terkunci, kecuali lewat prosedur khusus admin yang tercatat di audit. |

### 3.4 Laporan dan penguncian

| ID | Aturan |
| --- | --- |
| BR-L01 | Satu laporan per tanggal. Tanggal laporan harus hari Minggu. **\[Perlu konfirmasi\]** |
| BR-L02 | Laporan baru hanya dapat dibuat bila laporan sebelumnya sudah terkunci. Tidak boleh ada minggu yang terlewat. |
| BR-L03 | Laporan hanya dapat dikunci setelah rekonsiliasi keempat kas tercatat dan seluruh selisih bernilai nol (tabel keputusan 3.9). |
| BR-L04 | Laporan terkunci bersifat permanen. Tidak ada operasi untuk membukanya kembali. |
| BR-L05 | Penguncian dapat dilakukan bendahara sendiri atau memerlukan persetujuan majelis. Dikendalikan satu pengaturan konfigurasi. **\[Perlu konfirmasi: pilihan awal\]** |
| BR-L06 | Bila persetujuan majelis aktif, pihak yang menyetujui tidak boleh sama dengan pihak yang terakhir menginput transaksi laporan itu. |
| BR-L07 | Bila uang fisik berbeda dari saldo sistem, selisih dicatat sebagai transaksi penyesuaian bertanda selisih lengkap dengan catatan, bukan dengan mengubah saldo. |

### 3.5 Persembahan bulanan

| ID | Aturan |
| --- | --- |
| BR-P01 | Setiap baris persembahan bulanan berpasangan dengan tepat satu transaksi masuk Kas Gereja, dibuat dalam satu transaksi database yang sama. |
| BR-P02 | Bulan persembahan selalu tanggal 1 pada bulan itu. |
| BR-P03 | Total persembahan bulanan sebuah laporan dihitung dari jumlah baris, tidak pernah diketik. |
| BR-P04 | Nama yang sama untuk bulan yang sa### 3.6 Kas Pusat

| ID | Aturan |
| --- | --- |
| BR-U01 | Pemasukan Kas Pusat berstatus titipan sampai disetor. Penyetoran dicatat sebagai transaksi keluar Kas Pusat. **\[Perlu konfirmasi: mekanisme dan status setor\]** |

### 3.7 Akses dan keamanan

| ID | Aturan |
| --- | --- |
| BR-A01 | Peran: admin, bendahara, majelis. Hak sesuai matriks di bagian 2.1. |
| BR-A02 | Hanya admin yang mengelola akun. |
| BR-A03 | Admin tidak boleh menginput atau mengubah transaksi. |
| BR-A04 | Semua endpoint tertutup secara default. Hanya yang bertanda `@Public()` terbuka: login dan health. |
| BR-A05 | Kata sandi minimal 10 karakter dan disimpan sebagai hash, tidak pernah polos. |
| BR-A06 | Pesan gagal login tidak membedakan username tidak ada, akun nonaktif, atau kata sandi salah. |
| BR-A07 | Percobaan login dibatasi lajunya sebelum sistem dibuka ke internet. |
| BR-A08 | Token berlaku 8 jam. Akun nonaktif kehilangan akses paling lambat saat token kedaluwarsa. |

### 3.8 Data, audit, dan operasional

| ID | Aturan |
| --- | --- |
| BR-D01 | Setiap transaksi mencatat pembuat dan waktu pembuatan. |
| BR-D02 | Audit mencatat: pembuatan laporan, rekonsiliasi, penguncian, perubahan akun, dan perubahan saldo awal. |
| BR-D03 | Backup basis data harian ke lokasi lain, dengan uji restore bulanan. |
| BR-D04 | Kata sandi, token, dan data rahasia tidak boleh masuk log. |
| BR-D05 | Skema hanya berubah lewat file migrasi baru. File migrasi yang sudah dijalankan tidak boleh diedit. |

### 3.9 Tabel keputusan penguncian

| Rekonsiliasi lengkap | Selisih | Persetujuan (bila aktif) | Hasil |
| --- | --- | --- | --- |
| Ya | Nol | Ada atau tidak diperlukan | Kunci diizinkan |
| Ya | Nol | Belum ada | Menunggu persetujuan |
| Ya | Tidak nol | Apa pun | Ditolak: catat penyesuaian selisih dulu (BR-L07) |
| Tidak | Apa pun | Apa pun | Ditolak: lakukan rekonsiliasi dulu |

### 3.10 Inventaris (fase 2)

| ID | Aturan |
| --- | --- |
| BR-I01 | `transaksi_id` pada barang bersifat opsional: diisi bila dibeli dari kas, kosong untuk hibah atau titipan. |
| BR-I02 | Perubahan kondisi barang (baik, rusak, hilang) menambah baris riwayat dan tidak menimpa data lama. |
| BR-I03 | Barang yang sedang dipinjam tidak dapat dipinjamkan lagi sebelum dikembalikan. |
| BR-I04 | Setiap barang memiliki lokasi dan penanggung jawab. |ma menghasilkan peringatan, bukan penolakan. *(usulan)* |
