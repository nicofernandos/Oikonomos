# Oikonomos: knowledge untuk agent backend

Berkas ini adalah konteks lengkap untuk agent yang mengerjakan API backend. Letakkan di `docs/knowledge.md` dan rujuk dari `AGENTS.md` (atau `CLAUDE.md`) di root repositori. Aturan bisnis lengkap ada di `docs/aturan-bisnis.md`; berkas ini merangkum yang perlu diketahui untuk menulis kode.

Bagian bertanda **[Perlu konfirmasi]** belum diputuskan pemilik sistem. Jangan memutuskannya sendiri.

---

## 0. Protokol kerja (baca dulu)

1. Kerjakan **satu tugas pada satu waktu** dari bagian 12. Jangan mengerjakan tugas berikutnya tanpa diminta.
2. Sebelum mengubah apa pun, jalankan pemeriksaan di bagian 10 untuk memastikan kondisi proyek sesuai klaim di sini. Jika berbeda, laporkan perbedaannya dulu.
3. Tulis tes aturan bisnis **lebih dulu**, lihat gagal, baru implementasi.
4. Jika aturan ambigu, bertanda **[Perlu konfirmasi]**, atau bertentangan dengan permintaan, **berhenti dan bertanya**. Jangan menebak.
5. Perubahan harus kecil dan dapat ditinjau. Satu tugas, satu diff yang fokus.
6. Di akhir tugas, laporkan: apa yang diubah, aturan BR mana yang tercakup, tes yang ditambahkan, dan hal yang tidak bisa diverifikasi.

Kode yang bertentangan dengan aturan BR adalah bug, bukan fitur.

---

## 1. Gambaran sistem

Oikonomos adalah sistem pencatatan keuangan jemaat gereja yang menggantikan laporan kertas mingguan. Laporan memuat **empat kas terpisah**: `gereja`, `pusat`, `diakonia`, `pembangunan`. Setiap minggu (hari Minggu) bendahara menginput penerimaan dan pengeluaran, mencocokkan saldo dengan uang fisik, lalu mengunci laporan. Saldo akhir menjadi saldo awal minggu berikutnya, dan harus dihitung, bukan diketik.

Ini data keuangan jemaat. Kebenaran angka dan keterlacakan lebih penting daripada kecepatan pengembangan.

Modul bisnis:

| Modul | Fase | Keterangan |
|---|---|---|
| keuangan | 1 | Inti. Laporan mingguan, transaksi, persembahan bulanan, rekonsiliasi, penguncian, saldo |
| inventaris | 2 | Inventarisasi tahunan barang. **Jangan dikerjakan sebelum diminta** |

Modul pendukung (bukan modul bisnis): `auth`, `database`, `health`.

---

## 2. Stack dan perintah

- Backend: NestJS, TypeScript, **ESM**. Folder `backend/`.
- Database: PostgreSQL, driver `pg`, **SQL mentah, tanpa ORM**.
- Migrasi: `node-pg-migrate` dengan berkas `.sql`. Folder `backend/migrations/`.
- Frontend: React + Vite di `frontend/` (bukan tugas agent backend).
- Auth: JWT (`@nestjs/jwt`), hash kata sandi `scrypt` bawaan Node.
- Validasi: `class-validator` dan `class-transformer`.
- Layanan pemantauan `@nestjs/observe` dari template **tidak dipakai** dan harus dihapus bila masih ada.

Perintah (dari folder `backend`):

```bash
npm run start:dev                 # jalankan dengan watch
npm run migrate -- up             # jalankan migrasi
npm run migrate -- create <nama> -j sql   # buat berkas migrasi baru
npm test                          # tes
set -a; source .env; set +a       # muat .env ke shell untuk psql
psql "$DATABASE_URL"              # akses database
```

Variabel lingkungan (`backend/.env`, jangan di-commit): `PORT`, `DATABASE_URL`, `JWT_SECRET`. `.env.example` boleh di-commit tanpa nilai rahasia.

Semua rute memakai awalan global `/api`.

---

## 3. Struktur folder target

```
backend/
├── migrations/
├── scripts/buat-admin.mjs
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── health.controller.ts
    ├── database/
    │   ├── database.module.ts      (@Global)
    │   └── database.service.ts
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   ├── auth.types.ts
    │   ├── decorators.ts           (@Public, @Roles)
    │   ├── guards.ts               (AuthGuard, RolesGuard)
    │   ├── password.ts
    │   └── login.dto.ts
    └── keuangan/
        ├── keuangan.module.ts
        ├── keuangan.controller.ts  (tipis: HTTP dan validasi)
        ├── keuangan.service.ts     (aturan bisnis)
        ├── keuangan.repository.ts  (satu-satunya tempat SQL keuangan)
        ├── dto/
        └── keuangan.rules.spec.ts  (satu tes per BR, dinamai dengan ID)
```

Scaffold `nest g resource` (folder `dto/` dan `entities/` generik, rute `/keuangan` dengan PATCH dan DELETE) **bertentangan dengan aturan** dan harus diganti, bukan diperluas.

---

## 4. Konvensi kode (wajib)

1. **Import relatif memakai ekstensi `.js`**, misalnya `from './database/database.service.js'`. Proyek ini ESM; tanpa ekstensi, aplikasi gagal saat dijalankan.
2. **SQL hanya di `*.repository.ts`** dan selalu berparameter (`$1`, `$2`). Dilarang menyambung string dari input pengguna. Untuk nama kolom atau arah `ORDER BY` dinamis, cocokkan dengan daftar yang diizinkan.
3. **Uang adalah bilangan bulat rupiah** (`BIGINT` di database, `number` di TypeScript). Dilarang `float`, `numeric`, atau `decimal` untuk uang.
4. **Saldo dihitung, tidak pernah disimpan sebagai input.**
5. **Controller tipis.** Controller hanya menerima request, memvalidasi lewat DTO, memanggil service. Logika bisnis di service. SQL di repository.
6. **Semua penulisan keuangan memakai transaksi database** (`db.withTransaction`) dan mengunci baris laporan dengan `SELECT ... FOR UPDATE` saat memeriksa status.
7. **Endpoint tertutup secara default.** Hanya yang bertanda `@Public()` yang terbuka: login dan health. Endpoint baru wajib menyatakan peran dengan `@Roles(...)` bila tidak boleh diakses semua pengguna terautentikasi.
8. Penamaan: tabel, kolom, rute, dan istilah domain memakai **bahasa Indonesia** mengikuti skema yang ada. Jangan menerjemahkan istilah domain (lihat bagian 5).
9. Pesan kesalahan ke klien dalam bahasa Indonesia. Pesan tidak boleh membocorkan detail internal (nama tabel, isi query, jejak tumpukan).
10. Dilarang mencatat kata sandi, token, atau `JWT_SECRET` ke log.
11. Skema hanya berubah lewat **berkas migrasi baru**. Jangan mengedit migrasi yang sudah dijalankan.
12. Jangan menambah dependensi tanpa alasan tertulis. Sebutkan paket dan alasannya di laporan tugas.

Pemetaan status HTTP:

| Situasi | Status |
|---|---|
| Validasi gagal | 400 |
| Tidak login atau token tidak valid | 401 |
| Peran tidak berhak | 403 |
| Data tidak ditemukan | 404 |
| Melanggar aturan keadaan (laporan terkunci, urutan laporan, rekonsiliasi belum lengkap) | 409 |

---

## 5. Domain dan glosarium

| Istilah | Arti |
|---|---|
| Kas | Satu dari empat kantong dana terpisah |
| Kas Gereja | Dana operasional (listrik, air, ATK, persembahan bulanan) |
| Kas Pusat | Dana yang disetor ke pusat. Status titipan sampai disetor **[Perlu konfirmasi]** |
| Diakonia | Dana sosial: duka, sakit, santunan |
| Pembangunan | Dana pembangunan gedung |
| Laporan mingguan | Satu laporan per hari Minggu |
| Persembahan bulanan | Setoran per nama untuk satu bulan; selalu masuk Kas Gereja |
| Ucapan syukur | Penerimaan per nama; dicatat sebagai transaksi masuk |
| Rekonsiliasi | Mencocokkan saldo sistem per kas dengan uang fisik |
| Kunci | Menjadikan laporan final dan tidak dapat diubah |
| Penyesuaian | Transaksi koreksi di laporan terbuka berikutnya |
| Majelis | Pengurus gereja. Peran baca (dan mungkin penyetuju) |
| Sektor | Kelompok wilayah jemaat; muncul di uraian penerimaan kebaktian rumah tangga |

---

## 6. Skema database

### 6.1 Sudah ada di migrasi

Migrasi: `1794760710007_keuangan` dan `1794843884592_tambah-users-dan-persembahan`. Verifikasi dengan `psql "$DATABASE_URL" -c "\dt"` (bagian 10).

```sql
-- enum
jenis_kas        ('gereja','pusat','diakonia','pembangunan')
jenis_transaksi  ('masuk','keluar')
peran_user       ('admin','bendahara','majelis')

laporan_mingguan (id SERIAL PK, tanggal DATE UNIQUE, terkunci BOOLEAN DEFAULT false, dibuat_pada TIMESTAMPTZ)
transaksi        (id BIGSERIAL PK, laporan_id FK, kas jenis_kas, jenis jenis_transaksi,
                  uraian TEXT, nominal BIGINT CHECK > 0, tanggal DATE)
saldo_awal       (kas jenis_kas PK, nominal BIGINT CHECK >= 0, per_tanggal DATE)
users            (id SERIAL PK, username UNIQUE, password_hash, nama, peran peran_user,
                  aktif BOOLEAN DEFAULT true, dibuat_pada TIMESTAMPTZ)
persembahan_bulanan (id BIGSERIAL PK, laporan_id FK, transaksi_id BIGINT UNIQUE FK,
                  nama TEXT, bulan DATE CHECK (bulan = tanggal 1), nominal BIGINT CHECK > 0)
```

Data awal `saldo_awal`, per `2026-11-08`, hasil bacaan foto laporan kertas yang buram. **Belum diverifikasi dengan kertas asli**:

| Kas | Nominal |
|---|---|
| gereja | 917.800 |
| pusat | 569.000 |
| diakonia | 2.164.000 |
| pembangunan | 58.179.000 |
| **Total** | **61.829.800** |

Laporan pertama di sistem bertanggal **2026-11-15**.

### 6.2 Belum ada, perlu migrasi baru

Buat sebagai migrasi **baru**, jangan mengubah yang sudah ada:

- `transaksi.dibuat_oleh INT REFERENCES users(id)` dan `transaksi.dibuat_pada TIMESTAMPTZ DEFAULT now()` (BR-D01).
- `transaksi.koreksi_dari BIGINT REFERENCES transaksi(id)`, opsional (BR-T05).
- `laporan_mingguan.dikunci_oleh INT REFERENCES users(id)` dan `dikunci_pada TIMESTAMPTZ`.
- Tabel `rekonsiliasi`: `laporan_id`, `kas`, `saldo_sistem BIGINT`, `saldo_fisik BIGINT`, `selisih BIGINT`, `dicek_oleh`, `waktu`; kunci unik `(laporan_id, kas)`.
- Tabel `audit_log`: `id`, `user_id`, `aksi TEXT`, `objek TEXT`, `objek_id TEXT`, `ringkasan TEXT`, `waktu TIMESTAMPTZ DEFAULT now()`.
- Bila persetujuan majelis aktif (BR-L05): `laporan_mingguan.disetujui_oleh`, `disetujui_pada`.

Nilai enum baru tidak boleh dipakai di migrasi yang sama dengan `ALTER TYPE ... ADD VALUE`.

---

## 7. Aturan bisnis (ringkas)

Teks lengkap dan alasan: `docs/aturan-bisnis.md`. Setiap aturan harus punya tes yang dinamai dengan ID-nya.

**Kas dan transaksi**
- BR-K01: hanya empat kas.
- BR-K02: satu transaksi, satu kas. Perpindahan antar kas = dua transaksi **[Perlu konfirmasi: diizinkan?]**.
- BR-K03: saldo kas tidak boleh negatif *(usulan)*.
- BR-T01: nominal bilangan bulat > 0; jenis menentukan tanda.
- BR-T02: uraian dan tanggal wajib; tanggal transaksi tidak melewati tanggal laporan.
- BR-T03: transaksi hanya ditambah ke laporan belum terkunci.
- BR-T04: transaksi di laporan terkunci tidak dapat diubah atau dihapus. **Tidak ada endpoint DELETE untuk transaksi.**
- BR-T05: koreksi laporan terkunci lewat transaksi penyesuaian di laporan terbuka berikutnya, dengan `koreksi_dari` dan alasan di uraian.

**Saldo**
- BR-S01: saldo pada tanggal D = `saldo_awal` + masuk − keluar dari laporan bertanggal ≤ D.
- BR-S02: laporan bertanggal ≤ `saldo_awal.per_tanggal` tidak boleh dibuat.
- BR-S03: kas total = jumlah empat saldo.
- BR-S04: `saldo_awal` tidak diubah setelah ada laporan terkunci.

**Laporan dan penguncian**
- BR-L01: satu laporan per tanggal; harus hari Minggu **[Perlu konfirmasi]**.
- BR-L02: laporan baru hanya bila laporan sebelumnya terkunci.
- BR-L03: kunci hanya setelah rekonsiliasi empat kas tercatat dan semua selisih nol.
- BR-L04: laporan terkunci permanen. Tidak ada operasi membuka kembali.
- BR-L05: pengunci bendahara sendiri atau butuh persetujuan majelis **[Perlu konfirmasi]**. Implementasikan sebagai satu pengaturan konfigurasi (`KUNCI_BUTUH_PERSETUJUAN`); default `false` sampai pemilik memutuskan.
- BR-L06: bila persetujuan aktif, penyetuju bukan pihak yang terakhir menginput transaksi laporan itu.
- BR-L07: selisih uang fisik dicatat sebagai transaksi penyesuaian bertanda selisih beserta catatan, bukan dengan mengubah saldo.

**Persembahan bulanan**
- BR-P01: setiap baris berpasangan dengan tepat satu transaksi masuk Kas Gereja, dibuat dalam satu transaksi database.
- BR-P02: bulan selalu tanggal 1.
- BR-P03: total persembahan dihitung dari baris, tidak diketik.
- BR-P04: nama sama di bulan sama memberi peringatan, bukan penolakan *(usulan)*.

**Akses**
- BR-A01: peran `admin`, `bendahara`, `majelis`.
- BR-A02: hanya admin mengelola akun.
- BR-A03: admin tidak menginput atau mengubah transaksi.
- BR-A04: default tertutup; hanya login dan health publik.
- BR-A05: kata sandi min. 10 karakter, disimpan sebagai hash.
- BR-A06: pesan gagal login seragam.
- BR-A07: pembatasan laju login sebelum dibuka ke internet.
- BR-A08: token berlaku 8 jam.

**Data dan operasional**
- BR-D01: transaksi mencatat pembuat dan waktu.
- BR-D02: audit mencatat pembuatan laporan, rekonsiliasi, penguncian, perubahan akun, perubahan saldo awal.
- BR-D03: backup harian dan uji restore bulanan (di luar kode; jangan abaikan).
- BR-D04: tidak ada rahasia di log.
- BR-D05: skema hanya berubah lewat migrasi baru.

### Tabel keputusan penguncian

| Rekonsiliasi lengkap | Selisih | Persetujuan (bila aktif) | Hasil |
|---|---|---|---|
| Ya | Nol | Ada atau tidak diperlukan | Kunci diizinkan |
| Ya | Nol | Belum ada | Menunggu persetujuan |
| Ya | Tidak nol | Apa pun | 409: catat penyesuaian selisih dulu (BR-L07) |
| Tidak | Apa pun | Apa pun | 409: lakukan rekonsiliasi dulu |

Aturan turunan: rekonsiliasi dianggap **basi** bila ada transaksi ditambahkan setelahnya (`saldo_sistem` yang tersimpan berbeda dengan saldo sistem sekarang). Kunci ditolak sampai rekonsiliasi diulang.

---

## 8. Kontrak API target

Semua dengan awalan `/api`. Peran di kolom kanan; "semua" berarti pengguna terautentikasi mana pun.

| Rute | Peran | Fungsi |
|---|---|---|
| `POST /auth/login` | publik | Login, mengembalikan `access_token` dan `user` |
| `GET /health` | publik | Cek koneksi database |
| `POST /users` | admin | Buat akun |
| `GET /laporan` | semua | Daftar laporan |
| `POST /laporan` | bendahara | Buat laporan `{ tanggal }` |
| `GET /laporan/:id` | semua | Laporan lengkap (lihat di bawah) |
| `POST /laporan/:id/transaksi` | bendahara | Tambah transaksi |
| `POST /laporan/:id/persembahan` | bendahara | Tambah persembahan bulanan beserta transaksinya |
| `POST /laporan/:id/rekonsiliasi` | bendahara | Catat saldo fisik per kas |
| `POST /laporan/:id/kunci` | bendahara; majelis untuk persetujuan | Kunci laporan |
| `GET /saldo?tanggal=YYYY-MM-DD` | semua | Saldo per kas dan total |

Tidak ada `DELETE` untuk transaksi. Tidak ada rute untuk membuka laporan terkunci. Tidak ada `PATCH` pada transaksi di laporan terkunci.

Bentuk `GET /laporan/:id`:

```json
{
  "id": 1,
  "tanggal": "2026-11-15",
  "terkunci": false,
  "saldo_lalu":  { "gereja": 0, "pusat": 0, "diakonia": 0, "pembangunan": 0, "total": 0 },
  "penerimaan":  [ { "id": 1, "kas": "gereja", "uraian": "...", "nominal": 0, "tanggal": "2026-11-15" } ],
  "persembahan_bulanan": [ { "nama": "...", "bulan": "2026-11-01", "nominal": 0 } ],
  "pengeluaran": [ ],
  "saldo_akhir": { "gereja": 0, "pusat": 0, "diakonia": 0, "pembangunan": 0, "total": 0 },
  "rekonsiliasi": [ { "kas": "gereja", "saldo_sistem": 0, "saldo_fisik": 0, "selisih": 0, "basi": false } ]
}
```

`saldo_lalu` = saldo dengan laporan bertanggal **<** tanggal laporan. `saldo_akhir` = saldo dengan laporan bertanggal **≤** tanggal laporan.

---

## 9. Pola implementasi

### 9.1 DatabaseService

`DatabaseService` menyediakan `query<T>(text, params)` (mengembalikan `rows`) dan `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK otomatis). Modulnya `@Global()`. Driver `pg` diimpor sebagai default karena ESM:

```ts
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
const { Pool, types } = pg;
```

Parser tipe yang **harus** ada di berkas itu:

```ts
types.setTypeParser(20, (v: string) => parseInt(v, 10));  // BIGINT -> number
types.setTypeParser(1082, (v: string) => v);               // DATE  -> 'YYYY-MM-DD' (string)
```

Parser `DATE` mencegah `pg` mengubah tanggal menjadi objek `Date` lokal, yang dapat menggeser tanggal satu hari. Tanggal bisnis selalu string `YYYY-MM-DD`.

### 9.2 Menulis dalam transaksi dengan penguncian baris

```ts
tambahTransaksi(d: DataTransaksi): Promise<Transaksi> {
  return this.db.withTransaction(async (client) => {
    const lap = await client.query(
      'SELECT terkunci, tanggal FROM laporan_mingguan WHERE id = $1 FOR UPDATE',
      [d.laporan_id],
    );
    if (!lap.rows[0]) throw new NotFoundException('Laporan tidak ditemukan');
    if (lap.rows[0].terkunci) throw new ConflictException('Laporan sudah dikunci');

    const res = await client.query<Transaksi>(
      `INSERT INTO transaksi (laporan_id, kas, jenis, uraian, nominal, tanggal, dibuat_oleh)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [d.laporan_id, d.kas, d.jenis, d.uraian, d.nominal, d.tanggal, d.dibuat_oleh],
    );
    return res.rows[0];
  });
}
```

Seluruh aturan yang bergantung pada status laporan harus diperiksa **di dalam** transaksi setelah `FOR UPDATE`, supaya dua permintaan serentak tidak melewati pemeriksaan yang sama.

### 9.3 Query saldo

Saldo dihitung dari `saldo_awal` dan transaksi. Gunakan satu fungsi dengan parameter pembanding tanggal (`<` untuk saldo lalu, `<=` untuk saldo akhir), dengan operator dipilih dari daftar tetap, bukan dari input pengguna:

```sql
SELECT s.kas,
       (s.nominal + COALESCE((
          SELECT SUM(CASE WHEN t.jenis = 'masuk' THEN t.nominal ELSE -t.nominal END)
          FROM transaksi t
          JOIN laporan_mingguan l ON l.id = t.laporan_id
          WHERE t.kas = s.kas AND l.tanggal <= $1      -- atau < $1 untuk saldo lalu
       ), 0))::bigint AS saldo
FROM saldo_awal s
```

`::bigint` wajib, karena `SUM()` menghasilkan `numeric` yang dikembalikan `pg` sebagai string.

### 9.4 Guard dan peran

Dua guard global terdaftar sebagai `APP_GUARD` di `AuthModule`, urutannya penting: `AuthGuard` dulu (mengisi `req.user` dari token), lalu `RolesGuard`. Payload token: `{ sub: number, peran: Peran }`.

```ts
@Controller('laporan')
export class LaporanController {
  @Post()
  @Roles('bendahara')
  buat(@Body() dto: BuatLaporanDto, @Req() req: RequestWithUser) { ... }

  @Get(':id')          // semua pengguna terautentikasi
  ambil(@Param('id', ParseIntPipe) id: number) { ... }
}
```

`req.user.sub` adalah id pengguna untuk `dibuat_oleh`. Jangan pernah menerima id pengguna dari body request.

### 9.5 DTO dan validasi

`ValidationPipe` global dengan `whitelist: true` dan `transform: true`. Setiap input memakai DTO `class-validator`. Contoh batas untuk nominal: `@IsInt() @IsPositive()`. Untuk tanggal bisnis gunakan `@Matches(/^\d{4}-\d{2}-\d{2}$/)` dan validasi tambahan di service (misalnya hari Minggu, bila BR-L01 dikonfirmasi).

### 9.6 Persembahan bulanan

Dalam satu `withTransaction`: kunci laporan, periksa terbuka, `INSERT` ke `transaksi` (masuk, kas `gereja`), lalu `INSERT` ke `persembahan_bulanan` dengan `transaksi_id` dari hasil pertama. Jika salah satu gagal, semuanya dibatalkan (BR-P01).

---

## 10. Kondisi proyek saat ini (verifikasi sebelum bekerja)

Ini kondisi yang **diharapkan**. Jangan dianggap pasti; periksa dulu.

```bash
cd backend
ls src src/database src/auth migrations
grep -rn "Observe" src          # harus kosong; bila ada, hapus sisanya
cat src/main.ts                 # harus memuat setGlobalPrefix('api') dan ValidationPipe
set -a; source .env; set +a
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT name FROM pgmigrations ORDER BY id;"
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::peran_user));"
psql "$DATABASE_URL" -c "SELECT kas, nominal FROM saldo_awal;"
curl -s localhost:3000/api/health
```

Harapan:

- Dua migrasi tercatat, `keuangan` lebih dulu.
- Tabel: `laporan_mingguan`, `transaksi`, `users`, `saldo_awal`, `persembahan_bulanan`, `pgmigrations`.
- Enum `peran_user` memuat `admin`, `bendahara`, `majelis`.
- `saldo_awal` memiliki empat baris berjumlah 61.829.800.
- `/api/health` mengembalikan `{"status":"ok",...}`.
- Modul `auth` (login, guard, `password.ts`, `scripts/buat-admin.mjs`) sudah ditulis; belum diketahui apakah sudah diterapkan dan diuji.
- Modul `keuangan` masih scaffold CRUD generik hasil `nest g resource` dan belum berisi logika bisnis.

---

## 11. Jebakan yang sudah ditemui

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `Cannot find module './x.js'` atau `has no exported member` | Import tanpa `.js`, atau nama class tidak cocok antar berkas | Gunakan `.js`; satu nama class konsisten |
| `InvalidClassModuleException` | Controller ditaruh di `imports` modul | Controller hanya di `controllers`; `imports` hanya modul |
| Nest gagal inject `DatabaseService` | `DatabaseModule` atau `ConfigModule.forRoot` tidak ada di `AppModule` | Daftarkan keduanya |
| `Named export 'Pool' not found` | `pg` diimpor dengan named import di ESM | `import pg from 'pg'` lalu destrukturisasi |
| Saldo menjadi string atau tersambung ("100" + 5 = "1005") | `SUM()` mengembalikan `numeric` | Tambahkan `::bigint` |
| Tanggal bergeser satu hari | `pg` mengubah `DATE` menjadi `Date` lokal | Parser tipe 1082 yang mengembalikan string (9.1) |
| `type "jenis_kas" does not exist` saat migrasi | Migrasi yang membuat tipe belum dijalankan atau urutan timestamp salah | Migrasi dijalankan menurut urutan angka awal nama berkas |
| Perubahan migrasi tidak berefek | Berkas migrasi yang sudah dijalankan tidak dibaca ulang | Buat migrasi baru |
| Error 401/429 `ObserveAgentWorker` | Sisa `@nestjs/observe` dengan kunci placeholder | Hapus modul dan paketnya |
| Variabel `.env` tidak terbaca di shell | `.env` tidak dimuat otomatis | `set -a; source .env; set +a` |

---

## 12. Urutan tugas

Kerjakan berurutan. Setiap tugas selesai bila memenuhi bagian 14.

1. **Fondasi.** Terapkan parser tipe `DATE` (9.1). Hapus sisa `@nestjs/observe`. Pastikan `main.ts` sesuai bagian 10. Tes: `/api/health` mengembalikan ok.
2. **Migrasi tambahan** (6.2). Satu migrasi atau beberapa, urut dan dapat di-`down`. Perbarui interface TypeScript yang terkait.
3. **Bersihkan scaffold keuangan.** Hapus `dto/` dan `entities/` generik serta rute CRUD. Buat kerangka controller, service, repository sesuai bagian 3.
4. **Saldo (BR-S01 sampai BR-S04).** Fungsi saldo dan `GET /saldo`. Tes dengan data `saldo_awal` dan beberapa transaksi.
5. **Buat laporan (BR-L01, BR-L02, BR-S02).** `POST /laporan` dan `GET /laporan`.
6. **Tambah transaksi (BR-T01 sampai BR-T03, BR-D01).** `POST /laporan/:id/transaksi`. Tes: ditolak di laporan terkunci; tanggal melewati laporan ditolak.
7. **Persembahan bulanan (BR-P01 sampai BR-P03).** Tes atomisitas: bila insert kedua gagal, transaksi pertama ikut batal.
8. **Rekonsiliasi (BR-L03 bagian pertama, BR-L07).** `POST /laporan/:id/rekonsiliasi`, termasuk deteksi basi.
9. **Penguncian (BR-L03, BR-L04, BR-L05, BR-L06, BR-D02).** Mengikuti tabel keputusan. Tes untuk keempat baris tabel.
10. **Koreksi (BR-T05).** Transaksi penyesuaian dengan `koreksi_dari`.
11. **Laporan lengkap (`GET /laporan/:id`).** Bentuk sesuai bagian 8.
12. **Pengelolaan akun (BR-A02, BR-A03).** `POST /users` untuk admin.
13. **Pengerasan.** Pembatasan laju login (BR-A07), audit (BR-D02), pemeriksaan semua rute tertutup secara default.

Inventaris tidak termasuk daftar ini. Dikerjakan hanya setelah modul keuangan dipakai nyata dan pemilik meminta.

---

## 13. Pengujian

- Gunakan **database uji nyata** (`oikonomos_test`) dengan migrasi diterapkan. **Jangan memock database** untuk aturan keuangan: bug yang paling berbahaya (penguncian baris, atomisitas, tipe angka) tidak muncul di mock.
- Reset data antar tes (`TRUNCATE ... RESTART IDENTITY CASCADE` pada tabel data, bukan `pgmigrations`).
- Dua jenis tes:
  - Tes aturan: `describe('BR-T03: transaksi hanya ke laporan terbuka', ...)`. Nama memuat ID aturan.
  - Tes API (supertest) untuk status HTTP dan peran: setiap rute diuji tanpa token (401), dengan peran salah (403), dan dengan peran benar.
- Tes wajib untuk perhitungan saldo: minimal satu skenario dengan beberapa kas, beberapa minggu, dan transaksi masuk serta keluar, dengan hasil dihitung tangan di komentar tes.
- Tes konkurensi untuk penguncian: dua permintaan serentak (tambah transaksi dan kunci) tidak boleh menghasilkan transaksi di laporan terkunci.

---

## 14. Definisi selesai

Sebuah tugas selesai hanya bila **semua** benar:

1. Tes untuk aturan BR yang terkait ada, dinamai dengan ID-nya, dan lulus.
2. `npm run build` dan `npm test` berhasil tanpa error.
3. Perubahan skema datang bersama migrasi **baru** yang memiliki bagian `Down`, dan interface TypeScript diperbarui.
4. Tidak ada SQL di luar `*.repository.ts`.
5. Tidak ada endpoint baru yang terbuka tanpa disengaja; peran dinyatakan.
6. Tidak ada rahasia di kode, log, atau commit.
7. Laporan tugas memuat: berkas yang diubah, aturan yang tercakup, tes yang ditambahkan, dan hal yang tidak dapat diverifikasi.

---

## 15. Keputusan terbuka (jangan diputuskan agent)

1. Siapa yang mengunci: bendahara sendiri atau dengan persetujuan majelis (BR-L05).
2. Apakah perpindahan dana antar kas diizinkan (BR-K02).
3. Cara Kas Pusat disetor dan dilacak (BR-U01).
4. Apakah tanggal laporan selalu hari Minggu (BR-L01).
5. Apakah saldo kas boleh negatif (BR-K03).
6. Kebenaran angka `saldo_awal` terhadap kertas asli.
7. Apakah majelis boleh melihat audit.

Bila tugas bergantung pada salah satu di atas, implementasikan sebisa mungkin lewat konfigurasi dan **laporkan** bahwa keputusan itu masih terbuka. Jangan memilih diam-diam.

---

## 16. Larangan

- Jangan membuat endpoint `DELETE` atau `PATCH` untuk transaksi.
- Jangan membuat operasi yang membuka kembali laporan terkunci.
- Jangan menulis ke tabel `transaksi` selain lewat repository keuangan.
- Jangan menyimpan saldo sebagai kolom input.
- Jangan memakai `float`, `numeric`, atau `decimal` untuk uang.
- Jangan mengedit migrasi yang sudah dijalankan.
- Jangan menyambung string SQL dari input pengguna.
- Jangan membuat modul inventaris atau menyentuh tabel inventaris sebelum diminta.
- Jangan menambah dependensi tanpa alasan tertulis.
- Jangan meng-commit `.env` atau menulis rahasia ke log.
- Jangan menebak aturan bisnis. Bertanya.meng