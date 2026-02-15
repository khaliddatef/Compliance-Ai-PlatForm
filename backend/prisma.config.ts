import * as path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const runtimeRoot = __dirname;
const backendRoot =
  path.basename(runtimeRoot).toLowerCase() === 'dist'
    ? path.resolve(runtimeRoot, '..')
    : runtimeRoot;

const toSqliteFileUrl = (absolutePath: string) => {
  const normalized = absolutePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:${normalized}`;
  }
  return `file:${normalized}`;
};

const normalizeDatabaseUrl = (raw?: string) => {
  const source = String(raw || 'file:./dev.db').trim().replace(/^['"]|['"]$/g, '');

  if (!source.startsWith('file:')) {
    return source;
  }

  let filePath = source.slice('file:'.length) || './dev.db';
  if (filePath.startsWith('//')) {
    filePath = decodeURIComponent(filePath.replace(/^\/+/, ''));
    if (!/^[A-Za-z]:[\\/]/.test(filePath)) {
      filePath = `/${filePath}`;
    }
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(backendRoot, filePath);

  return toSqliteFileUrl(absolutePath);
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL),
  },
});
