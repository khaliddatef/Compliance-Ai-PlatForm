import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

type MockAuthService = {
  verifyToken: jest.Mock;
  getUserById: jest.Mock;
};

function createContext(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as ExecutionContext;
}

describe('AuthGuard', () => {
  let auth: MockAuthService;
  let guard: AuthGuard;

  beforeEach(() => {
    auth = {
      verifyToken: jest.fn(),
      getUserById: jest.fn(),
    };
    guard = new AuthGuard(auth as any);
  });

  it('rejects when token is missing', async () => {
    const req = { headers: {} };
    const context = createContext(req);
    const action = guard.canActivate(context);

    await expect(action).rejects.toThrow(UnauthorizedException);
    await expect(action).rejects.toThrow('Missing auth token');
  });

  it('accepts bearer token and attaches user to request', async () => {
    const req = { headers: { authorization: 'Bearer test-token' } };
    const context = createContext(req);
    auth.verifyToken.mockReturnValue({ sub: 'user-1' });
    auth.getUserById.mockResolvedValue({ id: 'user-1', email: 'u@example.com', role: 'USER' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(auth.verifyToken).toHaveBeenCalledWith('test-token');
    expect(auth.getUserById).toHaveBeenCalledWith('user-1');
    expect(req.user).toEqual({ id: 'user-1', email: 'u@example.com', role: 'USER' });
  });

  it('uses cookie token when bearer header is absent', async () => {
    const encoded = encodeURIComponent('cookie-token');
    const req = { headers: { cookie: `a=1; tekronyx_token=${encoded}; b=2` } };
    const context = createContext(req);
    auth.verifyToken.mockReturnValue({ sub: 'manager-1' });
    auth.getUserById.mockResolvedValue({ id: 'manager-1', role: 'MANAGER' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(auth.verifyToken).toHaveBeenCalledWith('cookie-token');
    expect(req.user).toEqual({ id: 'manager-1', role: 'MANAGER' });
  });

  it('rejects when token is invalid or expired', async () => {
    const req = { headers: { authorization: 'Bearer broken-token' } };
    const context = createContext(req);
    auth.verifyToken.mockImplementation(() => {
      throw new Error('bad token');
    });
    const action = guard.canActivate(context);

    await expect(action).rejects.toThrow(UnauthorizedException);
    await expect(action).rejects.toThrow('Invalid or expired token');
  });

  it('rejects when user is not found', async () => {
    const req = { headers: { authorization: 'Bearer valid-token' } };
    const context = createContext(req);
    auth.verifyToken.mockReturnValue({ sub: 'ghost-user' });
    auth.getUserById.mockResolvedValue(null);
    const action = guard.canActivate(context);

    await expect(action).rejects.toThrow(UnauthorizedException);
    await expect(action).rejects.toThrow('Invalid user');
  });
});
