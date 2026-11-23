# Kontrak API keuangan fase 1

Semua rute memakai prefiks `/api`, JWT bearer, dan guard autentikasi global dari AuthModule. `KeuanganModule` tidak membuka rute publik. Admin, bendahara, dan majelis boleh membaca. Hanya bendahara boleh membuat laporan, transaksi, persembahan, dan rekonsiliasi. Tidak ada PATCH, DELETE, atau operasi membuka kembali laporan; scaffold `/api/keuangan` dihapus.

## Format umum

- Kas: `gereja | pusat | diakonia | pembangunan`.
- Tanggal bisnis: string `YYYY-MM-DD` yang benar-benar valid, bukan timestamp. Tanggal keluaran PostgreSQL selalu diproyeksikan `::text`.
- Nilai uang masukan: string desimal kanonik `0` atau `[1-9][0-9]*`, maksimal `9223372036854775807`; JSON number juga diterima **hanya integer aman** (`Number.isSafeInteger`). Nominal transaksi/persembahan harus > 0, saldo fisik >= 0. Pecahan, notasi eksponen dalam string, tanda plus, spasi, dan nol depan ditolak. Angka JSON di luar rentang aman ditolak, bukan dibulatkan.
- Semua nilai uang keluaran dan total adalah **string desimal** (termasuk nilai negatif untuk saldo/selisih). Total dihitung tepat, tanpa floating point. ID BIGSERIAL (`transaksi`, `persembahan`, `rekonsiliasi`) berupa string; ID laporan/pengguna berupa integer.
- Properti body yang tidak dikenal ditolak. Teks wajib tidak kosong setelah trim, panjang maksimum 2000 karakter.
- GET berhasil 200; POST berhasil 201. Error memakai bentuk standar Nest `{statusCode, message, error}`; pesan validasi/aturan bisnis dalam bahasa Indonesia. 400 input salah, 401 belum login, 403 peran salah, 404 laporan tidak ada, 409 konflik aturan/status.

## Skema respons bersama

`Laporan`:
```ts
{
  id: number, tanggal: string, terkunci: boolean,
  dibuat_oleh: number | null, dibuat_pada: string,
  dikunci_oleh: number | null, dikunci_pada: string | null,
  disetujui_oleh: number | null, disetujui_pada: string | null
}
```

`Transaksi`:
```ts
{
  id: string, laporan_id: number, kas: Kas, jenis: 'masuk' | 'keluar',
  uraian: string, nominal: string, tanggal: string,
  koreksi_dari: string | null, dibuat_oleh: number | null, dibuat_pada: string
}
```

`Persembahan`:
```ts
{ id: string, laporan_id: number, transaksi_id: string,
  nama: string, bulan: string, nominal: string }
```

`Rekonsiliasi`:
```ts
{ id: string, laporan_id: number, kas: Kas,
  saldo_sistem: string, saldo_fisik: string, selisih: string,
  dicek_oleh: number, waktu: string }
```

## Rute

### GET /api/laporan

Tidak ada body. Respons `Laporan[]`, tanggal menurun. Belum dipaginasi (volume fase 1 kecil).

### POST /api/laporan

Body: `{ "tanggal": "2026-11-15" }`. Respons `Laporan`.

Keempat saldo awal yang nyata/terverifikasi per `2026-11-08` harus ada. Laporan pertama tepat `2026-11-15`. Selanjutnya harus hari Minggu, tepat tujuh hari setelah laporan terakhir, dan laporan sebelumnya sudah terkunci. Pembuatan diserialisasi dengan advisory lock `20261108`, sama dengan guard saldo awal dan penguncian laporan.

### GET /api/laporan/:id

ID integer positif <= 2147483647. Respons:
```ts
{
  laporan: Laporan,
  kas: Record<Kas, {
    saldo_lalu: string,
    penerimaan: Transaksi[], total_penerimaan: string,
    pengeluaran: Transaksi[], total_pengeluaran: string,
    saldo_akhir: string
  }>,
  persembahan_bulanan: Persembahan[], total_persembahan: string,
  total_saldo_lalu: string, total_saldo_akhir: string,
  rekonsiliasi: Rekonsiliasi[]
}
```

Empat kas selalu ada. Saldo lalu dihitung sampai tanggal laporan dikurangi tujuh hari, saldo akhir sampai tanggal laporan. Persembahan juga termasuk penerimaan Kas Gereja: **jangan ditambahkan dua kali**. Semua bagian dibaca dalam satu transaksi REPEATABLE READ READ ONLY.

### POST /api/laporan/:id/transaksi

Body wajib:
```json
{ "kas": "gereja", "jenis": "masuk", "uraian": "Ucapan syukur",
  "nominal": 25000, "tanggal": "2026-11-15" }
```

Opsional `koreksi_dari`: ID transaksi BIGINT positif (string disarankan; null sama dengan tidak diisi). Respons `Transaksi`.

Tanggal transaksi tidak boleh melebihi tanggal laporan. Saldo dihitung menurut **tanggal laporan**, bukan tanggal transaksi; tanggal transaksi yang lebih lama tidak mengubah saldo laporan lama. Koreksi wajib menunjuk transaksi dari laporan lebih awal yang sudah terkunci dan dimasukkan ke laporan terbuka berikutnya setelah laporan asal. Uraian wajib menjelaskan alasan koreksi; server hanya dapat memvalidasi uraian tidak kosong, bukan maknanya. Laporan terkunci selalu ditolak.

### POST /api/laporan/:id/persembahan

Body wajib:
```json
{ "nama": "Nama jemaat", "bulan": "2026-11-01",
  "nominal": "25000", "tanggal": "2026-11-15" }
```

Bulan harus tanggal 1. Respons:
```ts
{ persembahan: Persembahan, transaksi: Transaksi, peringatan: string[] }
```

Persembahan dan satu transaksi masuk Kas Gereja dibuat atomik dalam satu transaksi database. Uraian otomatis `Persembahan bulanan <nama> (<bulan>)`. Nama yang sama (trim dan case-insensitive) untuk bulan yang sama di seluruh laporan menghasilkan `peringatan: ["Nama dan bulan persembahan sudah tercatat"]`, bukan penolakan; selain itu `[]`.

### POST /api/laporan/:id/rekonsiliasi

Body wajib: `{ "kas": "gereja", "saldo_fisik": 25000 }`. Respons `Rekonsiliasi`.

Satu kas per permintaan. Sistem menghitung saldo terbaru di bawah row lock laporan. Pengulangan mengganti hitungan fisik/snapshot kas itu, mencatat pemeriksa dan waktu baru, serta menambah audit. Selisih nonnol boleh disimpan. Tidak bisa dilakukan pada laporan terkunci.

### POST /api/laporan/:id/kunci

Body kosong atau `{}`; tidak menerima field persetujuan dari klien. Respons `Laporan` terkunci.

`REQUIRE_MAJELIS_APPROVAL` tidak diisi berarti `false`. Bila diisi, hanya string persis `true` atau `false` diterima; nilai lainnya menggagalkan startup. Bila false, hanya bendahara boleh mengunci. Bila true, hanya majelis boleh mengunci; tindakan ini sekaligus persetujuan dan mengisi kedua kolom penyetuju. Penyetuju tidak boleh sama dengan pembuat transaksi terakhir (urutan ID turun); laporan tanpa transaksi tidak memiliki penginput terakhir.

Penguncian membutuhkan empat rekonsiliasi lengkap, snapshot `saldo_sistem` masih sama dengan saldo yang baru dihitung, dan keempat selisih nol. Jika snapshot kedaluwarsa, ulangi rekonsiliasi. Jika selisih nonnol, tambah transaksi penyesuaian dengan uraian alasan, lalu rekonsiliasi ulang. Tidak ada unlock.

### GET /api/saldo?tanggal=2026-11-15

Tanggal wajib, minimal `2026-11-08`. Respons:
```ts
{ tanggal: string, kas: Record<Kas, string>, total: string }
```

Saldo dihitung di SQL dari `saldo_awal` + masuk - keluar, untuk transaksi pada laporan bertanggal sampai tanggal permintaan, termasuk laporan terbuka. Tidak menerima input saldo sistem. Semua empat saldo awal terverifikasi wajib tersedia.

## Integritas dan audit

Semua penulisan melalui repository memakai `DatabaseService.withTransaction`. Sebelum pemeriksaan status/penulisan transaksi, persembahan, rekonsiliasi, atau penguncian, baris laporan dikunci `FOR UPDATE`. Pembuatan dan penguncian juga mengambil `pg_advisory_xact_lock(20261108)` untuk sinkronisasi dengan perubahan saldo awal. Audit insert dan mutasi merupakan satu transaksi atomik. Pembuatan laporan, transaksi, persembahan, rekonsiliasi, dan penguncian dicatat tanpa rahasia.

Aturan usulan larangan saldo negatif (BR-K03) **belum diaktifkan**; perlu konfirmasi pemilik. Tidak ada API transfer khusus atau status setor Kas Pusat, sebab dokumen masih meminta konfirmasi. Transfer bila disepakati dicatat sebagai dua transaksi eksplisit.

## Persiapan saldo awal

Tidak ada saldo awal fiktif/dummy/seed dan tidak ada API admin saldo awal. Sebelum laporan pertama, operator harus memeriksa kertas asli bersama bendahara, mencatat persetujuan, lalu memasukkan keempat nominal nyata melalui prosedur SQL admin dalam satu transaksi memakai advisory lock `20261108` dan audit `audit_log`. Gunakan parameter SQL untuk nominal yang sudah diverifikasi; jangan mengganti saldo demi menyesuaikan rekonsiliasi. Setelah laporan terkunci, perubahan dibatasi guard database/prosedur khusus admin. Migrasi skema ditangani terpisah; modul ini tidak mengubah migrasi.
