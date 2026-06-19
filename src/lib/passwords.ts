import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = 'scrypt';

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const key = await derivePasswordKey(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!storedHash) return false;

  if (storedHash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
    const [, salt, expectedKey] = storedHash.split('$');
    if (!salt || !expectedKey) return false;

    const actual = await derivePasswordKey(password, salt);
    const expected = Buffer.from(expectedKey, 'base64url');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  if (storedHash.startsWith('manual:')) {
    return safeEqual(storedHash, `manual:${password}`);
  }

  return false;
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function derivePasswordKey(password: string, salt: string) {
  return (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
}
