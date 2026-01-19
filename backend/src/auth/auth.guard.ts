import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers['authorization'] || '').trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException('Missing auth token');
    }

    let payload: { sub: string };
    try {
      payload = this.auth.verifyToken(match[1]);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.auth.getUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid user');
    }

    req.user = user;
    return true;
  }
}
