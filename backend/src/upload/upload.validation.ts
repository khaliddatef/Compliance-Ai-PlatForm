import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

export const CUSTOMER_ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const CUSTOMER_ALLOWED_EXTENSIONS = new Set<string>(['.pdf', '.docx', '.xlsx']);

export const STANDARD_ALLOWED_MIME_TYPES = new Set<string>(['application/pdf']);
export const STANDARD_ALLOWED_EXTENSIONS = new Set<string>(['.pdf']);

export function makeFileFilter(allowedMimeTypes: Set<string>, allowedExtensions: Set<string>) {
  return (req: any, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
    const kind = String(req?.query?.kind || '').toUpperCase();
    if (kind === 'STANDARD') {
      return cb(new BadRequestException('Standard uploads are disabled.'), false);
    }

    const ext = extname(file.originalname || '').toLowerCase();
    const mimeOk = allowedMimeTypes.has(file.mimetype);
    const extOk = allowedExtensions.has(ext);
    if (!mimeOk && !extOk) {
      return cb(new BadRequestException('Unsupported file type.'), false);
    }
    return cb(null, true);
  };
}
