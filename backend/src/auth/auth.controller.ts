import { BadRequestException, Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

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
    return {
      user,
      token,
      tokenType: 'Bearer',
      expiresIn: this.auth.getJwtTtl(),
    };
  }
}
