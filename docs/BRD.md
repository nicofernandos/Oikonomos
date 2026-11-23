## 1. BRD (Business Requirements Document)

### 1.1 Latar belakang

Laporan keuangan jemaat dibuat mingguan di atas kertas dan difoto untuk dibagikan lewat WhatsApp. Laporan memuat empat kas terpisah (Kas Gereja, Kas Pusat, Diakonia, Pembangunan), daftar persembahan bulanan, ucapan syukur, dan pengeluaran. Saldo minggu lalu dibawa manual ke minggu berikutnya.

Masalah yang teridentifikasi dari laporan 8 November 2026:

- Rantai saldo bergantung pada penjumlahan manual, sehingga satu salah hitung terbawa ke semua minggu berikutnya.
- Foto laporan buram dan miring, sulit diperiksa pihak lain.
- Tidak ada jejak siapa mengubah apa, dan tidak ada pemeriksa kedua.
- Tidak ada catatan barang inventaris yang terstruktur.

### 1.2 Tujuan bisnis

| ID | Tujuan |
| --- | --- |
| T1 | Saldo setiap kas selalu dapat dihitung ulang dari transaksi dan konsisten dengan uang fisik. |
| T2 | Laporan mingguan yang sudah final tidak dapat diubah diam-diam. |
| T3 | Bendahara menyelesaikan input mingguan lebih cepat dan lebih sedikit salah dibanding kertas. |
| T4 | Majelis dapat melihat laporan kapan saja tanpa menunggu foto. |
| T5 | Barang inventaris gereja tercatat dengan kondisi, lokasi, dan riwayat (fase 2). |

### 1.3 Ruang lingkup

**Masuk:** autentikasi dan peran, laporan keuangan mingguan, transaksi per kas, persembahan bulanan, rekonsiliasi kas fisik, penguncian laporan, audit, backup. Fase 2: inventaris.

**Di luar lingkup:** akuntansi double-entry penuh, pajak, penggajian, pembayaran online, dukungan banyak gereja (belum), aplikasi mobile native.

### 1.4 Pemangku kepentingan

| Pihak | Peran terhadap sistem |
| --- | --- |
| Bendahara | Pengguna utama, input transaksi tiap minggu |
| Majelis | Membaca laporan, kemungkinan menyetujui penguncian |
| Admin | Mengelola akun pengguna |
| Jemaat | Tidak punya akses langsung |
| Pengembang | Membangun dan memelihara sistem |

### 1.5 Ukuran keberhasilan

- Selisih saldo sistem dengan kas fisik tercatat nol pada setiap laporan terkunci.
- Seluruh laporan terkunci dalam waktu yang disepakati setelah hari Minggu. **\[Perlu konfirmasi: berapa hari\]**
- Waktu input mingguan bendahara menurun dibanding proses kertas. **\[Perlu konfirmasi: tolok ukur awal\]**
- Backup terbukti dapat dipulihkan (uji restore bulanan berhasil).

### 1.6 Asumsi dan risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Bendahara kembali ke kertas karena sistem lambat dipakai | Data sistem tertinggal | Format tampilan laporan meniru kertas; input cepat; uji dengan bendahara sebelum rilis |
| Satu orang menginput dan mengunci tanpa pemeriksa | Kesalahan atau penyelewengan tidak terdeteksi | Opsi persetujuan majelis (BR-L05) |
| Tanpa backup, data hilang saat server rusak | Kehilangan catatan keuangan jemaat | BR-D03 |
| Saldo awal salah dimasukkan | Seluruh saldo salah selamanya | Verifikasi dengan kertas asli sebelum laporan pertama |
| Modul inventaris menunda keuangan | Nilai utama tertunda | Inventaris hanya setelah keuangan dipakai beberapa minggu |