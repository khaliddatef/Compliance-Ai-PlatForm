import { BadRequestException } from '@nestjs/common';
import {
  CUSTOMER_ALLOWED_EXTENSIONS,
  CUSTOMER_ALLOWED_MIME_TYPES,
  makeFileFilter,
} from './upload.validation';

type FileFilterCb = (error: any, acceptFile: boolean) => void;

const file = (name: string, mime: string) =>
  ({
    originalname: name,
    mimetype: mime,
  }) as Express.Multer.File;

describe('makeFileFilter', () => {
  const filter = makeFileFilter(CUSTOMER_ALLOWED_MIME_TYPES, CUSTOMER_ALLOWED_EXTENSIONS);

  const runFilter = (req: any, inputFile: Express.Multer.File) =>
    new Promise<{ error: any; accepted: boolean }>((resolve) => {
      const cb: FileFilterCb = (error, accepted) => resolve({ error, accepted });
      filter(req, inputFile, cb);
    });

  it('rejects STANDARD uploads', async () => {
    const result = await runFilter(
      { query: { kind: 'STANDARD' } },
      file('controls.pdf', 'application/pdf'),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBeInstanceOf(BadRequestException);
    expect(result.error.message).toBe('Standard uploads are disabled.');
  });

  it('accepts a file when MIME type is allowed', async () => {
    const result = await runFilter(
      { query: { kind: 'CUSTOMER' } },
      file('controls.unknown', 'application/pdf'),
    );

    expect(result.error).toBeNull();
    expect(result.accepted).toBe(true);
  });

  it('accepts a file when extension is allowed even if MIME is not', async () => {
    const result = await runFilter(
      { query: { kind: 'CUSTOMER' } },
      file('controls.xlsx', 'application/octet-stream'),
    );

    expect(result.error).toBeNull();
    expect(result.accepted).toBe(true);
  });

  it('rejects a file when both MIME type and extension are unsupported', async () => {
    const result = await runFilter(
      { query: { kind: 'CUSTOMER' } },
      file('controls.txt', 'text/plain'),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBeInstanceOf(BadRequestException);
    expect(result.error.message).toBe('Unsupported file type.');
  });
});
