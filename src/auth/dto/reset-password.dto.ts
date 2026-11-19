import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Password harus berupa teks' })
  @MinLength(10, { message: 'Password minimal 10 karakter' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter' })
  password: string;
}
