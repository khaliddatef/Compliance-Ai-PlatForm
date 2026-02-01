import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing auth token');
    }

    let payload: { sub: string };
    try {
      payload = this.auth.verifyToken(token);
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

  private extractToken(req: any) {
    const header = String(req.headers['authorization'] || '').trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];

    const cookieHeader = String(req.headers['cookie'] || '');
    if (!cookieHeader) return '';
    const token = cookieHeader
      .split(';')
      .map((part: string) => part.trim())
      .map((part: string) => part.split('='))
      .find(([key]) => key === 'tekronyx_token')?.[1];
    return token ? decodeURIComponent(token) : '';
  }
}
