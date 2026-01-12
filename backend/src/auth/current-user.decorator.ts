import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | null => {
    const req = context.switchToHttp().getRequest();
    return (req?.user as AuthUser) || null;
  },
);
