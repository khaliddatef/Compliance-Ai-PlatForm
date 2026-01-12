import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = String(req.headers['x-user-id'] || '').trim();
    if (!userId) {
      throw new UnauthorizedException('Missing user context');
    }

    const user = await this.auth.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid user');
    }

    req.user = user;
    return true;
  }
}
