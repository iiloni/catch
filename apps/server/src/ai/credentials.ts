import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';
import { ProviderError } from './provider';

const key = () =>
  createHash('sha256').update(`catch-ai-credential:${env.BETTER_AUTH_SECRET}`).digest();
export function sealCredential(value: string | null) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openCredential(value: string | null) {
  if (!value) return null;
  try {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  } catch {
    throw new ProviderError(
      'The saved API key cannot be opened. Enter it again after restoring or changing the server secret.',
    );
  }
}
