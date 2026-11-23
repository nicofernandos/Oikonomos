## 2. PRD (Product Requirements Document)

### 2.1 Pengguna dan hak akses

| Kemampuan | admin | bendahara | majelis |
| --- | --- | --- | --- |
| Login | ya | ya | ya |
| Kelola akun | ya | tidak | tidak |
| Buat laporan, input transaksi dan persembahan | tidak | ya | tidak |
| Catat rekonsiliasi | tidak | ya | tidak |
| Kunci laporan | tidak | ya, atau menunggu persetujuan | menyetujui bila diaktifkan |
| Lihat laporan dan saldo | ya | ya | ya |
| Lihat audit | ya | tidak | ya **\[Perlu konfirmasi\]** |

### 2.2 Kebutuhan fungsional

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-01 | Login dengan username dan password, menghasilkan token berumur 8 jam | Fase 1 |
| FR-02 | Admin membuat, menonaktifkan, dan mereset akun | Fase 1 |
| FR-03 | Membuat laporan mingguan untuk satu tanggal | Fase 1 |
| FR-04 | Menambah transaksi masuk atau keluar ke satu kas dalam laporan terbuka | Fase 1 |
| FR-05 | Mencatat persembahan bulanan per nama, otomatis membentuk transaksi masuk Kas Gereja | Fase 1 |
| FR-06 | Koreksi laporan terkunci lewat transaksi penyesuaian di laporan terbuka berikutnya | Fase 1 |
| FR-07 | Menampilkan saldo per kas dan kas total pada tanggal tertentu | Fase 1 |
| FR-08 | Mencatat rekonsiliasi: saldo fisik per kas dibandingkan dengan saldo sistem | Fase 1 |
| FR-09 | Mengunci laporan sesuai tabel keputusan (bagian 3.9) | Fase 1 |
| FR-10 | Mengambil laporan lengkap dalam struktur menyerupai kertas (saldo lalu, penerimaan, persembahan, pengeluaran, saldo akhir) | Fase 1 |
| FR-11 | Export laporan ke PDF atau Excel | Fase 1b |
| FR-12 | Melihat riwayat audit | Fase 1b |
| FR-13 | Modul inventaris: barang, kondisi, lokasi, peminjaman | Fase 2 |

### 2.3 Kebutuhan non-fungsional

- **Keamanan:** semua endpoint tertutup secara default; hanya login dan health yang publik. Kata sandi di-hash (scrypt). Pembatasan percobaan login sebelum diakses dari internet.
- **Integritas:** semua penulisan keuangan lewat repository, memakai transaksi database, dan mengunci baris laporan (`FOR UPDATE`) saat memeriksa status.
- **Akurasi:** semua nominal bilangan bulat rupiah (`BIGINT`). Tidak ada tipe desimal atau float untuk uang.
- **Kinerja:** data kecil (puluhan transaksi per minggu); tidak perlu optimasi khusus, cukup indeks yang ada.
- **Operasional:** backup `pg_dump` terjadwal ke lokasi berbeda dari server; uji restore bulanan.
- **Bahasa:** pesan kesalahan API dalam bahasa Indonesia; nama tabel dan kolom dalam bahasa Indonesia mengikuti skema yang ada.
- **Tanggal:** tanggal bisnis memakai `DATE`; stempel waktu memakai `TIMESTAMPTZ`.

### 2.4 Model data

Sudah ada di migrasi: `laporan_mingguan`, `transaksi`, `users`, `saldo_awal`, `persembahan_bulanan`, enum `jenis_kas`, `jenis_transaksi`, `peran_user`.

Belum ada dan perlu migrasi baru:
- `transaksi.koreksi_dari` (rujukan ke transaksi yang dikoreksi, opsional), `transaksi.dibuat_oleh`, `transaksi.dibuat_pada`.
- `rekonsiliasi` (laporan\_id, kas, saldo\_sistem, saldo\_fisik, selisih, dicek\_oleh, waktu).
- `audit_log` (siapa, aksi, objek, waktu, ringkasan).
- `laporan_mingguan.dikunci_oleh`, `dikunci_pada`, dan kolom persetujuan bila BR-L05 memilih persetujuan majelis.
- Fase 2: `barang`, `riwayat_kondisi_barang`, `peminjaman_barang`, dengan `barang.transaksi_id` opsional.

Saldo tidak disimpan sebagai input. Saldo selalu dihitung dari `saldo_awal` ditambah transaksi.

### 2.5 Kontrak API (target)

Rute di bawah adalah target. Scaffold `nest g resource` yang sekarang ada (`/keuangan` dengan PATCH dan DELETE) harus diganti, karena bertentangan dengan BR-T04.

| Metode dan rute | Peran | Fungsi |
| --- | --- | --- |
| POST /api/auth/login | publik | Login |
| GET /api/health | publik | Cek koneksi database |
| GET /api/laporan | semua | Daftar laporan |
| POST /api/laporan | bendahara | Buat laporan |
| GET /api/laporan/:id | semua | Laporan lengkap dengan saldo |
| POST /api/laporan/:id/transaksi | bendahara | Tambah transaksi |
| POST /api/laporan/:id/persembahan | bendahara | Tambah persembahan bulanan beserta transaksinya |
| POST /api/laporan/:id/rekonsiliasi | bendahara | Catat saldo fisik per kas |
| POST /api/laporan/:id/kunci | bendahara atau majelis | Kunci laporan |
| GET /api/saldo?tanggal= | semua | Saldo per kas |
| POST /api/users | admin | Buat akun |

Tidak ada endpoint DELETE untuk transaksi. Tidak ada endpoint yang membuka kembali laporan terkunci.

### 2.6 Fase

1. **Fase 1:** auth, laporan, transaksi, persembahan, rekonsiliasi, kunci, saldo, audit dasar, backup.
2. **Fase 1b:** export PDF dan Excel, tampilan audit, frontend lengkap.
3. **Fase 2:** inventaris, dimulai setelah fase 1 dipakai nyata minimal beberapa minggu.

### 2.7 Kriteria penerimaan fase 1

- Seluruh aturan BR di bagian 3 yang berlaku di fase 1 memiliki tes otomatis yang lulus.
- Laporan 15 November 2026 dapat dibuat, diisi, direkonsiliasi, dan dikunci; saldo akhirnya cocok dengan perhitungan manual bendahara.
- Percobaan mengubah laporan terkunci ditolak di API.
- Uji restore backup berhasil sekali sebelum dipakai nyata.w