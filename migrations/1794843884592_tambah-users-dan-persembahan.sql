-- Up Migration
CREATE TYPE peran_user AS ENUM ('admin', 'bendahara', 'majelis');

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL,
  peran         peran_user NOT NULL,
  aktif         BOOLEAN NOT NULL DEFAULT true,
  dibuat_pada   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saldo_awal (
  kas         jenis_kas PRIMARY KEY,
  nominal     BIGINT NOT NULL CHECK (nominal >= 0),
  per_tanggal DATE NOT NULL
);

CREATE TABLE persembahan_bulanan (
  id           BIGSERIAL PRIMARY KEY,
  laporan_id   INT NOT NULL REFERENCES laporan_mingguan(id),
  transaksi_id BIGINT NOT NULL UNIQUE REFERENCES transaksi(id),
  nama         TEXT NOT NULL,
  bulan        DATE NOT NULL CHECK (bulan = date_trunc('month', bulan)::date),
  nominal      BIGINT NOT NULL CHECK (nominal > 0)
);

CREATE INDEX idx_persembahan_laporan ON persembahan_bulanan (laporan_id);

-- Down Migration
DROP TABLE persembahan_bulanan;
DROP TABLE saldo_awal;
DROP TABLE users;
DROP TYPE peran_user;