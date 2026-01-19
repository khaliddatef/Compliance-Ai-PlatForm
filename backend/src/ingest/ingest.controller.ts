import { Controller, ForbiddenException, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(AuthGuard)
@Controller('api/ingest')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly prisma: PrismaService,
  ) {}

  // للتجربة اليدوية:
  // POST /api/ingest/:documentId
  @Post(':documentId')
  async ingestOne(@Param('documentId') documentId: string, @CurrentUser() user: AuthUser) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { conversationId: true, conversation: { select: { userId: true } } },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    if (user?.role === 'USER') {
      const ownerId = doc.conversation?.userId || null;
      if (!ownerId) {
        await this.prisma.conversation.update({
          where: { id: doc.conversationId },
          data: { userId: user.id },
        });
      } else if (ownerId !== user.id) {
        throw new ForbiddenException('Not allowed to ingest this document');
      }
    }

    return this.ingest.ingestDocument(documentId);
  }
}
