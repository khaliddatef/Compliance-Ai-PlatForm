import { Controller, GoneException, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('api/standards')
export class StandardsController {
  @Post('upload')
  uploadStandard() {
    throw new GoneException('Standard uploads are disabled. The KB is the source of truth.');
  }
}
