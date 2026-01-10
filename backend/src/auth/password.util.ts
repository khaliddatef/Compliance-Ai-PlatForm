import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  if (!password || !stored) return false;
  const [prefix, salt, hashHex] = stored.split('$');
  if (prefix !== HASH_PREFIX || !salt || !hashHex) return false;

  const storedHash = Buffer.from(hashHex, 'hex');
  if (!storedHash.length) return false;

  const computedHash = scryptSync(password, salt, storedHash.length);
  return timingSafeEqual(storedHash, computedHash);
}
