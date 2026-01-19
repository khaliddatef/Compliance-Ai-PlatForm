import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import xlsx from 'xlsx';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

@Injectable()
export class IngestService {
  constructor(private readonly prisma: PrismaService) {}

  private detectFileType(doc: { mimeType?: string | null; storagePath?: string | null; originalName?: string | null }) {
    const mime = String(doc.mimeType || '').toLowerCase();
    const name = String(doc.originalName || '');
    const storagePath = String(doc.storagePath || '');
    const ext = path.extname(storagePath || name).toLowerCase();

    const isPdf = mime === 'application/pdf' || ext === '.pdf';
    const isDocx =
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx';
    const isXlsx =
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === '.xlsx';

    return { isPdf, isDocx, isXlsx, ext, mime };
  }

  private async extractTextFromPdf(buffer: Buffer) {
    const parsed = await pdfParse(buffer);
    return String(parsed?.text || '').trim();
  }

  private async extractTextFromDocx(buffer: Buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '').trim();
  }

  private extractTextFromXlsx(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const lines: string[] = [];

    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<unknown[]>;
      if (!rows.length) continue;
      lines.push(`Sheet: ${sheetName}`);
      for (const row of rows) {
        const line = row
          .map((cell) => String(cell ?? '').trim())
          .filter(Boolean)
          .join(' ');
        if (line) lines.push(line);
      }
    }

    return lines.join('\n').trim();
  }

  private chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
    const clean = (text || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!clean) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < clean.length) {
      const end = Math.min(start + chunkSize, clean.length);
      const chunk = clean.slice(start, end).trim();
      if (chunk) chunks.push(chunk);

      start = end - overlap;
      if (start < 0) start = 0;
      if (end === clean.length) break;
    }

    return chunks;
  }

  async ingestDocument(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        storagePath: true,
        originalName: true,
        mimeType: true,
        kind: true,
        conversationId: true,
      },
    });

    if (!doc) {
      return { ok: false as const, message: 'Document not found' };
    }

    // ✅ Logs مهمة جدًا للديمو + للتأكد إن kind صح
    console.log(
      `[INGEST] doc=${doc.id} name=${doc.originalName} kind=${doc.kind} conv=${doc.conversationId}`,
    );

    const buffer = await fs.readFile(doc.storagePath);
    const fileType = this.detectFileType(doc);
    let text = '';

    try {
      if (fileType.isPdf) {
        text = await this.extractTextFromPdf(buffer);
      } else if (fileType.isDocx) {
        text = await this.extractTextFromDocx(buffer);
      } else if (fileType.isXlsx) {
        text = this.extractTextFromXlsx(buffer);
      } else {
        return { ok: false as const, message: 'Unsupported file type for ingest' };
      }
    } catch (error: any) {
      return { ok: false as const, message: error?.message || 'Failed to extract text' };
    }

    const chunks = this.chunkText(text);

    await this.prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });

      if (chunks.length > 0) {
        await tx.documentChunk.createMany({
          data: chunks.map((c, idx) => ({
            documentId,
            chunkIndex: idx,
            text: c,
          })),
        });
      }
    });

    const saved = await this.prisma.documentChunk.count({ where: { documentId } });
    console.log(`[INGEST] saved chunks=${saved} for doc=${doc.id}`);

    return { ok: true as const, chunks: chunks.length };
  }
}
