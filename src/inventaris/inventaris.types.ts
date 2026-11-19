import type { Kondisi, MetadataInput } from './dto/inventaris.dto.js';
export interface MetadataRetensi {
  updated_at: Date; updated_by: number | null;
  modified_at: Date; modified_by: number | null;
  deleted_at: Date | null; deleted_by: number | null; is_deleted: boolean;
}
export interface Barang extends MetadataInput, MetadataRetensi {
  id: string; kondisi: Kondisi; dibuat_oleh: number; dibuat_pada: Date;
}
export interface RiwayatKondisi extends MetadataRetensi {
  id: string; barang_id: string; kondisi_lama: Kondisi | null; kondisi_baru: Kondisi;
  catatan: string; diubah_oleh: number; waktu: Date;
}
export interface Peminjaman extends MetadataRetensi {
  id: string; barang_id: string; peminjam: string; tanggal_pinjam: string;
  rencana_kembali: string | null; tanggal_kembali: string | null; catatan: string | null;
  dibuat_oleh: number; dibuat_pada: Date;
}
