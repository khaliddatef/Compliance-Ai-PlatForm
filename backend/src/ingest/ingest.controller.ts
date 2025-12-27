import { Controller, Param, Post } from '@nestjs/common';
import { IngestService } from './ingest.service';

@Controller('api/ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  // للتجربة اليدوية:
  // POST /api/ingest/:documentId
  @Post(':documentId')
  ingestOne(@Param('documentId') documentId: string) {
    return this.ingest.ingestDocument(documentId);
  }
}
