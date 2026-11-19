-- Up Migration
-- Tanggal awal metadata adalah baseline pengenalan fitur, bukan riwayat edit.
-- Pelaku historis tidak diketahui: biarkan NULL, termasuk pada data lama.
DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['users','laporan_mingguan','transaksi','saldo_awal','persembahan_bulanan','rekonsiliasi','audit_log'] LOOP
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
  END LOOP;
END;
$$;

CREATE FUNCTION isi_metadata_retensi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pelaku INT := NULLIF(current_setting('oikonomos.actor_id', true), '')::INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_deleted THEN
      RAISE EXCEPTION 'Baris baru harus aktif' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'audit_log' THEN
      RAISE EXCEPTION 'Audit log tidak dapat diubah' USING ERRCODE = '23514';
    END IF;
    IF OLD.is_deleted THEN
      IF NEW.is_deleted THEN
        RAISE EXCEPTION 'Baris dihapus hanya dapat dipulihkan' USING ERRCODE = '23514';
      END IF;
      -- Kolom generated selisih belum dihitung pada NEW dalam BEFORE trigger.
      IF (to_jsonb(NEW) - ARRAY['updated_at','updated_by','modified_at','modified_by','deleted_at','deleted_by','is_deleted']
          - CASE WHEN TG_TABLE_NAME = 'rekonsiliasi' THEN ARRAY['selisih'] ELSE ARRAY[]::TEXT[] END)
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','updated_by','modified_at','modified_by','deleted_at','deleted_by','is_deleted']
          - CASE WHEN TG_TABLE_NAME = 'rekonsiliasi' THEN ARRAY['selisih'] ELSE ARRAY[]::TEXT[] END) THEN
        RAISE EXCEPTION 'Pemulihan tidak boleh mengubah data' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.modified_at := NEW.updated_at;
  NEW.updated_by := pelaku;
  NEW.modified_by := pelaku;
  NEW.deleted_at := NULL;
  NEW.deleted_by := NULL;
  IF NEW.is_deleted THEN
    NEW.deleted_at := NEW.updated_at;
    NEW.deleted_by := pelaku;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION tolak_penghapusan_fisik() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Penghapusan fisik (DELETE/TRUNCATE) dilarang pada tabel %', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['users','laporan_mingguan','transaksi','saldo_awal','persembahan_bulanan','rekonsiliasi','audit_log'] LOOP
    EXECUTE format('CREATE TRIGGER metadata_retensi BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION isi_metadata_retensi()', nama);
    EXECUTE format('CREATE TRIGGER retensi_fisik BEFORE DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION tolak_penghapusan_fisik()', nama);
  END LOOP;
END;
$$;

CREATE FUNCTION jaga_relasi_retensi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  laporan_dihapus BOOLEAN;
  laporan_terkunci BOOLEAN;
  transaksi_dihapus BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'laporan_mingguan' THEN
    IF NEW.is_deleted AND NOT OLD.is_deleted AND (
      EXISTS (SELECT 1 FROM transaksi WHERE laporan_id=OLD.id AND NOT is_deleted)
      OR EXISTS (SELECT 1 FROM persembahan_bulanan WHERE laporan_id=OLD.id AND NOT is_deleted)
      OR EXISTS (SELECT 1 FROM rekonsiliasi WHERE laporan_id=OLD.id AND NOT is_deleted)) THEN
      RAISE EXCEPTION 'Laporan dengan anak aktif tidak dapat dihapus' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Lock baris laporan yang sama dengan jaga_detail_laporan; serialisasi dengan
  -- penguncian/soft-delete induk sebelum membaca anak atau pasangan.
  IF TG_OP = 'UPDATE' THEN
    PERFORM 1 FROM laporan_mingguan WHERE id=OLD.laporan_id FOR UPDATE;
  END IF;
  SELECT is_deleted, terkunci INTO laporan_dihapus, laporan_terkunci
    FROM laporan_mingguan WHERE id=NEW.laporan_id FOR UPDATE;
  IF laporan_terkunci THEN
    RAISE EXCEPTION 'Laporan terkunci tidak dapat diubah' USING ERRCODE = '23514';
  END IF;
  IF laporan_dihapus AND NOT NEW.is_deleted THEN
    RAISE EXCEPTION 'Laporan sudah dihapus; anak aktif tidak diizinkan' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'transaksi' THEN
    IF NEW.is_deleted AND EXISTS (SELECT 1 FROM persembahan_bulanan WHERE transaksi_id=OLD.id AND NOT is_deleted) THEN
      RAISE EXCEPTION 'Pasangan persembahan masih aktif; penghapusan individual dilarang' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'persembahan_bulanan' THEN
    SELECT is_deleted INTO transaksi_dihapus FROM transaksi WHERE id=NEW.transaksi_id FOR UPDATE;
    IF NEW.is_deleted AND NOT transaksi_dihapus THEN
      RAISE EXCEPTION 'Pasangan transaksi masih aktif; penghapusan individual dilarang' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.is_deleted AND transaksi_dihapus THEN
      RAISE EXCEPTION 'Transaksi pasangan sudah dihapus' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retensi_relasi BEFORE UPDATE ON laporan_mingguan FOR EACH ROW EXECUTE FUNCTION jaga_relasi_retensi();
CREATE TRIGGER retensi_relasi BEFORE INSERT OR UPDATE ON transaksi FOR EACH ROW EXECUTE FUNCTION jaga_relasi_retensi();
CREATE TRIGGER retensi_relasi BEFORE INSERT OR UPDATE ON persembahan_bulanan FOR EACH ROW EXECUTE FUNCTION jaga_relasi_retensi();
CREATE TRIGGER retensi_relasi BEFORE INSERT OR UPDATE ON rekonsiliasi FOR EACH ROW EXECUTE FUNCTION jaga_relasi_retensi();

CREATE FUNCTION audit_retensi() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  identitas TEXT;
BEGIN
  identitas := CASE WHEN TG_TABLE_NAME='saldo_awal' THEN to_jsonb(NEW)->>'kas' ELSE to_jsonb(NEW)->>'id' END;
  INSERT INTO audit_log(siapa,aksi,objek,objek_id,ringkasan) VALUES (
    NULLIF(current_setting('oikonomos.actor_id', true), '')::INT,
    CASE WHEN NEW.is_deleted THEN 'soft_delete' ELSE 'restore' END,
    TG_TABLE_NAME, identitas,
    jsonb_build_object(
      'sebelum', jsonb_build_object('is_deleted',OLD.is_deleted,'deleted_at',OLD.deleted_at,'deleted_by',OLD.deleted_by),
      'sesudah', jsonb_build_object('is_deleted',NEW.is_deleted,'deleted_at',NEW.deleted_at,'deleted_by',NEW.deleted_by),
      'pengguna_database', current_user));
  RETURN NEW;
END;
$$;
DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['users','laporan_mingguan','transaksi','saldo_awal','persembahan_bulanan','rekonsiliasi'] LOOP
    EXECUTE format('CREATE TRIGGER retensi_audit AFTER UPDATE ON %I FOR EACH ROW
      WHEN (OLD.is_deleted IS DISTINCT FROM NEW.is_deleted) EXECUTE FUNCTION audit_retensi()', nama);
  END LOOP;
END;
$$;

-- Down Migration
-- Rollback menghilangkan metadata: hanya aman bila tidak ada tombstone.
-- Baris audit historis tetap disimpan, bukan dihapus oleh rollback.
DO $$
DECLARE nama TEXT; ada BOOLEAN;
BEGIN
  FOREACH nama IN ARRAY ARRAY['users','laporan_mingguan','transaksi','saldo_awal','persembahan_bulanan','rekonsiliasi','audit_log'] LOOP
    EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', nama);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE is_deleted)', nama) INTO ada;
    IF ada THEN
      RAISE EXCEPTION 'Tombstone masih ada; rollback retensi ditolak' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;
DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['users','laporan_mingguan','transaksi','saldo_awal','persembahan_bulanan','rekonsiliasi'] LOOP
    EXECUTE format('DROP TRIGGER retensi_audit ON %I', nama);
  END LOOP;
END;
$$;
DROP FUNCTION audit_retensi();
DROP TRIGGER retensi_relasi ON rekonsiliasi;
DROP TRIGGER retensi_relasi ON persembahan_bulanan;
DROP TRIGGER retensi_relasi ON transaksi;
DROP TRIGGER retensi_relasi ON laporan_mingguan;
DROP FUNCTION jaga_relasi_retensi();
DO $$
DECLARE nama TEXT;
BEGIN
  FOREACH nama IN ARRAY ARRAY['audit_log','rekonsiliasi','persembahan_bulanan','saldo_awal','transaksi','laporan_mingguan','users'] LOOP
    EXECUTE format('DROP TRIGGER metadata_retensi ON %I', nama);
    EXECUTE format('DROP TRIGGER retensi_fisik ON %I', nama);
    EXECUTE format('ALTER TABLE %I DROP COLUMN updated_at, DROP COLUMN updated_by,
      DROP COLUMN modified_at, DROP COLUMN modified_by, DROP COLUMN deleted_at,
      DROP COLUMN deleted_by, DROP COLUMN is_deleted', nama);
  END LOOP;
END;
$$;
DROP FUNCTION isi_metadata_retensi();
DROP FUNCTION tolak_penghapusan_fisik();
