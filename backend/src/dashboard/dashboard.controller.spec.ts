import { ForbiddenException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

describe('DashboardController', () => {
  const dashboard = {
    getDashboard: jest.fn(),
  };
  const controller = new DashboardController(dashboard as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks USER role from dashboard access', async () => {
    await expect(
      controller.getDashboard(
        {
          id: 'user-1',
          name: 'Mostafa',
          email: 'mostafa@tekronyx.com',
          role: 'USER',
        },
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(dashboard.getDashboard).not.toHaveBeenCalled();
  });

  it('allows MANAGER role and normalizes query filters', async () => {
    dashboard.getDashboard.mockResolvedValue({ ok: true });

    await controller.getDashboard(
      {
        id: 'manager-1',
        name: 'Omar',
        email: 'wasamy.omar@tekronyx.com',
        role: 'MANAGER',
      },
      ' ISO-27001 ',
      ' Finance ',
      ' Access ',
      '30',
    );

    expect(dashboard.getDashboard).toHaveBeenCalledWith({
      framework: 'ISO-27001',
      businessUnit: 'Finance',
      riskCategory: 'Access',
      rangeDays: 30,
    });
  });

  it('passes null filters when query params are empty', async () => {
    dashboard.getDashboard.mockResolvedValue({ ok: true });

    await controller.getDashboard(
      {
        id: 'admin-1',
        name: 'Khaled',
        email: 'khaled@tekronyx.com',
        role: 'ADMIN',
      },
      '   ',
      '',
      ' ',
      undefined,
    );

    expect(dashboard.getDashboard).toHaveBeenCalledWith({
      framework: null,
      businessUnit: null,
      riskCategory: null,
      rangeDays: undefined,
    });
  });
});
