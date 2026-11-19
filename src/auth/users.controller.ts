import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, type PipeTransform } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { AuthRequest } from './jwt-auth.guard.js';

const userIdPipe: PipeTransform<string, number> = {
  transform(value: string): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*(?![\s\S])/.test(value) || value.length > 10 || Number(value) > 2147483647) {
      throw new BadRequestException('ID pengguna tidak valid');
    }
    return Number(value);
  },
};

@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.auth.listUsers(request.user);
  }

  @Patch(':id')
  // Keep the raw parameter: global ValidationPipe must not coerce aliases before userIdPipe.
  update(@Req() request: AuthRequest, @Param('id', userIdPipe) id: unknown, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(request.user, id as number, dto);
  }

  @Post()
  create(@Req() request: AuthRequest, @Body() dto: CreateUserDto) {
    return this.auth.createUser(request.user, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  // As above, unknown prevents primitive coercion before canonical validation.
  resetPassword(@Req() request: AuthRequest, @Param('id', userIdPipe) id: unknown, @Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(request.user, id as number, dto);
  }
}
