-- Up Migration
ALTER TABLE transaksi
  ADD COLUMN koreksi_dari BIGINT REFERENCES transaksi(id),
  ADD COLUMN dibuat_oleh INT REFERENCES users(id),
  ADD COLUMN dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE laporan_mingguan
  ADD COLUMN dibuat_oleh INT REFERENCES users(id),
  ADD COLUMN dikunci_oleh INT REFERENCES users(id),
  ADD COLUMN dikunci_pada TIMESTAMPTZ,
  ADD COLUMN disetujui_oleh INT REFERENCES users(id),
  ADD COLUMN disetujui_pada TIMESTAMPTZ;

CREATE TABLE rekonsiliasi (
  id BIGSERIAL PRIMARY KEY,
  laporan_id INT NOT NULL REFERENCES laporan_mingguan(id),
  kas jenis_kas NOT NULL,
  saldo_sistem BIGINT NOT NULL,
  saldo_fisik BIGINT NOT NULL CHECK (saldo_fisik >= 0),
  selisih BIGINT GENERATED ALWAYS AS (saldo_fisik - saldo_sistem) STORED,
  dicek_oleh INT NOT NULL REFERENCES users(id),
  waktu TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (laporan_id, kas)
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  siapa INT REFERENCES users(id),
  aksi TEXT NOT NULL,
  objek TEXT NOT NULL,
  objek_id TEXT,
  waktu TIMESTAMPTZ NOT NULL DEFAULT now(),
  ringkasan JSONB NOT NULL
);
CREATE INDEX idx_audit_log_objek ON audit_log (objek, objek_id, waktu);
CREATE INDEX idx_transaksi_koreksi ON transaksi (koreksi_dari) WHERE koreksi_dari IS NOT NULL;
CREATE INDEX idx_laporan_tanggal ON laporan_mingguan (tanggal);

-- Nilai saldo awal harus diverifikasi bendahara, tidak diisi angka rekaan.
ALTER TABLE saldo_awal ADD CONSTRAINT saldo_awal_tanggal_baseline
  CHECK (per_tanggal = DATE '2026-11-08');

-- Pertahanan tambahan bila ada SQL di luar repository API.
CREATE FUNCTION jaga_laporan_terkunci() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terkunci THEN
    RAISE EXCEPTION 'Laporan terkunci tidak dapat diubah atau dihapus' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER laporan_permanen BEFORE UPDATE OR DELETE ON laporan_mingguan
  FOR EACH ROW EXECUTE FUNCTION jaga_laporan_terkunci();

CREATE FUNCTION jaga_detail_laporan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tanggal_laporan DATE;
  sudah_terkunci BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT terkunci INTO sudah_terkunci FROM laporan_mingguan WHERE id = OLD.laporan_id FOR UPDATE;
    IF sudah_terkunci THEN
      RAISE EXCEPTION 'Laporan terkunci tidak dapat diubah' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT tanggal, terkunci INTO tanggal_laporan, sudah_terkunci
    FROM laporan_mingguan WHERE id = NEW.laporan_id FOR UPDATE;
  IF sudah_terkunci THEN
    RAISE EXCEPTION 'Laporan terkunci tidak dapat diubah' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'transaksi' THEN
    IF NEW.tanggal > tanggal_laporan THEN
      RAISE EXCEPTION 'Tanggal transaksi melewati tanggal laporan' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaksi_laporan_terbuka BEFORE INSERT OR UPDATE OR DELETE ON transaksi
  FOR EACH ROW EXECUTE FUNCTION jaga_detail_laporan();
CREATE TRIGGER persembahan_laporan_terbuka BEFORE INSERT OR UPDATE OR DELETE ON persembahan_bulanan
  FOR EACH ROW EXECUTE FUNCTION jaga_detail_laporan();
CREATE TRIGGER rekonsiliasi_laporan_terbuka BEFORE INSERT OR UPDATE OR DELETE ON rekonsiliasi
  FOR EACH ROW EXECUTE FUNCTION jaga_detail_laporan();

CREATE FUNCTION jaga_saldo_awal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock serialisasi yang sama dengan pembuatan/penguncian laporan di repository.
  PERFORM pg_advisory_xact_lock(20261108);
  IF EXISTS (SELECT 1 FROM laporan_mingguan WHERE terkunci) THEN
    RAISE EXCEPTION 'Saldo awal tidak dapat diubah setelah laporan terkunci' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER saldo_awal_tetap BEFORE INSERT OR UPDATE OR DELETE ON saldo_awal
  FOR EACH ROW EXECUTE FUNCTION jaga_saldo_awal();

CREATE FUNCTION audit_saldo_awal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sebelum JSONB;
  sesudah JSONB;
  kas_diubah TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    sebelum := jsonb_build_object('kas', OLD.kas, 'nominal', OLD.nominal::text, 'per_tanggal', OLD.per_tanggal);
    kas_diubah := OLD.kas::text;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    sesudah := jsonb_build_object('kas', NEW.kas, 'nominal', NEW.nominal::text, 'per_tanggal', NEW.per_tanggal);
    kas_diubah := NEW.kas::text;
  END IF;
  INSERT INTO audit_log(siapa,aksi,objek,objek_id,ringkasan)
    VALUES (NULLIF(current_setting('oikonomos.actor_id', true), '')::int,
      lower(TG_OP) || '_saldo_awal', 'saldo_awal', kas_diubah,
      jsonb_build_object('sebelum', sebelum, 'sesudah', sesudah, 'pengguna_database', current_user));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER saldo_awal_audit AFTER INSERT OR UPDATE OR DELETE ON saldo_awal
  FOR EACH ROW EXECUTE FUNCTION audit_saldo_awal();

-- Down Migration
DROP TRIGGER saldo_awal_audit ON saldo_awal;
DROP FUNCTION audit_saldo_awal();
DROP TRIGGER saldo_awal_tetap ON saldo_awal;
DROP FUNCTION jaga_saldo_awal();
DROP TRIGGER rekonsiliasi_laporan_terbuka ON rekonsiliasi;
DROP TRIGGER persembahan_laporan_terbuka ON persembahan_bulanan;
DROP TRIGGER transaksi_laporan_terbuka ON transaksi;
DROP FUNCTION jaga_detail_laporan();
DROP TRIGGER laporan_permanen ON laporan_mingguan;
DROP FUNCTION jaga_laporan_terkunci();
ALTER TABLE saldo_awal DROP CONSTRAINT saldo_awal_tanggal_baseline;
DROP INDEX idx_laporan_tanggal;
DROP INDEX idx_transaksi_koreksi;
DROP TABLE audit_log;
DROP TABLE rekonsiliasi;
ALTER TABLE laporan_mingguan DROP COLUMN dibuat_oleh, DROP COLUMN dikunci_oleh,
  DROP COLUMN dikunci_pada, DROP COLUMN disetujui_oleh, DROP COLUMN disetujui_pada;
ALTER TABLE transaksi DROP COLUMN koreksi_dari, DROP COLUMN dibuat_oleh, DROP COLUMN dibuat_pada;
