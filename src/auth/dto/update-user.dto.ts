import { IsBoolean, IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type { PeranUser } from '../user.js';

export class UpdateUserDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'Nama harus berupa teks' })
  @Matches(/\S/, { message: 'Nama wajib diisi' })
  @MaxLength(200, { message: 'Nama maksimal 200 karakter' })
  @Matches(/^[^\u0000]*$/, { message: 'Nama tidak boleh mengandung karakter NUL' })
  @Matches(/^[^\uD800-\uDFFF]*(?![\s\S])/u, { message: 'Nama harus berupa Unicode yang valid' })
  nama?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['admin', 'bendahara', 'majelis'], { message: 'Peran harus admin, bendahara, atau majelis' })
  peran?: PeranUser;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: 'Status aktif harus berupa boolean' })
  aktif?: boolean;
}
