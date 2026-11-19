-- Up Migration
CREATE TYPE kondisi_barang AS ENUM ('baik', 'rusak', 'hilang');

CREATE TABLE barang (
  id BIGSERIAL PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  keterangan TEXT,
  kondisi kondisi_barang NOT NULL DEFAULT 'baik',
  lokasi TEXT NOT NULL,
  penanggung_jawab TEXT NOT NULL,
  transaksi_id BIGINT REFERENCES transaksi(id),
  dibuat_oleh INT NOT NULL REFERENCES users(id),
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE riwayat_kondisi_barang (
  id BIGSERIAL PRIMARY KEY,
  barang_id BIGINT NOT NULL REFERENCES barang(id),
  kondisi_lama kondisi_barang,
  kondisi_baru kondisi_barang NOT NULL,
  catatan TEXT NOT NULL,
  diubah_oleh INT NOT NULL REFERENCES users(id),
  waktu TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE peminjaman_barang (
  id BIGSERIAL PRIMARY KEY,
  barang_id BIGINT NOT NULL REFERENCES barang(id),
  peminjam TEXT NOT NULL,
  tanggal_pinjam DATE NOT NULL,
  rencana_kembali DATE,
  tanggal_kembali DATE,
  catatan TEXT,
  dibuat_oleh INT NOT NULL REFERENCES users(id),
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['barang','riwayat_kondisi_barang','peminjaman_barang'] LOOP
    EXECUTE format('ALTER TABLE %I
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN updated_by INT REFERENCES users(id),
      ADD COLUMN modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN modified_by INT REFERENCES users(id),
      ADD COLUMN deleted_at TIMESTAMPTZ,
      ADD COLUMN deleted_by INT REFERENCES users(id),
      ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false,
      ADD CONSTRAINT retensi_tombstone_konsisten CHECK (
        (NOT is_deleted AND deleted_at IS NULL AND deleted_by IS NULL)
        OR (is_deleted AND deleted_at IS NOT NULL))', nama);
    EXECUTE format('CREATE TRIGGER metadata_retensi BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION isi_metadata_retensi()', nama);
    EXECUTE format('CREATE TRIGGER retensi_fisik BEFORE DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION tolak_penghapusan_fisik()', nama);
    EXECUTE format('CREATE TRIGGER retensi_audit AFTER UPDATE ON %I FOR EACH ROW
      WHEN (OLD.is_deleted IS DISTINCT FROM NEW.is_deleted) EXECUTE FUNCTION audit_retensi()', nama);
  END LOOP;
END;
$$;

-- PostgreSQL TEXT rejects NUL (SQLSTATE 22021) before CHECK evaluation.
-- Optional text is NULL or nonempty; whitespace-only descriptions are not data.
DO $$
DECLARE pasangan TEXT[];
BEGIN
  FOREACH pasangan SLICE 1 IN ARRAY ARRAY[
    ['barang','kode'],['barang','nama'],['barang','keterangan'],
    ['barang','lokasi'],['barang','penanggung_jawab'],
    ['riwayat_kondisi_barang','catatan'],
    ['peminjaman_barang','peminjam'],['peminjaman_barang','catatan']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I ~ ''[^[:space:]]'')',
      pasangan[1], pasangan[1] || '_' || pasangan[2] || '_isi', pasangan[2]);
  END LOOP;
END;
$$;
ALTER TABLE peminjaman_barang
  ADD CONSTRAINT rencana_kembali_valid CHECK (rencana_kembali >= tanggal_pinjam),
  ADD CONSTRAINT tanggal_kembali_valid CHECK (tanggal_kembali >= tanggal_pinjam);

CREATE UNIQUE INDEX satu_peminjaman_aktif ON peminjaman_barang(barang_id)
  WHERE tanggal_kembali IS NULL AND NOT is_deleted;
CREATE INDEX riwayat_kondisi_barang_urut ON riwayat_kondisi_barang(barang_id,waktu,id);

CREATE FUNCTION jaga_riwayat_inventaris() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Riwayat kondisi tidak dapat diubah' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER append_only BEFORE UPDATE ON riwayat_kondisi_barang
  FOR EACH ROW EXECUTE FUNCTION jaga_riwayat_inventaris();

CREATE FUNCTION jaga_anak_inventaris() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dihapus BOOLEAN;
BEGIN
  -- Semua penulisan anak mengunci barang, sama dengan operasi API. Jangan
  -- memutuskan ketersediaan berdasarkan kondisi rusak/hilang (belum ditentukan).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.barang_id IS DISTINCT FROM OLD.barang_id THEN
      RAISE EXCEPTION 'Barang pinjaman tidak dapat diganti' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT is_deleted INTO dihapus FROM barang WHERE id=NEW.barang_id FOR UPDATE;
  IF dihapus THEN
    RAISE EXCEPTION 'Barang sudah dihapus' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'peminjaman_barang' AND TG_OP = 'UPDATE' THEN
    IF OLD.tanggal_kembali IS NULL AND NEW.is_deleted THEN
      RAISE EXCEPTION 'Pinjaman aktif tidak dapat dihapus' USING ERRCODE = '23514';
    END IF;
    IF OLD.tanggal_kembali IS NOT NULL AND
      (to_jsonb(NEW) - ARRAY['updated_at','updated_by','modified_at','modified_by','deleted_at','deleted_by','is_deleted'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['updated_at','updated_by','modified_at','modified_by','deleted_at','deleted_by','is_deleted']) THEN
      RAISE EXCEPTION 'Pinjaman dikembalikan tidak dapat diubah' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventaris_induk BEFORE INSERT OR UPDATE ON peminjaman_barang
  FOR EACH ROW EXECUTE FUNCTION jaga_anak_inventaris();
CREATE TRIGGER inventaris_induk BEFORE INSERT ON riwayat_kondisi_barang
  FOR EACH ROW EXECUTE FUNCTION jaga_anak_inventaris();

CREATE FUNCTION jaga_barang_inventaris() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sumber RECORD;
BEGIN
  IF NEW.transaksi_id IS NOT NULL AND NOT NEW.is_deleted THEN
    -- Mengunci sumber saat validasi mencegah tautan bersaing dengan soft-delete.
    -- Laporan terkunci tetap boleh menjadi bukti pembelian: tidak ada write finansial.
    SELECT t.jenis,t.is_deleted,l.is_deleted AS laporan_dihapus INTO sumber
      FROM transaksi t JOIN laporan_mingguan l ON l.id=t.laporan_id
      WHERE t.id=NEW.transaksi_id FOR UPDATE OF l,t;
    IF FOUND AND (sumber.jenis <> 'keluar' OR sumber.is_deleted OR sumber.laporan_dihapus) THEN
      RAISE EXCEPTION 'Tautan harus pengeluaran yang aktif pada laporan aktif' USING ERRCODE = '23514';
    END IF;
    -- ID tidak ditemukan diserahkan ke FK, bukan ditafsirkan sebagai konflik.
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.is_deleted AND NOT OLD.is_deleted AND
    EXISTS (SELECT 1 FROM peminjaman_barang WHERE barang_id=OLD.id AND tanggal_kembali IS NULL AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Barang dengan pinjaman aktif tidak dapat dihapus' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventaris_barang BEFORE INSERT OR UPDATE ON barang
  FOR EACH ROW EXECUTE FUNCTION jaga_barang_inventaris();

CREATE FUNCTION jaga_sumber_inventaris() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.is_deleted OR NEW.jenis <> 'keluar') AND
    EXISTS (SELECT 1 FROM barang WHERE transaksi_id=OLD.id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Transaksi masih ditautkan barang aktif' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventaris_sumber BEFORE UPDATE ON transaksi
  FOR EACH ROW EXECUTE FUNCTION jaga_sumber_inventaris();
CREATE INDEX barang_transaksi_aktif ON barang(transaksi_id) WHERE NOT is_deleted;

-- Down Migration
-- Ambil semua lock sebelum memeriksa: penulisan serentak tidak boleh menyelinap
-- antara pemeriksaan kosong dan DROP. Tombstone juga tetap merupakan data.
DO $$
BEGIN
  LOCK TABLE barang,riwayat_kondisi_barang,peminjaman_barang IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM barang) OR EXISTS (SELECT 1 FROM riwayat_kondisi_barang)
    OR EXISTS (SELECT 1 FROM peminjaman_barang) THEN
    RAISE EXCEPTION 'Rollback inventaris ditolak: data masih ada' USING ERRCODE = '23514';
  END IF;
END;
$$;
DROP TRIGGER inventaris_sumber ON transaksi;
DROP FUNCTION jaga_sumber_inventaris();
DROP TABLE peminjaman_barang;
DROP TABLE riwayat_kondisi_barang;
DROP TABLE barang;
DROP FUNCTION jaga_barang_inventaris();
DROP FUNCTION jaga_anak_inventaris();
DROP FUNCTION jaga_riwayat_inventaris();
DROP TYPE kondisi_barang;
