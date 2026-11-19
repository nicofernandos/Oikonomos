-- Up Migration
CREATE TYPE jenis_kas AS ENUM ('gereja', 'pusat', 'diakonia', 'pembangunan');
CREATE TYPE jenis_transaksi AS ENUM ('masuk', 'keluar');

CREATE TABLE laporan_mingguan (
  id          SERIAL PRIMARY KEY,
  tanggal     DATE NOT NULL UNIQUE,
  terkunci    BOOLEAN NOT NULL DEFAULT false,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transaksi (
  id          BIGSERIAL PRIMARY KEY,
  laporan_id  INT NOT NULL REFERENCES laporan_mingguan(id),
  kas         jenis_kas NOT NULL,
  jenis       jenis_transaksi NOT NULL,
  uraian      TEXT NOT NULL,
  nominal     BIGINT NOT NULL CHECK (nominal > 0),
  tanggal     DATE NOT NULL
);

CREATE INDEX idx_transaksi_laporan_kas ON transaksi (laporan_id, kas);

-- Down Migration
DROP TABLE transaksi;
DROP TABLE laporan_mingguan;
DROP TYPE jenis_transaksi;
DROP TYPE jenis_kas;