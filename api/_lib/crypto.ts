// AES-256-GCM encryption helper for at-rest MBI protection + SHA-256
// hash helper for the 4-digit security PIN.
//
// Mirrored from the Medicare consumer repo (plan-match api/_lib/crypto.ts).
// Keep the two copies in sync when crypto-mode changes (e.g. argon2id
// migration for hashPin) so a future Supplement enrollment that gets
// promoted to the Medicare clients table remains comparable.
//
// W1 audit MEDIUM #18 + #19 flagged plaintext mbi_number + security_pin
// columns on supplement_applications + leads.context. CMS NGD MBI
// guidance; HIPAA 45 CFR §164.312(a)(2)(iv); NIST SP 800-63B Appendix A.3.
//
// Key management: ENCRYPTION_KEY is a 64-char hex string (32 bytes)
// stored in Vercel project env (Production + Preview). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Never commit the key.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'ENCRYPTION_KEY env var is required (64-char hex string from `node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))"`)'
    );
  }
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() requires a string plaintext');
  }
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < 28) throw new Error('encrypted blob too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function hashPin(pin: string): string {
  if (typeof pin !== 'string') {
    throw new TypeError('hashPin() requires a string pin');
  }
  return createHash('sha256').update(pin).digest('hex');
}

export function maskMbi(mbi: string | null | undefined): string {
  if (!mbi) return '';
  const s = String(mbi).trim();
  if (s.length < 4) return '***';
  return '*'.repeat(s.length - 4) + s.slice(-4);
}
