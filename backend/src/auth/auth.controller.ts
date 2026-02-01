import { BadRequestException, Body, Controller, Get, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body()
    body: {
      email?: string;
      password?: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = (body?.email || '').trim().toLowerCase();
    const password = body?.password || '';

    if (!email || !password) {
      throw new BadRequestException('Email and password are required.');
    }

    const user = await this.auth.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const token = this.auth.issueToken(user);
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('tekronyx_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
    });
    return {
      user,
      token,
      tokenType: 'Bearer',
      expiresIn: this.auth.getJwtTtl(),
    };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie('tekronyx_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
    });
    return { ok: true };
  }
}
