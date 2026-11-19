import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'Username harus berupa teks' })
  @MinLength(1, { message: 'Username wajib diisi' })
  @MaxLength(100, { message: 'Username maksimal 100 karakter' })
  @Matches(/^[^\u0000]*$/, { message: 'Username tidak boleh mengandung karakter NUL' })
  username: string;

  @IsString({ message: 'Password harus berupa teks' })
  @MinLength(1, { message: 'Password wajib diisi' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter' })
  password: string;
}
