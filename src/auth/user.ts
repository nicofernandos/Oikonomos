export type PeranUser = 'admin' | 'bendahara' | 'majelis';

export interface AuthUser {
  id: number;
  username: string;
  nama: string;
  peran: PeranUser;
  aktif: boolean;
}

export interface UserRow extends AuthUser {
  password_hash: string;
}
