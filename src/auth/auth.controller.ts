import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { Public } from './public.decorator.js';
import type { AuthRequest } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  me(@Req() request: AuthRequest) {
    return request.user;
  }

  @Post('users')
  createUser(@Req() request: AuthRequest, @Body() dto: CreateUserDto) {
    return this.authService.createUser(request.user, dto);
  }

  @Patch('password')
  changePassword(@Req() request: AuthRequest, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(request.user, dto);
  }
}
