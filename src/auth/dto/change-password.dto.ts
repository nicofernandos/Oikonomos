import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'Password saat ini harus berupa teks' })
  @MinLength(1, { message: 'Password saat ini wajib diisi' })
  @MaxLength(128, { message: 'Password saat ini maksimal 128 karakter' })
  currentPassword: string;

  @IsString({ message: 'Password baru harus berupa teks' })
  @MinLength(10, { message: 'Password baru minimal 10 karakter' })
  @MaxLength(128, { message: 'Password baru maksimal 128 karakter' })
  newPassword: string;
}
