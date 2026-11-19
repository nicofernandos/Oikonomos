import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { PeranUser } from '../user.js';

export class CreateUserDto {
  @IsString({ message: 'Username harus berupa teks' })
  @Matches(/^[a-zA-Z0-9_.-]{3,100}$/, { message: 'Username harus 3–100 karakter berupa huruf, angka, titik, garis bawah, atau tanda hubung' })
  username: string;

  @IsString({ message: 'Password harus berupa teks' })
  @MinLength(10, { message: 'Password minimal 10 karakter' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter' })
  @Matches(/^[^\uD800-\uDFFF]*(?![\s\S])/u, { message: 'Password harus berupa Unicode yang valid' })
  password: string;

  @IsString({ message: 'Nama harus berupa teks' })
  @Matches(/\S/, { message: 'Nama wajib diisi' })
  @MaxLength(200, { message: 'Nama maksimal 200 karakter' })
  @Matches(/^[^\u0000]*$/, { message: 'Nama tidak boleh mengandung karakter NUL' })
  @Matches(/^[^\uD800-\uDFFF]*(?![\s\S])/u, { message: 'Nama harus berupa Unicode yang valid' })
  nama: string;

  @IsIn(['admin', 'bendahara', 'majelis'], { message: 'Peran harus admin, bendahara, atau majelis' })
  peran: PeranUser;
}
